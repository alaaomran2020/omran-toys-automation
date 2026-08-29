#  Omran Toys Automation

نظام أتمتة مستقل لإضافة المنتجات إلى متجر [Omran Toys](https://omrantoys.store) عبر **Telegram + AI** — بأقل عدد خطوات ممكنة للموظف، ومع **موافقة بشرية إلزامية** قبل أي نشر.

```
الموظف → Telegram Bot → صورة + "350 - 8" → AI (مكالمة واحدة)
      → Product Draft → Preview → ✅ موافقة → Secure Store API
      → منتج حقيقي في المتجر → رابط المنتج في Telegram
```

**الاستراتيجية (Cost Policy):**
- كل منتج = **AI Call واحد** فقط (الـ Re-analyze يدوي هو الاستثناء الوحيد).
- السعر/المخزون/التصنيف/الحالة/النشر = **كود فقط، بدون AI**.
- لا Redis، لا Kafka، لا Microservices — خدمة واحدة بسيطة + SQLite.

---

## 📁 Project Overview

| المكون | التقنية | لماذا |
|---|---|---|
| Runtime | Node.js ≥ 22.5 | `node:sqlite` مدمج — صفر تبعيات native |
| Language | TypeScript (strict) | أمان أنواع في النظام الحرج |
| HTTP | Fastify 5 | خفيف، Logger مدمج، مناسب لخدمة Webhook |
| Database | SQLite (WAL) | أبسط persistence موثوق لخدمة أحادية العملية |
| AI | OpenAI Vision (gpt-4o-mini افتراضي) | أرخص نموذج كافٍ، JSON mode |
| Telegram | Bot API خام (fetch) | لا SDK — 4 دوال فقط |
| Store | Cloudflare Worker + D1 | البنية الموجودة مسبقًا في المتجر |

### Architecture

```
Telegram Layer            (src/telegram/)  — interface فقط، يمكن استبدالها بـ WhatsApp لاحقًا
      ↓
Webhook Layer             POST /api/telegram/webhook — secret_token + dedup
      ↓
Authentication            whitelist (TELEGRAM_ADMIN_IDS) — كل ما بعدها محمي
      ↓
Conversation / State      State machine مدمج في SQLite (per chat)
      ↓
Product Workflow          (src/core/workflow.ts) — Product Automation Core
      ↓
AI Service                (src/ai/) — مكالمة واحدة، prompt صارم، parsing دفاعي
      ↓
Draft Service             (src/db/repositories/drafts.ts) — PENDING_APPROVAL
      ↓
Approval Service          أزرار: نشر / تعديل / إعادة تحليل / إلغاء
      ↓
Store Integration         (src/store/client.ts) — HMAC + idempotency
      ↓
Omran Toys Store          Worker API + D1 (مجلد store-integration/)
```

**فصل صارم:** هذا الـ Repository لا يحتوي أي نسخة من قاعدة بيانات المتجر ولا أي منطق متجر — فقط حالة الأتمتة (المستخدمون، المحادثات، المسودات، السجلات). المتجر هو نظام السجل الوحيد للمنتجات.

---

## 🚀 Setup

### المتطلبات

- Node.js ≥ 22.5
- Telegram Bot Token (من @BotFather)
- OpenAI API Key
- حساب Cloudflare + D1 database (لنشر واجهة المتجر — انظر [store-integration/README.md](store-integration/README.md))

### التثبيت

```bash
git clone https://github.com/alaaomran2020/omran-toys-automation.git
cd omran-toys-automation
npm install
cp .env.example .env
# املأ .env بقيم حقيقية (انظر الجدول أدناه)
npm run dev          # التطوير
npm run build && npm start   # الإنتاج
```

### Environment Variables

| المتغير | إلزامي (prod) | الوصف |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | من @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | ✅ | سر عشوائي طويل — Telegram يرسله مع كل طلب |
| `TELEGRAM_ADMIN_IDS` | ✅ | IDs المستخدمين المسموحين، مفصولة بفواصل `123,456` |
| `OPENAI_API_KEY` | ✅ | مفتاح OpenAI |
| `OPENAI_MODEL` | — | افتراضي `gpt-4o-mini` |
| `OPENAI_BASE_URL` | — | لأي مزود متوافق |
| `STORE_API_URL` | ✅ | مثل `https://omrantoys.store` |
| `STORE_API_KEY` | ✅ | سر `wrangler secret put` في المتجر |
| `STORE_API_SECRET` | ✅ | سر `wrangler secret put` في المتجر |
| `STORE_BASE_URL` | — | افتراضي `https://omrantoys.store` (لروابط المنتجات) |
| `PUBLIC_BASE_URL` | ✅ | العنوان العام HTTPS لهذا النظام (يُرسل للمتجر كروابط صور) |
| `PORT` / `HOST` | — | 3000 / 0.0.0.0 |
| `DATABASE_PATH` | — | افتراضي `./data/automation.db` |
| `STORAGE_DIR` | — | افتراضي `./storage` |
| `MAX_IMAGE_MB` | — | 10 |
| `AI_CALLS_PER_CHAT_PER_HOUR` | — | 5 (حماية من loops) |
| `PUBLISH_ATTEMPTS_PER_CHAT_PER_HOUR` | — | 20 |

> ⛔ لا توجد أي قيم حقيقية في Git — فقط `.env.example`.

### Telegram Bot Setup

1. @BotFather → `/newbot` → انسخ الـ Token إلى `TELEGRAM_BOT_TOKEN`.
2. احصل على **User ID** الخاص بك: تحدث إلى البوت ثم افتح
   `https://api.telegram.org/bot<TOKEN>/getUpdates` — ستجد `"id": 123456789`.
3. أضف الـ ID (فواصل بين عدة موظفين) إلى `TELEGRAM_ADMIN_IDS`.

### Webhook Setup

النظام يحتاج عنوان **HTTPS عام** (متطلب Telegram):

```bash
# بعد نشر الخدمة على عنوان عام:
echo "PUBLIC_BASE_URL=https://automation.omrantoys.store" >> .env
echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
npm run webhook:setup
```

الأمر يسجل: `POST https://<PUBLIC_BASE_URL>/api/telegram/webhook` مع
`secret_token` (تحقق ثابت الزمن) و`allowed_updates: [message, callback_query]`.

لحذف الـ webhook: `npm run webhook:setup -- --delete`.

> **اختبار محلي بدون إنترنت عام:** استخدم [ngrok](https://ngrok.com) أو
> Cloudflare Tunnel مؤقتًا ثم شغّل `npm run webhook:setup`.

### AI Setup

- `OPENAI_API_KEY` + `OPENAI_MODEL=gpt-4o-mini` (أرخص خيار كافٍ).
- الـ Prompt صارم (14 قاعدة: عربي، بدون اختلاق، null عند الضبابية، JSON فقط).
- الـ Response يُفحص دفاعيًا: JSON غير صالح → رسالة خطأ + إعادة محاولة آمنة،
  **ولا يُنشأ أي منتج أبدًا** من رد فاسد.

### Database Setup

لا يوجد ما تفعله — SQLite يُنشأ تلقائيًا مع مigrations عند الإقلاع:

```
telegram_users, conversation_states, product_drafts, automation_logs, webhook_updates
```

في Docker: حُجيم `automation-data` يحفظ `/data` (قاعدة البيانات + الصور).

### Store API Integration

المتجر حاليًا بلا API منتجات (الفحص أثبت أن الإضافة تتم في متصفح الأدمن فقط).
**مجلد [store-integration/](store-integration/README.md) يحتوي التنفيذ الكامل
جاهزًا للتطبيق على `omrantoys-store`:**

- Worker API: `POST /api/products` (HMAC + Idempotency) + catalog reads
- Migration واحدة: `products.idempotency_key` (فريد)
- تعديلان صغيران للـ SPA (دمج المنتجات المضافة + deep link `#product=<id>`)
- 10 اختبارات للـ Worker + SQL smoke test على D1 حقيقي

خطوات النشر: [store-integration/README.md](store-integration/README.md) ← قسم Installation / Deployment.

---

## 📖 كيف يعمل الموظف (User Flow)

```
/new
  ← "📦 أرسل صورة المنتج."
[صورة]
  ← "تم استلام الصورة ✅  أرسل السعر والكمية: 350 - 8"
350 - 8
  ← "⏳ جاري تحليل المنتج بالذكاء الاصطناعي…"
  ← Preview كامل + [✅ نشر] [✏️ تعديل] [🔄 إعادة تحليل] [❌ إلغاء]
✅ نشر المنتج
  ← "⏳ جاري نشر المنتج في المتجر…"
  ← "✅ تم نشر المنتج بنجاح  🔗 https://omrantoys.store/#product=<id>"
```

الأوامر: `/start` `/new` `/pending` `/help` — لا شيء آخر (MVP).

**قاعدة الصرامة:** لا نشر تلقائي إطلاقًا — النشر يتطلب ضغطة بشرية صريحة،
وتحقق كامل (صلاحيات → المسودة موجودة → الحالة → السعر → المخزون → الصورة
→ الحقول) قبل استدعاء المتجر.

---

## 💻 Development

```bash
npm run dev          # tsx watch
npm test             # كل الاختبارات (63+)
npm run typecheck    # tsc --noEmit
npm run lint         # biome
npm run build        # tsc → dist/
```

### هيكل الكود

```
src/
├── index.ts            # نقطة الإقلاع
├── config.ts           # env + تحقق صارم (fail-fast في production)
├── app.ts              # Fastify app (webhook + health + media)
├── lib/                # env loader, logger
├── db/                 # node:sqlite + migrations + repositories
│   └── repositories/   # users, states, drafts, logs, webhookUpdates
├── telegram/           # client خام, guards, webhook, رسائل عربية
├── core/
│   ├── workflow.ts     # Product Automation Core (منفصل عن Telegram)
│   ├── priceParser.ts  # كود فقط — بدون AI
│   ├── categoryMatcher.ts
│   ├── media.ts        # حفظ الصور + خدمة عامة
│   └── rateLimit.ts
├── ai/                 # provider, openai, prompt, parse (دفاعي)
└── store/              # StoreProductService (HMAC + idempotency)
tests/
├── unit/               # parser, matcher, states, AI parse, auth, rate
├── integration/        # webhook, store client, publish idempotency
├── e2e/                # سيناريو القبول الكامل (§43)
└── helpers/            # FakeTelegram, FakeAnalyzer, FakeStoreServer (HTTP حقيقي)
store-integration/      # Worker API الجاهز للمتجر + اختباره
```

## 🧪 Testing

```bash
npm test
```

| الطبقة | ما يُختبر |
|---|---|
| Unit | Price/Stock parser (كل صيغ + رفضات), Category matching, State machine, AI invalid-JSON, Authorization, Rate limiting |
| Integration | Webhook (secret, dedup, retry), مستخدم غير مصرح (لا AI/لا Store/لا DB حساسة), فشل AI + إعادة محاولة, تعديل بدون AI, إلغاء, Store client (HMAC/401/إعادة), **Double-click publish → منتج واحد**, Timeout+Retry → بلا تكرار |
| E2E | السيناريو الكامل: /new → صورة → 350 - 8 → **AI Call واحد** → Draft → Preview → نشر → منتج في المتجر → رابط حقيقي → المنتج يظهر في الكتالوج |

ملاحظة: اختبارات الـ store integration تعمل ضد **خادم HTTP حقيقي** يطابق عقد
المتجر (tests/helpers/fakeStoreServer.ts) — وكود الـ Worker نفسه له اختبارات
مستقلة في `store-integration/tests/`.

## 🚢 Deployment

```bash
# 1) الإعداد
cp .env.example .env   # + قيم حقيقية

# 2) Docker
docker compose up -d --build

# 3) Webhook
npm run webhook:setup

# 4) التحقق (Checklist)
curl https://<host>/health                    # 1) ok
# 2) مستخدم مصرح: /start في البوت
# 3) إرسال صورة → 4) السعر → 5) AI → 6) Draft
# 7) ضغط ✅ نشر → 8) تحقق من المتجر + فتح الرابط
```

بعد النشر تأكد من:
1. متغيرات البيئة ✅  2. تسجيل webhook ✅  3. التحقق منه (`getWebhookInfo`)
4. مستخدم مصرح ✅  5. رفع صورة ✅  6. AI ✅  7. Draft ✅  8. Approval
9. Store API ✅  10. **المنتج موجود فعلًا على omrantoys.store** ✅

##  Troubleshooting

| المشكلة | الحل |
|---|---|
| البوت لا يرد | `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` — تأكد أن `url` صحيح وبلا `last_error_message` |
| `403 unauthorized` من Telegram | `TELEGRAM_WEBHOOK_SECRET` في .env غير مطابق للـ secret المسجل — أعد `npm run webhook:setup` |
| `Access Denied` | ID المستخدم غير موجود في `TELEGRAM_ADMIN_IDS` |
| AI error متكرر | تحقق من `OPENAI_API_KEY` / الميزانية / `OPENAI_MODEL` — السجل: `SELECT * FROM automation_logs WHERE action='AI_ANALYSIS_FAILED'` |
| `store API timeout` | تحقق من `STORE_API_URL` + أن الـ Worker منشور (`/api/health`) + `wrangler secret` مضبوط — **المسودة محفوظة** والمحاولة التالية آمنة (idempotency) |
| المنتج نُشر مرتين؟ | مستحيل بنيويًا: حالة PUBLISHED تحجب + `idempotency_key` فريد في D1 — تحقق من `SELECT * FROM automation_logs WHERE action IN ('PUBLISH_STARTED','PRODUCT_PUBLISHED')` |
| الصور لا تُحمّل من المتجر | `PUBLIC_BASE_URL` يجب أن يكون HTTPS عامًا وقابلًا للوصول، والصور تُخدَم من `GET /api/media/<file>` |
| منتج جديد لا يظهر في المتجر | تأكد أن واجهة الـ SPA محدثة (دمج `fetchRemoteProducts`) وأن `GET /api/products` يعيده |
| SQLite locked | لا تشغّل خادمين على نفس `DATABASE_PATH` (خدمة أحادية العملية بالتصميم) |

### Logs

- HTTP: Fastify logger (JSON) — `level=info` في production.
- أحداث العمل: `automation_logs` (PRODUCT_RECEIVED, AI_ANALYSIS_*, DRAFT_*, PUBLISH_*, ...) — **لا يُسجل أي secret/tokens أبدًا**.
- تشغيلي: `docker compose logs -f automation`.

---

## 🔒 Security Summary

- Webhook: `secret_token` (constant-time) + dedup بـ `update_id`.
- Authorization: whitelist IDs — كل العمليات الحساسة خلف هذا الحاجز.
- AI: لا تُستخدم أبدًا في validation/auth/CRUD/parsing.
- Store: `x-api-key` + HMAC-SHA256 على الجسم الخام + idempotency.
- Secrets: env فقط، لا Git، لا Telegram، لا client.
- Rate limiting: webhook / AI / publish (ذاكرة، sliding window).
- صور: تحقق نوع + حجم + أسماء ملفات UUID فقط.
- No auto-publishing: موافقة بشرية صريحة دائمًا.

##  خارج نطاق MVP (مستقبلي)

WhatsApp / Instagram / Voice / توليد صور / إزالة خلفية / Bulk / AI Pricing /
Vector DB / RAG / نشر تلقائي — **معماريًا جاهز** لأن الـ Core منفصل عن الـ
Telegram Layer وسيتم إضافته كأدapters فوق نفس الـ Core.
