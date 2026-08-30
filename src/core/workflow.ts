import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/database.js';
import type { Config } from '../config.js';
import type { SendMessageOptions, TelegramClientInterface, TelegramPhoto } from '../telegram/client.js';
import { ACCESS_DENIED_MESSAGE, isAuthorized } from '../telegram/guards.js';
import { T, buildPreviewText, draftButtons, editMenuButtons } from '../telegram/messages.js';
import { upsertTelegramUser } from '../db/repositories/users.js';
import {
  getConversationState,
  setConversationState,
  type ChatStateData,
  type EditableField,
  type StoredImage,
} from '../db/repositories/states.js';
import {
  cancelDraft,
  claimPublish,
  createDraft,
  findDraftById,
  findPendingDraftsByUser,
  incrementAiCallCount,
  markPublished,
  revertPublish,
  updateDraftFields,
} from '../db/repositories/drafts.js';
import { addLog } from '../db/repositories/logs.js';
import { isUpdateProcessed, markUpdateProcessed } from '../db/repositories/webhookUpdates.js';
import { matchCategory, getCategoryDisplayName } from './categoryMatcher.js';
import { parseField, parsePriceStock, type PriceStock } from './priceParser.js';
import { MediaError, type MediaService } from './media.js';
import type { SlidingWindowRateLimiter } from './rateLimit.js';
import type { AiAnalysis, AiProductAnalyzer } from '../ai/provider.js';
import { StoreApiError, type StoreProductService } from '../store/client.js';

/**
 * Product Automation Core.
 *
 * Telegram is only an interface for this class — the same workflow could be
 * driven by WhatsApp or a web dashboard in the future without changes.
 *
 * Cost policy: ONE AI call per product; the only extra call is the explicit
 * "re-analyze" button. Everything else (parsing, validation, state, CRUD,
 * category lookup, publishing) is plain code.
 */

const EDITABLE_FIELDS: readonly EditableField[] = ['name', 'price', 'stock', 'description', 'category'];

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id?: number;
    chat?: { id?: number; type?: string };
    from?: { id?: number; username?: string | null; first_name?: string | null };
    text?: string;
    photo?: TelegramPhoto[];
  };
  callback_query?: {
    id: string;
    from?: { id?: number; username?: string | null; first_name?: string | null };
    message?: { chat?: { id?: number; type?: string } };
    data?: string;
  };
}

