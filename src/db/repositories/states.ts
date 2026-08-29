import type { Db } from '../database.js';

/**
 * Persistent conversation state machine (per Telegram chat).
 *
 * States:
 *   IDLE → WAITING_FOR_IMAGE → WAITING_FOR_PRICE_STOCK → ANALYZING →
 *   PENDING_APPROVAL ⇄ EDITING / → PUBLISHING → PUBLISHED
 *   PENDING_APPROVAL → CANCELLED
 *   any → ERROR (recovery: resend price/stock to retry the AI step)
 */
export const CHAT_STATES = [
  'IDLE',
  'WAITING_FOR_IMAGE',
  'WAITING_FOR_PRICE_STOCK',
  'ANALYZING',
  'PENDING_APPROVAL',
  'EDITING',
  'PUBLISHING',
  'PUBLISHED',
  'CANCELLED',
  'ERROR',
] as const;

export type ChatState = (typeof CHAT_STATES)[number];

export type EditableField = 'name' | 'price' | 'stock' | 'description' | 'category';

export interface StoredImage {
  path: string;
  fileId: string;
  url: string;
  mimeType: string;
}

export interface ChatStateData {
  image?: StoredImage;
  price?: number;
  stock?: number;
  draftId?: string;
  editingField?: EditableField;
  /** When true (state=ERROR) the next price/stock message retries the AI step. */
  retryAfterAiError?: boolean;
}

export interface ConversationState {
  chatId: number;
  state: ChatState;
  data: ChatStateData;
  updatedAt: string;
}

/**
 * Valid state transitions. A transition to IDLE is always allowed
 * (workflow restart via /new).
 */
const TRANSITIONS: Record<ChatState, ChatState[]> = {
  IDLE: ['WAITING_FOR_IMAGE'],
  WAITING_FOR_IMAGE: ['WAITING_FOR_PRICE_STOCK', 'ERROR'],
  WAITING_FOR_PRICE_STOCK: ['ANALYZING', 'ERROR'],
  ANALYZING: ['PENDING_APPROVAL', 'ERROR', 'WAITING_FOR_PRICE_STOCK'],
  PENDING_APPROVAL: ['EDITING', 'ANALYZING', 'PUBLISHING', 'CANCELLED'],
  EDITING: ['PENDING_APPROVAL'],
  PUBLISHING: ['PUBLISHED', 'PENDING_APPROVAL'],
  PUBLISHED: [],
  CANCELLED: [],
  ERROR: ['WAITING_FOR_PRICE_STOCK'],
};

export function canTransition(from: ChatState, to: ChatState): boolean {
  if (to === 'IDLE') return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

export function getConversationState(db: Db, chatId: number): ConversationState {
  const row = db.prepare('SELECT * FROM conversation_states WHERE chat_id = ?').get(chatId) as
    | Record<string, unknown>
    | undefined;
  if (!row) {
    return { chatId, state: 'IDLE', data: {}, updatedAt: '' };
  }
  let data: ChatStateData = {};
  try {
    const parsed = JSON.parse(String(row.data));
    if (parsed && typeof parsed === 'object') data = parsed as ChatStateData;
  } catch {
    data = {};
  }
  return { chatId, state: String(row.state) as ChatState, data, updatedAt: String(row.updated_at) };
}

export function setConversationState(db: Db, chatId: number, state: ChatState, data: ChatStateData = {}): void {
  db.prepare(
    `INSERT INTO conversation_states (chat_id, state, data, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(chat_id) DO UPDATE SET
       state = excluded.state,
       data = excluded.data,
       updated_at = datetime('now')`,
  ).run(chatId, state, JSON.stringify(data));
}
