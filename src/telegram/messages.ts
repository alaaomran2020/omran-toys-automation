import type { ProductDraft } from '../db/repositories/drafts.js';
import { getCategoryDisplayName } from '../core/categoryMatcher.js';
import type { SendMessageOptions } from './client.js';

/** Arabic text templates (bot UI). */
export const T = {
  WELCOME: (username: string) =>
    `أهلاً ${username} 👋\n\nبوت إضافة المنتجات لمتجر Omran Toys.\n\nابدأ بإضافة منتج جديد:\n/new`,
  HELP: [
    '📖 دليل الاستخدام',
    '',
    '/new — بدء إضافة منتج جديد',
    '/pending — عرض مسوداتك قيد الانتظار',
    '/help — هذه الرسالة',
    '',
    'الخطوات:',
    '1️⃣ أرسل /new',
    '2️⃣ أرسل صورة المنتج',
    '3️⃣ أرسل السعر والكمية بصيغة: 350 - 8',
    '4️⃣ انتظر تحليل الذكاء الاصطناعي',
    '5️⃣ راجع المعاينة واضغط ✅ نشر المنتج',
  ].join('\n'),
  NEW_PRODUCT_PROMPT: '📦 أرسل صورة المنتج.',
  IMAGE_RECEIVED: 'تم استلام الصورة ✅\n\nأرسل السعر والكمية بهذا الشكل:\n\n350 - 8',
  PRICE_STOCK_INVALID:
    '⚠️ لم أفهم السعر والكمية.\n\nأرسلهما بهذا الشكل:\n\n350 - 8\n\n(السعر أولاً ثم الكمية، والسعر يجب أن يكون أكبر من صفر)',
  ANALYZING: '⏳ جاري تحليل المنتج بالذكاء الاصطناعي…',
  ANALYSIS_ERROR:
    '⚠️ حدث خطأ أثناء تحليل المنتج.\n\nيمكنك المحاولة مرة أخرى بإرسال السعر والكمية مجدداً.\nأو ابدأ منتجاً جديداً بـ /new.',
  REANALYZING: '⏳ جاري إعادة تحليل المنتج…',
  REANALYZE_ERROR: '⚠️ تعذرت إعادة التحليل. لم يتغير شيء — يمكنك المحاولة مرة أخرى من الزر.',
  PUBLISHING: '⏳ جاري نشر المنتج في المتجر…',
  PUBLISH_SUCCESS: (url: string) => `✅ تم نشر المنتج بنجاح\n\n🔗 رابط المنتج:\n${url}`,
  PUBLISH_FAILED: '⚠️ تعذر نشر المنتج.\n\nتم الاحتفاظ بالمسودة — يمكنك المحاولة مرة أخرى من زر ✅ نشر المنتج.',
  PUBLISH_IN_PROGRESS: '⏳ جاري النشر حالياً…',
  PUBLISH_VALIDATION: (fields: string[]) =>
    `⚠️ لا يمكن النشر، الحقول التالية ناقصة: ${fields.join('، ')}.\n\nاستخدم ✏️ تعديل لإصلاحها.`,
  PUBLISHED_ALREADY: '✅ هذا المنتج منشور بالفعل.',
  DRAFT_CANCELLED: '🗑️ تم إلغاء المسودة.',
  DRAFT_NOT_FOUND: '⚠️ المسودة غير موجودة أو تم حذفها.',
  EDIT_MENU_INTRO: '📝 اختر الحقل الذي تريد تعديله (التعديلات تتم مباشرة بدون ذكاء اصطناعي):',
  EDIT_PROMPT: {
    name: '✏️ أرسل الاسم الجديد:',
    price: '✏️ أرسل السعر الجديد (رقم أكبر من صفر):',
    stock: '✏️ أرسل المخزون الجديد (رقم صفر أو أكبر):',
    description: '✏️ أرسل الوصف الجديد:',
    category: '✏️ أرسل اسم التصنيف (مثال: تحكم عن بعد):',
  },
  EDIT_INVALID: (hint: string) => `⚠️ قيمة غير صالحة.\n${hint}`,
  CANCELLED_MESSAGE: '🗑️ تم إلغاء المسودة.',
  BUSY_FLOW: 'لديك عملية جارية بالفعل.\nأكملها أو ابدأ منتجاً جديداً بـ /new.',
  NO_IMAGE: 'لم أجد صورة محفوظة لهذه العملية.\nابدأ من جديد بـ /new.',
  IDLE_PROMPT: 'أرسل /new لبدء إضافة منتج جديد.',
  NO_PENDING: 'لا توجد مسودات قيد الانتظار.\n\nابدأ منتجاً جديداً بـ /new.',
  AI_RATE_LIMITED: '⚠️ تم تجاوز حد عمليات التحليل المسموح هذا الوقت. حاول بعد قليل.',
  PUBLISH_RATE_LIMITED: '⚠️ تم تجاوز حد عمليات النشر المسموح هذا الوقت. حاول بعد قليل.',
  WEBHOOK_RATE_LIMITED: '⏳ وصلتني طلبات كثيرة في وقت قصير. حاول بعد ثوانٍ.',
  UNSUPPORTED_MESSAGE: 'أرسل صورة المنتج فقط (JPG/PNG/WEBP).',
} as const;

/** Product draft preview (spec: PHASE 8). */
export function buildPreviewText(draft: ProductDraft): string {
  const categoryName = draft.categoryId ? getCategoryDisplayName(draft.categoryId) : '—';
  return [
    '🛍️ منتج جديد جاهز',
    '',
    '📦 الاسم:',
    draft.name ?? '—',
    '',
    '💰 السعر:',
    `${draft.price ?? '—'} جنيه`,
    '',
    '📊 المخزون:',
    String(draft.stock ?? '—'),
    '',
    '🏷️ التصنيف:',
    categoryName,
    '',
    '📝 الوصف:',
    draft.shortDescription ?? draft.description ?? '—',
  ].join('\n');
}

/** Inline keyboard for a pending draft (spec buttons). */
export function draftButtons(draftId: string): SendMessageOptions {
  return {
    replyMarkup: {
      inline_keyboard: [
        [{ text: '✅ نشر المنتج', callback_data: `publish:${draftId}` }],
        [
          { text: '✏️ تعديل', callback_data: `edit:${draftId}` },
          { text: '🔄 إعادة تحليل', callback_data: `reanalyze:${draftId}` },
        ],
        [{ text: '❌ إلغاء', callback_data: `cancel:${draftId}` }],
      ],
    },
  };
}

/** Inline keyboard for the edit menu (spec: PHASE 11). */
export function editMenuButtons(draftId: string): SendMessageOptions {
  const field = (field: string): Record<string, string> => ({
    text: { name: 'الاسم', price: 'السعر', stock: 'المخزون', description: 'الوصف', category: 'التصنيف' }[field]!,
    callback_data: `field:${draftId}:${field}`,
  });
  return {
    replyMarkup: {
      inline_keyboard: [
        [field('name'), field('price'), field('stock')],
        [field('description'), field('category')],
        [{ text: '🔙 رجوع', callback_data: `back:${draftId}` }],
      ],
    },
  };
}

export function previewMessageOptions(draftId: string): SendMessageOptions {
  return draftButtons(draftId);
}