export interface WorkflowLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export interface WorkflowDeps {
  db: Db;
  config: Config;
  telegram: TelegramClientInterface;
  analyzer: AiProductAnalyzer;
  store: StoreProductService;
  media: MediaService;
  limiter: SlidingWindowRateLimiter;
  logger: WorkflowLogger;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export class ProductWorkflow {
  constructor(private readonly deps: WorkflowDeps) {}

  // ------------------------------------------------------------------
  // Entry point (called by the webhook route)
  // ------------------------------------------------------------------

  async processUpdate(update: TelegramUpdate): Promise<void> {
    if (!update || typeof update.update_id !== 'number') return;

    // Webhook retry protection: each update_id is processed exactly once.
    if (isUpdateProcessed(this.deps.db, update.update_id)) return;
    markUpdateProcessed(this.deps.db, update.update_id);

    const message = update.message;
    const callback = update.callback_query;
    const chatId = message?.chat?.id ?? callback?.message?.chat?.id;
    const chatType = message?.chat?.type ?? callback?.message?.chat?.type;
    const fromId = message?.from?.id ?? callback?.from?.id;
    if (chatId === undefined || fromId === undefined) return;
    // MVP: private chats only (employee talks to the bot directly).
    if (chatType !== undefined && chatType !== 'private') return;

    // Spam protection
    if (!this.deps.limiter.allow(`webhook:${chatId}`, this.deps.config.rateLimits.webhookPerChatPerMin, 60_000)) {
      addLog(this.deps.db, { action: 'RATE_LIMITED', chatId, telegramUserId: fromId, meta: { scope: 'webhook' } });
      return;
    }

    // Authorization gate — AI, database writes and the store API are all
    // unreachable before this check passes.
    if (!isAuthorized(this.deps.config.telegram.adminIds, fromId)) {
      addLog(this.deps.db, { action: 'ACCESS_DENIED', chatId, telegramUserId: fromId });
      if (callback) await this.safeAnswer(callback.id, '⛔ Access Denied');
      else await this.safeSend(chatId, ACCESS_DENIED_MESSAGE);
      return;
    }

    const username = message?.from?.username ?? callback?.from?.username ?? null;
    upsertTelegramUser(this.deps.db, fromId, username ?? undefined);

    if (callback) {
      if (typeof callback.data === 'string' && callback.data.length > 0) {
        await this.handleCallback(chatId, fromId, callback.id, callback.data);
      }
      return;
    }
    if (message?.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      if (photo) await this.handlePhoto(chatId, fromId, photo);
      return;
    }
    if (typeof message?.text === 'string') {
      await this.handleText(chatId, fromId, message.text);
      return;
    }
    if (message) await this.safeSend(chatId, T.UNSUPPORTED_MESSAGE);
  }

  // ------------------------------------------------------------------
  // Commands
  // ------------------------------------------------------------------

  private async handleCommand(chatId: number, userId: number, command: string): Promise<void> {
    switch (command) {
      case 'new':
        await this.startNew(chatId, userId);
        return;
      case 'pending':
        await this.listPending(chatId, userId);
        return;
      case 'help':
        await this.safeSend(chatId, T.HELP);
        return;
      case 'start':
        await this.safeSend(chatId, T.WELCOME('👋'));
        return;
      default:
        await this.safeSend(chatId, T.IDLE_PROMPT);
    }
  }

  private async startNew(chatId: number, _userId: number): Promise<void> {
    setConversationState(this.deps.db, chatId, 'WAITING_FOR_IMAGE', {});
    await this.safeSend(chatId, T.NEW_PRODUCT_PROMPT);
  }

  // ------------------------------------------------------------------
  // Image step
  // ------------------------------------------------------------------

  private async handlePhoto(chatId: number, userId: number, photo: TelegramPhoto): Promise<void> {
    const cs = getConversationState(this.deps.db, chatId);
    if (cs.state !== 'IDLE' && cs.state !== 'WAITING_FOR_IMAGE') {
      await this.safeSend(chatId, T.BUSY_FLOW);
      return;
    }

    const mimeType = photo.mime_type ?? 'image/jpeg';
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
      await this.safeSend(chatId, T.UNSUPPORTED_MESSAGE);
      return;
    }
    const maxBytes = this.deps.config.storage.maxImageMb * 1024 * 1024;
    if (photo.file_size !== undefined && photo.file_size > maxBytes) {
      await this.safeSend(chatId, `⚠️ حجم الصورة كبير (الحد الأقصى ${this.deps.config.storage.maxImageMb} ميجا).`);
      return;
    }

    let buffer: Buffer;
    try {
      const file = await this.deps.telegram.getFile(photo.file_id);
      if (!file.file_path) throw new Error('Telegram did not return a file path');
      buffer = await this.deps.telegram.downloadFile(file.file_path);
    } catch (err) {
      this.deps.logger.error('failed to download image from telegram', { err: String(err) });
      await this.safeSend(chatId, '⚠️ تعذر تحميل الصورة. حاول مرة أخرى.');
      return;
    }

    let saved: { path: string; url: string; filename: string };
    try {
      saved = this.deps.media.saveImage(buffer, mimeType, maxBytes);
    } catch (err) {
      if (err instanceof MediaError) {
        await this.safeSend(
          chatId,
          err.message === 'image too large'
            ? `⚠️ حجم الصورة كبير (الحد الأقصى ${this.deps.config.storage.maxImageMb} ميجا).`
            : '⚠️ نوع الصورة غير مدعوم. أرسل JPG أو PNG أو WEBP.',
        );
      } else {
        await this.safeSend(chatId, '⚠️ حدث خطأ أثناء حفظ الصورة.');
      }
      return;
    }

    const data: ChatStateData = {
      image: { path: saved.path, fileId: photo.file_id, url: saved.url, mimeType },
    };
    setConversationState(this.deps.db, chatId, 'WAITING_FOR_PRICE_STOCK', data);
    addLog(this.deps.db, {
      action: 'PRODUCT_RECEIVED',
      chatId,
      telegramUserId: userId,
      meta: { image: saved.url, mimeType },
    });
    await this.safeSend(chatId, T.IMAGE_RECEIVED);
  }

