# إعداد الطلبات والإدارة (نسخة Windows / PowerShell)

هاد الدليل كينشئ Worker جديد باسم `mouga-market-orders`. ما كيتصلش بأي Worker قديم. ما تحط حتى secret فـ ملف، ولا فـ Git، ولا فـ محادثة. بدّل `OWNER` و`YOUR-DOMAIN.example` قبل أول نشر. المستودع خاصو يبقى عام حيث GitHub Pages المجاني كيتطلب repo عام.

## 1. Google Sheet وApps Script

1. أنشئ Google Sheet جديد أو اختار الجدول الموجود اللي بغيتي تستعمل؛ Script Properties غادي تربط السكريبت بالجدول.
2. من **Extensions → Apps Script**، لسّق `Code.gs` من هاد المجلد.
3. فـ **Project Settings → Script Properties** زِد:
   - `SPREADSHEET_ID`: المعرّف اللي بين `/d/` و`/edit` فـ رابط Google Sheet.
   - `SHEET_NAME`: اسم الورقة، مثلا `Orders` (اختياري؛ الافتراضي `Orders`).
   - `WORKER_SHARED_SECRET`: السر الطويل اللي غادي تولدو فالخطوة الجاية.
4. شغّل `node scripts/generate-webhook-secret.mjs` من جذر المشروع. خزن القيمة مباشرة فـ Script Property `WORKER_SHARED_SECRET`، وخليها سرية.
5. من **Deploy → New deployment → Web app** اختار التنفيذ باسمك، والسماح بالوصول **Anyone** لأن الـWorker هو اللي كيتحقق من السر. وافق على الصلاحيات وخذ رابط Web App.
6. إلا بدّلتي الكود من بعد، دير **Deploy → Manage deployments → Edit → New version → Deploy** باش الرابط المنشور يستعمل النسخة الجديدة.

السكريبت كينشئ العناوين بالترتيب هادا: `id, createdAt, status, name, phone, city, items, itemsSummary, total`. عنوان التوصيل كيتخزن داخل JSON ديال خانة `items`، باش يبقى ترتيب الأعمدة القديم هو هو؛ الصفوف القديمة اللي فيها لائحة منتجات JSON كتتقرا حتى هي.

## 2. GitHub repository وPages

1. تأكد من `gh auth status`؛ إلا ما كنتيش داخل، شغّل `gh auth login`.
2. أنشئ repo عام جديد بالاسم `mouga-market-store`، وبدّل القيمة `OWNER/mouga-market-store` فـ `wrangler.toml` باسم حسابك.
3. تأكد قبل أول push أن `node scripts/secret-scan.mjs` داز. ما تديرش add لملفات `.dev.vars` أو أي أسرار.
4. من GitHub فعّل **Settings → Pages → Deploy from a branch → main → /(root)**.
5. إلا عندك دومين، زِد الدومين الحقيقي فسطر بوحدو فـ `CNAME` فالجذر، واضبط DNS ديالو. ما تستعملش دومين تجريبي. دخّل نفس الأصل فـ `ALLOWED_ORIGINS`.
6. صفحات SEO كتتولد بالأمر ` $env:SITE_URL = "https://الدومين-الحقيقي"; node scripts/generate-product-pages.mjs `. حدّث `robots.txt` للدومين الحقيقي.

GitHub fine-grained token: أنشئ token جديد محدد على **هاد repo الجديد بوحدو**، وامنحو **Contents: Read and write** فقط. ما تلصقش token فـ ملفات المشروع.

## 3. كلمة مرور المشرف وأسرار الـWorker

من جذر المشروع شغّل `node order-worker/hash-password.mjs`. دخل كلمة مرور فيها 10 أحرف على الأقل؛ الإدخال مخفي. السكريبت كيخرج `ADMIN_PASSWORD_HASH` و`SESSION_SECRET` مرة وحدة، خزّنهم بأمان وما تديرهمش فـ ملفات.

شغّل `.\scripts\set-secrets.ps1`. السكريبت كيسول على كل قيمة بــ `Read-Host -AsSecureString` وكيمررها مباشرة لمدخل Wrangler؛ ما كيتكتب حتى secret لملف ولا لوسيط الأمر. خاص Node.js 20+ وWrangler مسجل الدخول. القيم المطلوبة:

