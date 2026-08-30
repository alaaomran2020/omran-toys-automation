# 🚀 دليل النشر الكامل — Omran Toys Automation

هذا الدليل يلخّص كل خطوات النشر بعد أن تحقّقنا محلياً من جاهزية الكود.
**كل الأوامر هنا تشغّلها أنت على جهازك** (حيث لديك صلاحيات Cloudflare وGitHub للـ store).

> ✅ **تم التحقق منه في هذا الجلسة:**
> - اختبارات خادم الأتمتة: 63/63
> - اختبارات Worker المتجر: 10/10
> - `vite build` للمتجر: ✅ ينجح
> - Migration `001` على محرك D1 حقيقي: ✅
> - Idempotency (تجنّب التكرار): ✅ المنتج يُدرج مرة واحدة فقط

---

## المرحلة 1 — نشر API المتجر على Cloudflare (Worker + D1)

### 1.1 أعد الملفات إلى متجرك

في جهازك، داخل مجلد المتجر:

```bash
cd omrantoys-store

# انسخ التكامل من مجلد store-integration في مشروع الأتمتة:
# (بدّل <AUTOMATION> بمسار مجلد omran-toys-automation لديك)
git apply <AUTOMATION>/store-integration/omrantoys-store-integration.patch
# أو انسخ يدوياً:
#   cp <AUTOMATION>/store-integration/worker/index.js   src/worker/index.js
#   cp <AUTOMATION>/store-integration/worker/store-db.js src/worker/store-db.js
#   mkdir -p migrations
#   cp <AUTOMATION>/store-integration/migrations/001_add_idempotency_key.sql migrations/
#   cp <AUTOMATION>/store-integration/frontend/storeApi.js src/lib/storeApi.js
#   cp <AUTOMATION>/store-integration/wrangler.toml wrangler.toml
#   (طبّق تغييرات StoreContext.jsx كما في frontend/StoreContext.patch.md)
```

### 1.2 أنشئ قاعدة D1 الحقيقية

`wrangler.toml` فيه حالياً `database_id` وهمي. أنشئ القاعدة واحصل على الـ id:

```bash
cd omrantoys-store
npx wrangler d1 create omran-toys-db
```

سيعيد أمراً مثل `database_id = "abcd..."`. **انسخ هذا الـ id** وضعه في `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "omran-toys-db"
database_id = "<REAL database_id من الأمر أعلاه>"
```

### 1.3 طبّق الميغريشن على قاعدة البيانات الحقيقية

```bash
npx wrangler d1 execute DB --remote --file=migrations/001_add_idempotency_key.sql
```

> يضيف عمود `idempotency_key` + فهرس فريد → لا تكرار للمنتجات.

### 1.4 أنشئ الأسرار (احتفظ بها لاحقاً للبوت)

```bash
npx wrangler secret put STORE_API_KEY
npx wrangler secret put STORE_API_SECRET
```

> 🔑 **احفظ هاتين القيمتين** — ستضعهما في `.env` للبوت لاحقاً (نفس القيم بالضبط).

### 1.5 ابنِ وانشر

```bash
cd omrantoys-store
npm install
npm run build
npx wrangler deploy
```

### 1.6 اربط العُرف المخصص `omrantoys.store`

من لوحة Cloudflare: **Workers & Pages → omrantoys-store → Settings → Domains & Routes → Add custom domain** وأضف `omrantoys.store` (و`www` إن رغبت).

### 1.7 تحقّق

```bash
curl https://omrantoys.store/api/health
# → {"status":"ok"}
curl https://omrantoys.store/api/products?limit=3
# → []  (فارغ طبيعي قبل نشر أي منتج)
```

---

## المرحلة 2 — استضافة خادم البوت (Node.js على VPS + HTTPS)

الشرط الأساسي من تليجرام: **رابط HTTPS حقيقي**.

### 2.1 جهّز خادم + دومين + SSL

- احجز VPS (DigitalOcean / Hetzner / Contabo) بنظام Ubuntu.
- وجّه دومين فرعي `automation.omrantoys.store` إلى الخادم.
- أسهل طريقة للـ HTTPS: **Cloudflare Tunnel** (لا يحتاج فتح منافذ ولا Certbot):

```bash
# على الخادم
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login
cloudflared tunnel create omran-automation
cloudflared tunnel route dns omran-automation automation.omrantoys.store
```

ثم شغّل التونل موجّهاً إلى المنفذ 3000:
```bash
cloudflared tunnel run --url http://127.0.0.1:3000 omran-automation
```
(أو أضف `ingress` في config دائم).

### 2.2 نقل الكود والتشغيل عبر Docker

```bash
git clone https://github.com/alaaomran2020/omran-toys-automation.git
cd omran-toys-automation
cp .env.example .env
```

### 2.3 املأ `.env` بالبيانات الحقيقية

| المتغير | القيمة |
|---|---|
| `TELEGRAM_BOT_TOKEN` | من @BotFather |
| `TELEGRAM_ADMIN_IDS` | أرقام ids مفصولة بفاصلة (أنت + الموظفون) |
| `OPENAI_API_KEY` | مفتاحك (مع رصيد) |
| `PUBLIC_BASE_URL` | `https://automation.omrantoys.store` |
| `STORE_API_URL` | `https://omrantoys.store` |
| `STORE_API_KEY` | ⬅️ نفس قيمة secret المتجر |
| `STORE_API_SECRET` | ⬅️ نفس قيمة secret المتجر |

### 2.4 تشغيل النظام

```bash
docker compose up -d --build
```

> `docker-compose.yml` يحفظ SQLite والصور في volume `automation-data` حتى لا تُفقد عند إعادة التشغيل.

---

## المرحلة 3 — الربط النهائي والاختبار

### 3.1 ربط تليجرام (Webhook)

```bash
npm run webhook:setup
```
إذا ظهرت `✅ Webhook registered` → تليجرام يرسل الرسائل لخادمك.

### 3.2 الاختبار الفعلي (E2E)

1. افتح تليجرام وأرسل `/start`.
2. أرسل صورة منتج حقيقي.
3. أرسل السعر والكمية، مثلاً `350 - 5`.
4. انتظر ثوانٍ حتى يستخرج الذكاء الاصطناعي البيانات.
5. اضغط **✅ نشر**.
6. افتح `omrantoys.store` وتأكد من ظهور المنتج.

---

## المرجع

- دليل النشر التفصيلي: `store-integration/DEPLOY-RUNBOOK.md`
- مواصفات الـ API والتركيب: `store-integration/README.md`