  // ------------------------------------------------------------------
  // Price / stock step → AI analysis (1 call)
  // ------------------------------------------------------------------

  private async handleText(chatId: number, userId: number, text: string): Promise<void> {
    const trimmed = text.trim();
    const command = trimmed.match(/^\/([a-zA-Z]+)(@\w+)?$/)?.[1]?.toLowerCase();
    if (command) return this.handleCommand(chatId, userId, command);

    const cs = getConversationState(this.deps.db, chatId);

    switch (cs.state) {
      case 'WAITING_FOR_PRICE_STOCK':
      case 'ERROR': {
        if (cs.state === 'ERROR' && !cs.data.retryAfterAiError) {
          setConversationState(this.deps.db, chatId, 'IDLE', {});
          await this.safeSend(chatId, T.IDLE_PROMPT);
          return;
        }
        const image = cs.data.image;
        if (!image) {
          setConversationState(this.deps.db, chatId, 'IDLE', {});
          await this.safeSend(chatId, T.NO_IMAGE);
          return;
        }
        const parsed = parsePriceStock(trimmed);
        if (!parsed.ok) {
          await this.safeSend(chatId, T.PRICE_STOCK_INVALID);
          return;
        }
        addLog(this.deps.db, {
          action: 'PRICE_STOCK_RECEIVED',
          chatId,
          telegramUserId: userId,
          meta: { price: parsed.value.price, stock: parsed.value.stock },
        });
        if (!this.deps.limiter.allow(`ai:${chatId}`, this.deps.config.rateLimits.aiPerChatPerHour, 3_600_000)) {
          addLog(this.deps.db, { action: 'RATE_LIMITED', chatId, telegramUserId: userId, meta: { scope: 'ai' } });
          await this.safeSend(chatId, T.AI_RATE_LIMITED);
          return;
        }
        await this.runAnalysis(chatId, userId, image, parsed.value);
        return;
      }

      case 'EDITING': {
        await this.applyEdit(chatId, userId, trimmed);
        return;
      }

      default: {
        await this.safeSend(chatId, T.IDLE_PROMPT);
        return;
      }
    }
  }