| الاسم | القيمة اللي كتدخل |
|---|---|
| `SHEETS_WEB_APP_URL` | رابط Web App المنشور ديال Apps Script |
| `SHEETS_WEBHOOK_SECRET` | نفس السر اللي خزنت فـ Script Property `WORKER_SHARED_SECRET` |
| `TELEGRAM_BOT_TOKEN` | token جديد من BotFather، من بعد ما تلغي القديم |
| `TELEGRAM_CHAT_ID` | chat ID ديال الحساب/المجموعة اللي غادي تستقبل تنبيهات الطلبات |
| `ADMIN_EMAIL` | Gmail ديال مالك المتجر |
| `ADMIN_PASSWORD_HASH` | سطر الـhash اللي خرجو `hash-password.mjs` |
| `SESSION_SECRET` | السر اللي خرجو نفس السكريبت |
| `GITHUB_TOKEN` | fine-grained token المحدود على repo الجديد |

الأوامر المباشرة (كل واحد كيسولك على القيمة تفاعليا؛ ما تزيدش قيمة السر كـ argument):

```powershell
npx wrangler secret put SHEETS_WEB_APP_URL --config order-worker/wrangler.toml
npx wrangler secret put SHEETS_WEBHOOK_SECRET --config order-worker/wrangler.toml
npx wrangler secret put TELEGRAM_BOT_TOKEN --config order-worker/wrangler.toml
npx wrangler secret put TELEGRAM_CHAT_ID --config order-worker/wrangler.toml
npx wrangler secret put ADMIN_EMAIL --config order-worker/wrangler.toml
npx wrangler secret put ADMIN_PASSWORD_HASH --config order-worker/wrangler.toml
npx wrangler secret put SESSION_SECRET --config order-worker/wrangler.toml
npx wrangler secret put GITHUB_TOKEN --config order-worker/wrangler.toml
```

يمكنك تولّد سر webhook بـ `node scripts/generate-webhook-secret.mjs`. دخلو مباشرة فـ Script Property وفـ prompt ديال `SHEETS_WEBHOOK_SECRET`. **ضروري القيمتين يتطابقو.** من بعد أي تغيير ديال `WORKER_SHARED_SECRET`، حدّث secret ديال Worker، ومن بعد حدّث Script Property ونشر نسخة Apps Script جديدة.

## 4. إنشاء Worker جديد

1. تأكد من `npx wrangler whoami`؛ إلا ما كنتيش مسجل، شغّل `npx wrangler login`.
2. عدّل `name`, `GITHUB_REPO`, `GITHUB_BRANCH` و`ALLOWED_ORIGINS` فـ `wrangler.toml`. ما تبدلش أي إعداد ديال Worker آخر.
3. شغّل `.\scripts\set-secrets.ps1` باش تدخل secrets، ومن بعد:

```powershell
npx wrangler deploy --config order-worker/wrangler.toml
```

4. خذ رابط Worker اللي عطاه Wrangler، وحطو فـ `data/config.json` فـ `order_endpoint` (مثال البنية فقط: `https://اسم-worker.حسابك.workers.dev`). دير commit وpush للتغيير.
5. سجّل دخول الإدارة من `https://الدومين-الحقيقي/admin.html`.

**اختياري:** أنشئ KV namespace:

```powershell
npx wrangler kv namespace create LOGIN_KV
```

خد `id` اللي رجع Wrangler وزيد هاد binding تحت إعدادات `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "LOGIN_KV"
id = "ضع-معرف-namespace-هنا"
```

عاود deploy باش يتطبق limit ديال المحاولات حسب IP. بلا binding، باقي التحقق ديال كلمة المرور والتوقيع خدام، ولكن ما كاينش تخزين limit مستمر بين الطلبات.

## 5. Telegram

1. فـ Telegram حل `@BotFather`، استعمل `/newbot`، وسجّل token الجديد مباشرة فـ prompt ديال Worker.
2. صيفط رسالة للبوت الجديد باش تفتح المحادثة. باش تجيب chat ID، استعمل طريقة موثوقة محليا/رسميا كتستهلك `getUpdates` ديال token الجديد؛ ما تلصقش token فمحادثة أو موقع غير موثوق. سجّل chat ID مباشرة فـ prompt ديال `TELEGRAM_CHAT_ID`.
3. إلا كان القديم مكشوف، ألغيه من BotFather وما تعاودش تستعملو.

## الاختبار والحدود

- الاختبارات المحلية: `npm test` و`npm run check` و`node scripts/secret-scan.mjs`.
- إعدادات النشر والـcredentials الحقيقية ما يمكنش التحقق منها بلا تسجيل الدخول لمواقع GitHub وCloudflare وGoogle وTelegram.
- جرّب طلب حقيقي تجريبي بعد ضبط كل الأسرار، وتأكد من Sheet وTelegram وPages وCORS. الـWorker كيسجل الطلب فالجدول قبل إرسال Telegram.
