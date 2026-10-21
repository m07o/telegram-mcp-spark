# Spark Telegram Agent (`spark-telegram-agent`)

المشغّل والوكيل الذكي المستقل لـ **Spark** عبر تيليجرام، المبني بتقنيات Cloudflare Workers والمعزز بنموذج **Google Gemini 2.5 / 2.0 Flash** مع دعم إدارة خوادم بروتوكول سياق النموذج (**MCP**) ديناميكياً.

---

## المميزات المعمارية الرئيسية

1. **إدارة ديناميكية لخوادم MCP (Dynamic MCP Registry)**:
   - خوادم مدمجة جاهزة:
     * `mem0`: `https://mem0-mcp-worker.mohamed225114551.workers.dev/sse`
     * `telegram_userbot`: `https://telegram-userbot-mcp.mohamed225114551.workers.dev/sse`
   - تخزين مستمر في Cloudflare KV مع دعم التراجع للذاكرة المحلية (In-memory fallback).
   - أدوات تحكّم ذاتية (Meta-Tools):
     * `register_mcp_server(name, url)`: فحص وربط خادم MCP جديد فوراً.
     * `list_mcp_servers()`: عرض الخوادم وحالتها وعدد أدواتها.
     * `remove_mcp_server(name)`: فك ربط أي خادم.
     * `reload_tools()`: تحديث كاش الأدوات من كافة الخوادم.

2. **حلقة الوكيل الذكي (Agentic Loop)**:
   - استدعاء تلقائي لسياق الذاكرة من Mem0 قبل الإجابة.
   - حلقة استدعاء وظائف متعددة الخطوات (Multi-step Tool Calling حتى 10 دورات).
   - حفظ تلقائي للمحادثة والمعلومات الجديدة في Mem0 في الخلفية عبر `ctx.waitUntil`.

3. **أمان صارم وتجربة تيليجرام ممتازة**:
   - الرد فقط على معرف حسابك الشخصي المسموح به (`ALLOWED_USER_ID`) وتجاهل أي مستخدم آخر تماماً.
   - إرسال إشارة `typing...` المستمرة أثناء معالجة الأدوات.
   - تجزئة ذكية للرسائل الطويلة (> 4096 حرف).
   - تنسيق Markdown مع تراجع تلقائي للنص العادي لتفادي أخطاء التيليجرام (400 Bad Request).

---

## المتغيرات البيئية المطلوبة (Environment Variables & Secrets)

يمكن تعيينها عبر لوحة تحكم Cloudflare أو عبر أمر `wrangler secret put`:

```bash
# 1. توكن بوت تيليجرام من @BotFather
npx wrangler secret put TELEGRAM_BOT_TOKEN

# 2. معرف حسابك الرقمي على تيليجرام (User ID)
npx wrangler secret put ALLOWED_USER_ID

# 3. مفتاح Gemini API من Google AI Studio
npx wrangler secret put GEMINI_API_KEY

# 4. اختياري: تحديد نموذج Gemini (الافتراضي gemini-2.5-flash)
# npx wrangler secret put GEMINI_MODEL
```

---

## إعداد Webhook تيليجرام

بعد نشر الـ Worker عبر أمر `npx wrangler deploy`، قم بتفعيل الـ Webhook برابط سيرفرك:

```bash
curl -F "url=https://spark-telegram-agent.<YOUR-SUBDOMAIN>.workers.dev/webhook" \
     https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook
```

---

## الفحص والاختبار

```bash
# فحص الأنواع
npm run typecheck

# بناء الحزمة بدون نشر (Dry Run)
npx wrangler deploy --dry-run

# تشغيل حزمة الاختبارات الشاملة
npm test
```