  /**
   * The single AI step. With `existingDraftId` it is the explicit
   * re-analyze path (updates the draft in place).
   */
  private async runAnalysis(
    chatId: number,
    userId: number,
    image: StoredImage,
    priceStock: PriceStock,
    existingDraftId?: string,
  ): Promise<void> {
    const data: ChatStateData = {
      image,
      price: priceStock.price,
      stock: priceStock.stock,
      ...(existingDraftId ? { draftId: existingDraftId } : {}),
    };
    setConversationState(this.deps.db, chatId, 'ANALYZING', data);
    await this.safeSend(chatId, existingDraftId ? T.REANALYZING : T.ANALYZING);
    addLog(this.deps.db, {
      action: 'AI_ANALYSIS_STARTED',
      chatId,
      telegramUserId: userId,
      draftId: existingDraftId ?? undefined,
    });

    let analysis: AiAnalysis;
    try {
      const buffer = readFileSync(image.path);
      analysis = await this.deps.analyzer.analyze({
        imageBase64: buffer.toString('base64'),
        mimeType: image.mimeType,
        price: priceStock.price,
        stock: priceStock.stock,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.error('ai analysis failed', { err: message, chatId, draftId: existingDraftId ?? null });
      addLog(this.deps.db, {
        action: 'AI_ANALYSIS_FAILED',
        chatId,
        telegramUserId: userId,
        draftId: existingDraftId ?? undefined,
        error: message,
      });
      if (existingDraftId) {
        // Re-analyze failed: the draft is untouched.
        setConversationState(this.deps.db, chatId, 'PENDING_APPROVAL', { ...data, draftId: existingDraftId });
        await this.safeSend(chatId, T.REANALYZE_ERROR);
      } else {
        setConversationState(this.deps.db, chatId, 'ERROR', { ...data, retryAfterAiError: true });
        await this.safeSend(chatId, T.ANALYSIS_ERROR);
      }
      return;
    }

    addLog(this.deps.db, {
      action: 'AI_ANALYSIS_COMPLETED',
      chatId,
      telegramUserId: userId,
      draftId: existingDraftId ?? undefined,
    });

    const categoryId = matchCategory(analysis.category ?? '');

    if (existingDraftId) {
      updateDraftFields(this.deps.db, existingDraftId, {
        name: analysis.name,
        shortDescription: analysis.shortDescription,
        description: analysis.description,
        categoryId,
        brand: analysis.brand,
        color: analysis.color,
        ageRange: analysis.ageRange,
        features: analysis.features,
        keywords: analysis.keywords,
      });
      incrementAiCallCount(this.deps.db, existingDraftId);
      addLog(this.deps.db, {
        action: 'DRAFT_UPDATED',
        chatId,
        telegramUserId: userId,
        draftId: existingDraftId,
        meta: { reason: 'reanalyze' },
      });
    } else {
      const draftId = randomUUID();
      createDraft(this.deps.db, {
        id: draftId,
        telegramUserId: userId,
        chatId,
        imageUrl: image.url,
        imagePath: image.path,
        name: analysis.name,
        shortDescription: analysis.shortDescription,
        description: analysis.description,
        categoryId,
        price: priceStock.price,
        stock: priceStock.stock,
        brand: analysis.brand,
        color: analysis.color,
        ageRange: analysis.ageRange,
        features: analysis.features,
        keywords: analysis.keywords,
      });
      addLog(this.deps.db, {
        action: 'DRAFT_CREATED',
        chatId,
        telegramUserId: userId,
        draftId,
        meta: { categoryId: categoryId ?? null },
      });
      data.draftId = draftId;
    }

    setConversationState(this.deps.db, chatId, 'PENDING_APPROVAL', data);
    const draftId = data.draftId;
    if (draftId) await this.sendPreview(chatId, draftId);
  }

  // ------------------------------------------------------------------
  // Preview / approval
  // ------------------------------------------------------------------

  private async sendPreview(chatId: number, draftId: string): Promise<void> {
    const draft = findDraftById(this.deps.db, draftId);
    if (!draft) return;
    await this.safeSend(chatId, buildPreviewText(draft), draftButtons(draftId));
  }

  private async handleCallback(chatId: number, userId: number, callbackId: string, data: string): Promise<void> {
    const parts = data.split(':');
    const action = parts[0];
    const draftId = parts[1];
    const field = parts[2] as EditableField | undefined;
    try {
      switch (action) {
        case 'publish':
          await this.publish(chatId, userId, callbackId, draftId);
          return;
        case 'edit':
          await this.startEdit(chatId, userId, callbackId, draftId);
          return;
        case 'reanalyze':
          await this.reanalyze(chatId, userId, callbackId, draftId);
          return;
        case 'cancel':
          await this.cancel(chatId, userId, callbackId, draftId);
          return;
        case 'show':
          await this.showDraft(chatId, callbackId, draftId);
          return;
        case 'field':
          await this.startFieldEdit(chatId, userId, callbackId, draftId, field);
          return;
        case 'back':
          if (draftId) {
            await this.sendPreview(chatId, draftId);
            await this.safeAnswer(callbackId);
          }
          return;
        default:
          return;
      }
    } catch (err) {
      this.deps.logger.error('callback handling failed', { err: String(err), action, draftId: draftId ?? null });
      await this.safeAnswer(callbackId, '⚠️ حدث خطأ غير متوقع. حاول مجدداً.');
    }
  }

  /**
   * PUBLISH — explicit human approval, validated, idempotent:
   *   1. user authorization (already enforced before this point)
   *   2. draft exists
   *   3. draft status must be PENDING_APPROVAL (atomic claim)
   *   4. price / stock / image / required fields
   *   5. store call with idempotency key = draft id
   *   PUBLISHING → PUBLISHED only after the store confirms creation.
   */
  private async publish(
    chatId: number,
    userId: number,
    callbackId: string,
    draftId: string | undefined,
  ): Promise<void> {
    if (!draftId) return;
    const draft = findDraftById(this.deps.db, draftId);
    if (!draft) {
      await this.safeAnswer(callbackId, T.DRAFT_NOT_FOUND);
      return;
    }
    if (draft.status === 'PUBLISHED') {
      await this.safeAnswer(callbackId, T.PUBLISHED_ALREADY);
      return;
    }
    if (draft.status === 'CANCELLED') {
      await this.safeAnswer(callbackId, '⚠️ هذه المسودة ملغاة.');
      return;
    }
    if (draft.status === 'PUBLISHING') {
      // Double click / retry while the first attempt is in flight.
      await this.safeAnswer(callbackId, T.PUBLISH_IN_PROGRESS);
      return;
    }

    const missing: string[] = [];
    if (draft.price === null || draft.price <= 0) missing.push('السعر');
    if (draft.stock === null || draft.stock < 0) missing.push('المخزون');
    if (!draft.imageUrl) missing.push('الصورة');
    if (!draft.name) missing.push('الاسم');
    if (missing.length > 0) {
      await this.safeAnswer(callbackId, '⚠️');
      await this.safeSend(chatId, T.PUBLISH_VALIDATION(missing));
      return;
    }

    if (!this.deps.limiter.allow(`publish:${chatId}`, this.deps.config.rateLimits.publishPerChatPerHour, 3_600_000)) {
      addLog(this.deps.db, { action: 'RATE_LIMITED', chatId, telegramUserId: userId, meta: { scope: 'publish' } });
      await this.safeAnswer(callbackId, T.PUBLISH_RATE_LIMITED);
      return;
    }

    // Atomic claim — exactly one concurrent publish can win.
    if (!claimPublish(this.deps.db, draftId)) {
      await this.safeAnswer(callbackId, T.PUBLISH_IN_PROGRESS);
      return;
    }

    const cs = getConversationState(this.deps.db, chatId);
    setConversationState(this.deps.db, chatId, 'PUBLISHING', { ...cs.data, draftId });
    addLog(this.deps.db, { action: 'PUBLISH_STARTED', chatId, telegramUserId: userId, draftId });
    await this.safeSend(chatId, T.PUBLISHING);

    try {
      const created = await this.deps.store.createProduct(
        {
          nameAr: draft.name!,
          description: draft.description,
          categoryId: draft.categoryId,
          price: draft.price!,
          stock: draft.stock!,
          brand: draft.brand,
          ageGroup: draft.ageRange,
          images: [draft.imageUrl!],
          features: draft.features,
          tags: draft.keywords,
          sku: `OMR-AUTO-${draftId.slice(0, 8)}`,
          slug: `auto-${draftId.slice(0, 8)}`,
        },
        draftId, // idempotency key = draft id
      );
      markPublished(this.deps.db, draftId, created.id, created.url);
      setConversationState(this.deps.db, chatId, 'PUBLISHED', { ...cs.data, draftId });
      addLog(this.deps.db, {
        action: 'PRODUCT_PUBLISHED',
        chatId,
        telegramUserId: userId,
        draftId,
        productId: created.id,
      });
      const link = created.url ?? `${this.deps.config.store.storeBaseUrl}/#product=${created.id}`;
      await this.safeAnswer(callbackId, '✅');
      await this.safeSend(chatId, T.PUBLISH_SUCCESS(link));
    } catch (err) {
      const message = err instanceof StoreApiError ? err.message : `unexpected error: ${String(err)}`;
      this.deps.logger.error('publish failed', { err: message, draftId });
      revertPublish(this.deps.db, draftId, message);
      setConversationState(this.deps.db, chatId, 'PENDING_APPROVAL', { ...cs.data, draftId });
      addLog(this.deps.db, {
        action: 'PUBLISH_FAILED',
        chatId,
        telegramUserId: userId,
        draftId,
        error: message,
      });
      await this.safeAnswer(callbackId, '⚠️');
      await this.safeSend(chatId, T.PUBLISH_FAILED);
    }
  }

  // ------------------------------------------------------------------
  // Editing (code only — no AI)
  // ------------------------------------------------------------------

  private async startEdit(
    chatId: number,
    _userId: number,
    callbackId: string,
    draftId: string | undefined,
  ): Promise<void> {
    if (!draftId) return;
    const draft = findDraftById(this.deps.db, draftId);
    if (!draft) {
      await this.safeAnswer(callbackId, T.DRAFT_NOT_FOUND);
      return;
    }
    if (draft.status !== 'PENDING_APPROVAL') {
      await this.safeAnswer(
        callbackId,
        draft.status === 'PUBLISHED' ? T.PUBLISHED_ALREADY : '⚠️ لا يمكن التعديل حالياً.',
      );
      return;
    }
    const cs = getConversationState(this.deps.db, chatId);
    setConversationState(this.deps.db, chatId, 'EDITING', { ...cs.data, draftId });
    await this.safeAnswer(callbackId, '📝');
    await this.safeSend(chatId, T.EDIT_MENU_INTRO, editMenuButtons(draftId));
  }

  private async startFieldEdit(
    chatId: number,
    _userId: number,
    callbackId: string,
    draftId: string | undefined,
    field: EditableField | undefined,
  ): Promise<void> {
    if (!draftId || !field || !EDITABLE_FIELDS.includes(field)) {
      await this.safeAnswer(callbackId);
      return;
    }
    const draft = findDraftById(this.deps.db, draftId);
    if (!draft || draft.status !== 'PENDING_APPROVAL') {
      await this.safeAnswer(callbackId, T.DRAFT_NOT_FOUND);
      return;
    }
    const cs = getConversationState(this.deps.db, chatId);
    setConversationState(this.deps.db, chatId, 'EDITING', { ...cs.data, draftId, editingField: field });
    await this.safeAnswer(callbackId);
    await this.safeSend(chatId, T.EDIT_PROMPT[field]);
  }

  private async applyEdit(chatId: number, userId: number, text: string): Promise<void> {
    const cs = getConversationState(this.deps.db, chatId);
    const field = cs.data.editingField;
    const draftId = cs.data.draftId;

    if (!field || !draftId) {
      if (draftId) {
        const draft = findDraftById(this.deps.db, draftId);
        if (draft && draft.status === 'PENDING_APPROVAL') {
          await this.safeSend(chatId, T.EDIT_MENU_INTRO, editMenuButtons(draftId));
        } else {
          setConversationState(this.deps.db, chatId, 'IDLE', {});
          await this.safeSend(chatId, T.IDLE_PROMPT);
        }
      } else {
        setConversationState(this.deps.db, chatId, 'IDLE', {});
        await this.safeSend(chatId, T.IDLE_PROMPT);
      }
      return;
    }

    const draft = findDraftById(this.deps.db, draftId);
    if (!draft || draft.status !== 'PENDING_APPROVAL') {
      setConversationState(this.deps.db, chatId, 'IDLE', {});
      await this.safeSend(chatId, T.DRAFT_NOT_FOUND);
      return;
    }

    let confirmation: string;
    switch (field) {
      case 'price': {
        const parsed = parseField(text, 'price');
        if (!parsed.ok) {
          await this.safeSend(chatId, T.EDIT_INVALID(parsed.hint));
          return;
        }
        updateDraftFields(this.deps.db, draftId, { price: parsed.value as number });
        confirmation = `✅ تم تحديث السعر إلى ${parsed.value} جنيه.`;
        break;
      }
      case 'stock': {
        const parsed = parseField(text, 'stock');
        if (!parsed.ok) {
          await this.safeSend(chatId, T.EDIT_INVALID(parsed.hint));
          return;
        }
        updateDraftFields(this.deps.db, draftId, { stock: parsed.value as number });
        confirmation = `✅ تم تحديث المخزون إلى ${parsed.value}.`;
        break;
      }
      case 'name': {
        const parsed = parseField(text, 'name');
        if (!parsed.ok) {
          await this.safeSend(chatId, T.EDIT_INVALID(parsed.hint));
          return;
        }
        updateDraftFields(this.deps.db, draftId, { name: parsed.value as string });
        confirmation = '✅ تم تحديث الاسم.';
        break;
      }
      case 'description': {
        const parsed = parseField(text, 'description');
        if (!parsed.ok) {
          await this.safeSend(chatId, T.EDIT_INVALID(parsed.hint));
          return;
        }
        updateDraftFields(this.deps.db, draftId, { description: parsed.value as string });
        confirmation = '✅ تم تحديث الوصف.';
        break;
      }
      case 'category': {
        const categoryId = matchCategory(text);
        updateDraftFields(this.deps.db, draftId, { categoryId });
        confirmation = categoryId
          ? `✅ تم تحديث التصنيف إلى ${getCategoryDisplayName(categoryId)}.`
          : '⚠️ لم يتم العثور على تصنيف مطابق — تم ترك التصنيف بدون تحديد.';
        break;
      }
    }

    addLog(this.deps.db, {
      action: 'DRAFT_UPDATED',
      chatId,
      telegramUserId: userId,
      draftId,
      meta: { field },
    });
    const data: ChatStateData = { ...cs.data, draftId };
    data.editingField = undefined;
    setConversationState(this.deps.db, chatId, 'PENDING_APPROVAL', data);
    await this.safeSend(chatId, confirmation);
    await this.sendPreview(chatId, draftId);
  }

  // ------------------------------------------------------------------
  // Re-analyze (explicit extra AI call) / cancel / pending list
  // ------------------------------------------------------------------

  private async reanalyze(
    chatId: number,
    userId: number,
    callbackId: string,
    draftId: string | undefined,
  ): Promise<void> {
    if (!draftId) return;
    const draft = findDraftById(this.deps.db, draftId);
    if (!draft) {
      await this.safeAnswer(callbackId, T.DRAFT_NOT_FOUND);
      return;
    }
    if (draft.status !== 'PENDING_APPROVAL') {
      await this.safeAnswer(
        callbackId,
        draft.status === 'PUBLISHED' ? T.PUBLISHED_ALREADY : '⚠️ لا يمكن إعادة التحليل حالياً.',
      );
      return;
    }
    if (!this.deps.limiter.allow(`ai:${chatId}`, this.deps.config.rateLimits.aiPerChatPerHour, 3_600_000)) {
      addLog(this.deps.db, { action: 'RATE_LIMITED', chatId, telegramUserId: userId, meta: { scope: 'ai' } });
      await this.safeAnswer(callbackId, T.AI_RATE_LIMITED);
      return;
    }
    const cs = getConversationState(this.deps.db, chatId);
    if (!draft.imagePath || !existsSync(draft.imagePath)) {
      await this.safeAnswer(callbackId, '⚠️ ملف الصورة غير متاح.');
      return;
    }
    if (draft.price === null || draft.price <= 0) {
      await this.safeAnswer(callbackId, '⚠️ السعر غير صالح.');
      return;
    }
    const image: StoredImage = {
      path: draft.imagePath,
      fileId: cs.data.image?.fileId ?? '',
      url: draft.imageUrl ?? '',
      mimeType: cs.data.image?.mimeType ?? 'image/jpeg',
    };
    await this.safeAnswer(callbackId, '🔄');
    await this.runAnalysis(chatId, userId, image, { price: draft.price, stock: draft.stock ?? 0 }, draftId);
  }

  private async cancel(chatId: number, userId: number, callbackId: string, draftId: string | undefined): Promise<void> {
    if (!draftId) return;
    const draft = findDraftById(this.deps.db, draftId);
    if (!draft) {
      await this.safeAnswer(callbackId, T.DRAFT_NOT_FOUND);
      return;
    }
    if (draft.status === 'PUBLISHED') {
      await this.safeAnswer(callbackId, T.PUBLISHED_ALREADY);
      return;
    }
    if (draft.status === 'PUBLISHING') {
      await this.safeAnswer(callbackId, '⚠️ جاري النشر حالياً.');
      return;
    }
    if (draft.status === 'CANCELLED') {
      await this.safeAnswer(callbackId, '⚠️ المسودة ملغاة بالفعل.');
      return;
    }
    if (!cancelDraft(this.deps.db, draftId)) {
      await this.safeAnswer(callbackId, '⚠️ تعذر إلغاء المسودة.');
      return;
    }
    const cs = getConversationState(this.deps.db, chatId);
    setConversationState(this.deps.db, chatId, 'CANCELLED', { ...cs.data, draftId });
    addLog(this.deps.db, { action: 'DRAFT_CANCELLED', chatId, telegramUserId: userId, draftId });
    await this.safeAnswer(callbackId, '🗑️');
    await this.safeSend(chatId, T.DRAFT_CANCELLED);
  }

  private async showDraft(chatId: number, callbackId: string, draftId: string | undefined): Promise<void> {
    if (!draftId) return;
    const draft = findDraftById(this.deps.db, draftId);
    if (!draft || draft.status !== 'PENDING_APPROVAL') {
      await this.safeAnswer(callbackId, T.DRAFT_NOT_FOUND);
      return;
    }
    await this.safeAnswer(callbackId);
    await this.sendPreview(chatId, draftId);
  }

  private async listPending(chatId: number, userId: number): Promise<void> {
    const drafts = findPendingDraftsByUser(this.deps.db, userId);
    if (drafts.length === 0) {
      await this.safeSend(chatId, T.NO_PENDING);
      return;
    }
    const lines = ['📋 مسوداتك قيد الانتظار:', ''];
    drafts.forEach((d, i) => {
      lines.push(`${i + 1}. ${d.name ?? '—'} — ${d.price ?? '?'} جنيه`);
    });
    lines.push('', 'اضغط على أي مسودة لعرضها:');
    await this.safeSend(chatId, lines.join('\n'), {
      replyMarkup: {
        inline_keyboard: drafts
          .slice(0, 10)
          .map((d) => [{ text: `📄 ${truncate(d.name ?? 'مسودة', 40)}`, callback_data: `show:${d.id}` }]),
      },
    });
  }

  // ------------------------------------------------------------------
  // Safe Telegram senders (never crash the flow on Telegram errors)
  // ------------------------------------------------------------------

  private async safeSend(chatId: number, text: string, options?: SendMessageOptions): Promise<void> {
    try {
      await this.deps.telegram.sendMessage(chatId, text, options);
    } catch (err) {
      this.deps.logger.error('telegram sendMessage failed', { err: String(err), chatId });
    }
  }

  private async safeAnswer(callbackId: string, text?: string): Promise<void> {
    try {
      await this.deps.telegram.answerCallbackQuery(callbackId, text);
    } catch (err) {
      this.deps.logger.error('telegram answerCallbackQuery failed', { err: String(err) });
    }
  }
}
