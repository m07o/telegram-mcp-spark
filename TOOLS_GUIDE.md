# دليل شامل لجميع أدوات ومعمارية مشروع Telegram MCP Server

يُعد مشروع **Telegram MCP Server** واحداً من أضخم وأشمل خوادم بروتوكول سياق النموذج (**Model Context Protocol - MCP**) المخصصة لمنصة تيليجرام، حيث يربط وكلاء الذكاء الاصطناعي (مثل Claude وCursor وCodex) بحسابات تيليجرام عبر مكتبة **Telethon**، ويوفر **170 أداة (MCP Tools)** مقسمة هندسياً إلى **14 وحدة (Modules)**.

---

## فهرس المحتويات

1. [نظرة عامة على المعمارية والمميزات الأساسية](#نظرة-عامة-على-المعمارية-والمميزات-الأساسية)
2. [ملخص الفئات والوحدات (14 فئة - 170 أداة)](#ملخص-الفئات-والوحدات-14-فئة---170-أداة)
3. [شرح تفصيلي لجميع الأدوات حسب الوحدة](#شرح-تفصيلي-لجميع-الأدوات-حسب-الوحدة)
   - [1. إدارة الحسابات (`accounts.py`)](#1-إدارة-الحسابات-accountspy--أداة-واحدة)
   - [2. استكشاف الأدوات الذاتي (`discovery.py`)](#2-استكشاف-الأدوات-الذاتي-discoverypy--أداتان)
   - [3. جهات الاتصال (`contacts.py`)](#3-جهات-الاتصال-contactspy--14-أداة)
   - [4. المحادثات والقنوات ومواضيع المنتديات (`chats.py`)](#4-المحادثات-والقنوات-ومواضيع-المنتديات-chatspy--26-أداة)
   - [5. الرسائل والجدولة والتفاعلات والمسودات (`messages.py`)](#5-الرسائل-والجدولة-والتفاعلات-والمسودات-messagespy--33-أداة)
   - [6. المجموعات والمشرفون والصلاحيات والتحليل (`groups.py`)](#6-المجموعات-والمشرفون-والصلاحيات-والتحليل-groupspy--34-أداة)
   - [7. الوسائط والملفات والملصقات (`media.py`)](#7-الوسائط-والملفات-والملصقات-mediapy--12-أداة)
   - [8. الملف الشخصي والخصوصية والبوتات (`profile.py`)](#8-الملف-الشخصي-والخصوصية-والبوتات-profilepy--11-أداة)
   - [9. مجلدات وفلاتر المحادثات (`folders.py`)](#9-مجلدات-وفلاتر-المحادثات-folderspy--7-أدوات)
   - [10. التتبع اللحظي للأحداث والرسائل (`events.py`)](#10-التتبع-اللحظي-للأحداث-والرسائل-eventspy--أداتان)
   - [11. نسخ مواضيع المنتديات (`forum_forward.py`)](#11-نسخ-مواضيع-المنتديات-forum_forwardpy--أداة-واحدة)
   - [12. تحليل المحتوى والترحيل المنسق (`content.py`)](#12-تحليل-المحتوى-والترحيل-المنسق-contentpy--أداتان)
   - [13. قاعدة البيانات وتتبع الحلقات ومنع التكرار (`database.py`)](#13-قاعدة-البيانات-وتتبع-الحلقات-ومنع-التكرار-databasepy--10-أدوات)
   - [14. الترحيل الذاتي الشامل وإدارة المهام (`migration.py`)](#14-الترحيل-الذاتي-الشامل-وإدارة-المهام-migrationpy--15-أداة)

---

## نظرة عامة على المعمارية والمميزات الأساسية

- **تعدد الحسابات (`Multi-Account Support`):** جميع الأدوات المغلفة بالمزخرف `@with_account` تقبل المعامل الاختياري `account`. في حال تشغيل عدة حسابات، تقوم أدوات القراءة فقط (`readOnlyHint=True`) بجمع النتائج من جميع الحسابات تلقائياً عند عدم تحديد اسم الحساب، بينما تشترط أدوات الكتابة تحديد الحساب لمنع الإرسال بالخطأ.
- **مستويات الصلاحيات (`TELEGRAM_EXPOSED_TOOLS`):** يمكن تقييد الأدوات المعروضة للوكيل عبر متغير البيئة إلى:
  - `read-only`: أدوات القراءة والبحث فقط.
  - `write`: أدوات الإرسال والتعديل العادية.
  - `admin`: أدوات الإشراف والحظر وإعدادات المجموعات.
  - `migration`: أدوات الترحيل الشامل للمواضيع والمجموعات.
  - `all`: جميع الأدوات (الوضع الافتراضي).
- **الحماية والأمان:**
  - تطهير النصوص والأسماء لمنع هجمات **Prompt Injection**.
  - حماية مسارات الملفات المحليّة عبر **Allowed Roots** لمنع الوصول لأي ملف خارج المجلدات المسموحة.
  - سجل تدقيق (`Audit Log`) بصيغة JSONL يسجل عمليات الكتابة دون كشف محتوى الرسائل أو البيانات السرية.

---

## ملخص الفئات والوحدات (14 فئة - 170 أداة)

| # | الوحدة (Module) | المسار | عدد الأدوات | الوظيفة الرئيسية |
|---|---|---|---|---|
| 1 | `accounts` | `telegram_mcp/tools/accounts.py` | 1 | عرض الحسابات المربوطة وحالتها |
| 2 | `discovery` | `telegram_mcp/tools/discovery.py` | 2 | البحث في كتالوج الأدوات وتصنيفاتها |
| 3 | `contacts` | `telegram_mcp/tools/contacts.py` | 14 | إدارة جهات الاتصال والحظر والاستيراد/التصدير |
| 4 | `chats` | `telegram_mcp/tools/chats.py` | 26 | إدارة المحادثات والقنوات ومواضيع المنتديات (Topics) |
| 5 | `messages` | `telegram_mcp/tools/messages.py` | 33 | إرسال، بحث، تعديل، حذف، جدولة، تفاعلات، أزرار، مسودات |
| 6 | `groups` | `telegram_mcp/tools/groups.py` | 34 | إدارة المجموعات، المشرفين، الحظر، الروابط، وتحليل المجموعات |
| 7 | `media` | `telegram_mcp/tools/media.py` | 12 | إرسال وتنزيل الملفات، الألبومات، الصوتيات، الملصقات، وGIF |
| 8 | `profile` | `telegram_mcp/tools/profile.py` | 11 | إدارة الحساب الشخصي، الصور، الخصوصية، وأوامر البوتات |
| 9 | `folders` | `telegram_mcp/tools/folders.py` | 7 | إنشاء وتعديل وترتيب مجلدات المحادثات (Folders) |
| 10 | `events` | `telegram_mcp/tools/events.py` | 2 | انتظار الرسائل الواردة لحظياً مع التجميع الزمني (Debounce) |
| 11 | `forum_forward` | `telegram_mcp/tools/forum_forward.py` | 1 | نسخ كافة مواضيع مجموعة منتدى إلى أخرى بدون وسم تحويل |
| 12 | `content` | `telegram_mcp/tools/content.py` | 2 | فحص جودة المحتوى وترحيله مع دمج الأجزاء ومنع التكرار |
| 13 | `database` | `telegram_mcp/tools/database.py` | 10 | قاعدة بيانات SQLite لتتبع الرسائل، الحلقات، وربط المواضيع |
| 14 | `migration` | `telegram_mcp/tools/migration.py` | 15 | الترحيل الذاتي الشامل، المقارنة، التنظيف، وإعادة الترتيب الصارم |

---

## شرح تفصيلي لجميع الأدوات حسب الوحدة

### 1. إدارة الحسابات (`accounts.py`) — أداة واحدة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `list_accounts` | قراءة | لا يوجد | عرض جميع حسابات تيليجرام المُعدّة في الخادم مع الاسم، رقم الهاتف، وحالة الاتصال لكل حساب. |

---

### 2. استكشاف الأدوات الذاتي (`discovery.py`) — أداتان

تُستخدم هذه الأدوات لمساعدة الوكيل الذكي في البحث عن الأداة المناسبة دون الحاجة لتحميل تفاصيل الـ 170 أداة دفعة واحدة.

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `search_tools` | قراءة | `query`, `category?`, `account?` | البحث عن الأدوات المتاحة بالكلمات المفتاحية في الاسم أو العنوان أو الوصف، مع إمكانية التصفية حسب الفئة. |
| `list_tool_categories` | قراءة | `account?` | عرض قائمة بجميع فئات الأدوات الـ 14 مع عدد الأدوات في كل فئة وأمثلة عليها. |

---

### 3. جهات الاتصال (`contacts.py`) — 14 أداة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `list_contacts` | قراءة | `account?` | عرض جميع جهات الاتصال المسجلة في الحساب (المعرف، الاسم، اسم المستخدم، الهاتف). |
| `search_contacts` | قراءة | `query`, `account?` | البحث عن جهات اتصال بالاسم أو اسم المستخدم أو رقم الهاتف. |
| `get_contact_ids` | قراءة | `account?` | جلب قائمة بمعرفات (IDs) جميع جهات الاتصال فقط. |
| `get_direct_chat_by_contact` | قراءة | `contact_query`, `account?` | البحث عن محادثة خاصة مباشرة مع جهة اتصال معينة بالاسم أو المعرف أو الهاتف وبيان عدد الرسائل غير المقروءة. |
| `get_contact_chats` | قراءة | `contact_id`, `account?` | عرض المحادثة الخاصة وجميع المجموعات والقنوات المشتركة مع جهة اتصال محددة. |
| `get_last_interaction` | قراءة | `contact_id`, `account?` | جلب آخر 5 رسائل متبادلة مع جهة اتصال معينة لمعرفة آخر تفاعل. |
| `add_contact` | كتابة | `first_name`, `last_name?`, `phone?`, `username?`, `account?` | إضافة جهة اتصال جديدة سواء عن طريق رقم الهاتف أو عن طريق اسم المستخدم (`username`) بدون الحاجة لرقم الهاتف. |
| `delete_contact` | كتابة | `user_id`, `account?` | حذف جهة اتصال من قائمة جهات الاتصال. |
| `block_user` | كتابة | `user_id`, `account?` | حظر مستخدم معين على تيليجرام. |
| `unblock_user` | كتابة | `user_id`, `account?` | إلغاء حظر مستخدم معين. |
| `import_contacts` | كتابة | `contacts`, `account?` | استيراد قائمة من جهات الاتصال دفعة واحدة (كل عنصر يحتوي على `phone`, `first_name`, `last_name`). |
| `export_contacts` | قراءة | `account?` | تصدير جميع جهات الاتصال بصيغة JSON. |
| `get_blocked_users` | قراءة | `account?` | جلب قائمة بالمستخدمين المحظورين بصيغة JSON. |
| `send_contact` | كتابة | `chat_id`, `phone_number`, `first_name`, `last_name?`, `vcard?`, `account?` | مشاركة بطاقة جهة اتصال (Contact Card / vCard) داخل محادثة معينة. |

---

### 4. المحادثات والقنوات ومواضيع المنتديات (`chats.py`) — 26 أداة

تشمل أدوات تصفح المحادثات، إدارة الإشعارات والأرشفة، بالإضافة إلى أدوات متخصصة في مواضيع المجموعات الخارقة (`Forum Topics`).

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `get_chats` | قراءة | `page=1`, `page_size=20`, `account?` | جلب قائمة مقسمة لصفحات (Paginated) بالمحادثات الحالية (المعرف والعنوان). |
| `list_chats` | قراءة | `chat_type?`, `limit=20`, `unread_only=False`, `unmuted_only=False`, `archived?`, `with_about=False`, `account?` | عرض المحادثات مع فلاتر متقدمة (النوع: مستخدم/مجموعة/قناة، غير المقروءة فقط، غير المكتومة، المؤرشفة، مع خيار جلب الوصف `about`). |
| `get_chat` | قراءة | `chat_id`, `account?` | جلب معلومات تفصيلية عن محادثة معينة (عدد الأعضاء، الرسائل غير المقروءة، وآخر رسالة). |
| `get_full_chat` | قراءة | `chat_id`, `account?` | جلب البيانات الكاملة لقناة أو مجموعة بما في ذلك الوصف (`about`)، عدد الأعضاء، ومعرف محادثة المناقشة المرتبطة. |
| `search_public_chats` | قراءة | `query`, `limit=20`, `account?` | البحث العام في تيليجرام عن القنوات أو المجموعات العامة أو البوتات بالاسم أو المعرف. |
| `resolve_username` | قراءة | `username`, `account?` | تحويل اسم المستخدم (`@username`) إلى كائن/معرف مستخدم أو قناة في تيليجرام. |
| `subscribe_public_channel` | كتابة | `channel`, `account?` | الاشتراك (الانضمام) في قناة عامة أو مجموعة خارقة عامة عبر المعرف أو الاسم. |
| `mute_chat` | إشراف/كتابة | `chat_id`, `account?` | كتم إشعارات محادثة معينة. |
| `unmute_chat` | إشراف/كتابة | `chat_id`, `account?` | إلغاء كتم إشعارات محادثة معينة. |
| `archive_chat` | إشراف/كتابة | `chat_id`, `account?` | نقل محادثة إلى الأرشيف. |
| `unarchive_chat` | إشراف/كتابة | `chat_id`, `account?` | إخراج محادثة من الأرشيف إلى القائمة الرئيسية. |
| `get_common_chats` | قراءة | `user_id`, `limit=100`, `max_id=0`, `account?` | عرض المجموعات والقنوات المشتركة بينك وبين مستخدم معين مع دعم تعدد الصفحات. |
| `get_message_read_by` | قراءة | `chat_id`, `message_id`, `account?` | عرض قائمة المستخدمين الذين قرأوا رسالة معينة وتاريخ القراءة (للمجموعات المدعومة خلال آخر 7 أيام). |
| `get_message_link` | قراءة | `chat_id`, `message_id`, `thread=False`, `account?` | استخراج رابط مباشر (`t.me/...`) لرسالة داخل قناة أو مجموعة خارقة. |
| `enable_forum_topics` | إشراف | `chat_id`, `tabs=True`, `account?` | تفعيل ميزة المواضيع (Forum Topics) في مجموعة خارقة (يتطلب صلاحية مشرف). |
| `list_topics` | قراءة | `chat_id`, `limit=100`, `offset_topic=0`, `fetch_all=False`, `search_query?`, `account?` | جلب مواضيع المنتدى في مجموعة خارقة (مع دعم جلب كافة المواضيع عبر `fetch_all=True` والبحث في العناوين). |
| `count_topics` | قراءة | `chat_id`, `account?` | حساب العدد الإجمالي الحقيقي لجميع المواضيع في مجموعة منتدى (يتجاوز حد الـ 100 موضوع لكل طلب). |
| `create_forum_topic` | إشراف | `chat_id`, `title`, `icon_color?`, `icon_emoji_id?`, `delay_before=2.0`, `delay_after=3.0`, `account?` | إنشاء موضوع جديد في مجموعة منتدى مع الحفاظ على علامات اتجاه النص العربي (RTL) ومحدد سرعة (Rate Limiter). |
| `find_or_create_topic` | كتابة | `chat_id`, `title`, `icon_emoji_id?`, `icon_color?`, `delay_before=2.0`, `delay_after=3.0`, `account?` | البحث عن موضوع مطابق تماماً للعنوان (بعد التطبيع)، أو إنشاؤه تلقائياً إن لم يكن موجوداً لمنع تكرار المواضيع. |
| `delete_topic_by_title` | إشراف | `chat_id`, `title`, `keep_first=True`, `account?` | حذف المواضيع المطابقة لعنوان معين، مع خيار الإبقاء على الموضوع الأقدم وحذف المكرر فقط (`keep_first=True`). |
| `copy_topic` | كتابة | `from_chat_id`, `topic_id`, `to_chat_id`, `topic_title?`, `limit=0`, `delay=2.0`, `batch_delay=5.0`, `inter_topic_delay=10.0`, `resume_from_msg_id=0`, `account?` | نسخ موضوع كامل بجميع رسائله ووسائطه من مجموعة إلى أخرى **بدون وسم "محولة من" (No Forward Tag)** مع دعم الاستئناف. |
| `diff_chats` | قراءة | `source_chat_id`, `target_chat_id`, `account?` | مقارنة عناوين المواضيع بين مجموعتين لمعرفة المواضيع المفقودة في الهدف، الموجودة مسبقاً، والمكررة. |
| `compare_topics` | قراءة | `source_chat_id`, `source_topic_id`, `target_chat_id`, `target_topic_id`, `account?` | مقارنة محتوى الرسائل الفعلي (النص + نوع الوسائط) بين موضوعين لمعرفة الرسائل الناقصة أو الزائدة مع تجاهل رسائل الضوضاء. |
| `cleanup_topic_noise` | كتابة | `chat_id`, `topic_id`, `dry_run=False`, `account?` | تنظيف موضوع معين بحذف رسائل الضوضاء والفواصل (`===`, `.`, `/`, أوامر البوتات) مع وضع معاينة `dry_run`. |
| `migrate_incremental` | كتابة | `source_chat_id`, `source_topic_id`, `target_chat_id`, `target_topic_id`, `resume_from_msg_id=0`, `limit=0`, `delay=2.0`, `batch_delay=5.0`, `inter_topic_delay=10.0`, `account?` | ترحيل الرسائل الناقصة فقط من موضوع مصدر إلى موضوع هدف بناءً على مقارنة المحتوى بدون تكرار. |
| `verify_topic_sync` | قراءة | `source_chat_id`, `source_topic_id`, `target_chat_id`, `target_topic_id`, `tolerance=0`, `account?` | التحقق من تطابق محتوى موضوعين بعد النقل مع إمكانية تحديد هامش تسامح (`tolerance`) للرسائل الإضافية. |

---

### 5. الرسائل والجدولة والتفاعلات والمسودات (`messages.py`) — 33 أداة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `get_messages` | قراءة | `chat_id`, `page=1`, `page_size=20`, `account?` | جلب الرسائل من محادثة بنظام الصفحات (`page`, `page_size`) في سطر نصي غني بالمعلومات لكل رسالة. |
| `list_messages` | قراءة | `chat_id`, `limit=20`, `search_query?`, `from_date?`, `to_date?`, `account?` | جلب الرسائل مع إمكانية التصفية بكلمة بحث ونطاق زمني (`YYYY-MM-DD`). |
| `get_history` | قراءة | `chat_id`, `limit=100`, `account?` | جلب سجل الرسائل بصيغة كائنات JSON مفصلة (تشمل الوسائط، الأزرار، الروابط، التفاعلات، والألبومات). |
| `get_message_context` | قراءة | `chat_id`, `message_id`, `context_size=3`, `account?` | جلب الرسائل المحيطة برسالة معينة (قبلها وبعدها) بالإضافة إلى نص الرسالة المردود عليها لفهم السياق. |
| `search_messages` | قراءة | `chat_id`, `query`, `limit=20`, `account?` | البحث النصي عن رسائل داخل محادثة محددة. |
| `search_global` | قراءة | `query`, `page=1`, `page_size=20`, `account?` | البحث الشامل عن نص عبر جميع المحادثات والقنوات في الحساب. |
| `send_message` | كتابة | `chat_id`, `message`, `parse_mode?`, `account?` | إرسال رسالة نصية إلى محادثة (يدعم تنسيق `html` أو `markdown`). |
| `reply_to_message` | كتابة | `chat_id`, `message_id`, `text`, `parse_mode?`, `account?` | الرد على رسالة محددة (أو الإرسال داخل موضوع Forum Topic بتمرير معرف الموضوع في `message_id`). |
| `edit_message` | كتابة | `chat_id`, `message_id`, `new_text`, `account?` | تعديل نص رسالة أرسلتها مسبقاً. |
| `delete_message` | كتابة | `chat_id`, `message_id`, `account?` | حذف رسالة مفردة بواسطة معرفها. |
| `delete_messages_bulk` | كتابة | `chat_id`, `message_ids`, `revoke=True`, `account?` | حذف مجموعة من الرسائل دفعة واحدة في طلب واحد (مع خيار الحذف للطرفين `revoke`). |
| `delete_chat_history` | كتابة | `chat_id`, `max_id=0`, `revoke=False`, `account?` | مسح سجل المحادثة بالكامل (أو حتى رسالة معينة). |
| `forward_message` | كتابة | `from_chat_id`, `message_id`, `to_chat_id`, `expand_album=True`, `account?` | إعادة توجيه رسالة (مع ميزة الاكتشاف التلقائي للألبوم `expand_album` لتحويل الألبوم كاملاً بدلاً من صورة واحدة). |
| `forward_messages` | كتابة | `from_chat_id`, `message_ids`, `to_chat_id`, `account?` | إعادة توجيه دفعة من الرسائل في عملية ذرية واحدة مع الحفاظ على تجميع الألبومات. |
| `copy_message` | كتابة | `from_chat_id`, `message_id`, `to_chat_id`, `reply_to?`, `account?` | نسخ رسالة واحدة (نص أو ملف/فيديو مهما كان حجمه) على الخادم مباشرة **بدون وسم التحويل**. |
| `copy_messages` | كتابة | `from_chat_id`, `message_ids`, `to_chat_id`, `reply_to?`, `delay=0.5`, `account?` | نسخ قائمة من الرسائل بالترتيب بدون وسم التحويل مع فاصل زمني لتجنب الحظر. |
| `send_scheduled_message` | كتابة | `chat_id`, `message`, `schedule_date`, `account?` | جدولة رسالة ليتم إرسالها في وقت مستقبلي (بصيغة ISO-8601 أو Unix Timestamp). |
| `get_scheduled_messages` | قراءة | `chat_id`, `account?` | عرض جميع الرسائل المجدولة (المعلقة) في محادثة معينة. |
| `delete_scheduled_message` | كتابة | `chat_id`, `message_ids`, `account?` | إلغاء وحذف رسالة مجدولة أو أكثر قبل إرسالها. |
| `pin_message` | كتابة | `chat_id`, `message_id`, `account?` | تثبيت رسالة داخل محادثة. |
| `unpin_message` | كتابة | `chat_id`, `message_id`, `account?` | إلغاء تثبيت رسالة محددة. |
| `unpin_all_messages` | كتابة | `chat_id`, `account?` | إلغاء تثبيت جميع الرسائل المثبتة في محادثة دفعة واحدة. |
| `get_pinned_messages` | قراءة | `chat_id`, `account?` | جلب جميع الرسائل المثبتة في محادثة معينة. |
| `mark_as_read` | كتابة | `chat_id`, `account?` | تعليم جميع الرسائل في محادثة معينة كمقروءة. |
| `create_poll` | كتابة | `chat_id`, `question`, `options`, `multiple_choice=False`, `quiz_mode=False`, `public_votes=True`, `close_date?`, `account?` | إنشاء استطلاع رأي (Poll) أو اختبار (Quiz) في محادثة (من 2 إلى 10 خيارات). |
| `send_reaction` | كتابة | `chat_id`, `message_id`, `emoji`, `big=False`, `account?` | إضافة تفاعل (Reaction Emoji) على رسالة. |
| `remove_reaction` | كتابة | `chat_id`, `message_id`, `account?` | إزالة تفاعلك من رسالة معينة. |
| `get_message_reactions` | قراءة | `chat_id`, `message_id`, `limit=50`, `account?` | جلب قائمة المستخدمين والتفاعلات الموضوعة على رسالة محددة. |
| `list_inline_buttons` | قراءة | `chat_id`, `message_id?`, `limit=20`, `account?` | فحص الأزرار التفاعلية (Inline Keyboard Buttons) المرفقة برسالة لمعرفة نصوصها، ترتيبها، وروابطها. |
| `press_inline_button` | كتابة | `chat_id`, `message_id?`, `button_text?`, `button_index?`, `account?` | الضغط برمجياً على زر تفاعلي (Callback Button) في رسالة بوت أو محادثة إما بنص الزر أو برقمه. |
| `save_draft` | كتابة | `chat_id`, `message`, `reply_to_msg_id?`, `no_webpage=False`, `account?` | حفظ مسودة رسالة في حقل الكتابة داخل تطبيق تيليجرام لمراجعتها وإرسالها يدوياً لاحقاً. |
| `get_drafts` | قراءة | `account?` | جلب جميع المسودات المحفوظة عبر كافة المحادثات في الحساب. |
| `clear_draft` | كتابة | `chat_id`, `account?` | مسح المسودة المحفوظة في محادثة معينة. |

---

### 6. المجموعات والمشرفون والصلاحيات والتحليل (`groups.py`) — 34 أداة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `create_group` | كتابة | `title`, `user_ids`, `account?` | إنشاء مجموعة جديدة وإضافة قائمة مستخدمين إليها. |
| `create_channel` | كتابة | `title`, `about=""`, `megagroup=False`, `account?` | إنشاء قناة بث جديدة أو مجموعة خارقة (`megagroup=True`). |
| `invite_to_group` | كتابة | `group_id`, `user_ids`, `account?` | دعوة مستخدمين إلى مجموعة أو قناة. |
| `leave_chat` | كتابة | `chat_id`, `account?` | مغادرة مجموعة عادية، مجموعة خارقة، أو قناة. |
| `get_participants` | قراءة | `chat_id`, `page=1`, `page_size=200`, `account?` | جلب قائمة أعضاء المجموعة أو القناة بنظام الصفحات (حتى 1000 عضو لكل صفحة). |
| `edit_chat_title` | إشراف | `chat_id`, `title`, `account?` | تغيير اسم/عنوان المجموعة أو القناة. |
| `edit_chat_photo` | إشراف | `chat_id`, `file_path`, `account?` | تغيير صورة المجموعة أو القناة من ملف محلي (ضمن المجلدات المسموحة). |
| `edit_chat_about` | إشراف | `chat_id`, `about`, `account?` | تعديل وصف المجموعة أو القناة (حتى 255 حرفاً). |
| `delete_chat_photo` | إشراف | `chat_id`, `account?` | حذف صورة المجموعة أو القناة الحالية. |
| `promote_admin` | إشراف | `group_id`, `user_id`, `rights?`, `account?` | ترقية عضو إلى مشرف بصلاحيات افتراضية أو مخصصة. |
| `demote_admin` | إشراف | `group_id`, `user_id`, `account?` | تنزيل مشرف وإلغاء صلاحياته الإدارية. |
| `edit_admin_rights` | إشراف | `chat_id`, `user_id`, `rank=""`, `change_info...`, `account?` | التحكم الدقيق والمفصل في كل صلاحية من صلاحيات المشرف واللقب المخصص (`rank`). |
| `get_admins` | قراءة | `chat_id`, `account?` | عرض قائمة جميع المشرفين في مجموعة أو قناة. |
| `ban_user` | إشراف | `chat_id`, `user_id`, `account?` | حظر عضو وطرده من مجموعة أو قناة. |
| `unban_user` | إشراف | `chat_id`, `user_id`, `account?` | رفع الحظر عن مستخدم في مجموعة أو قناة. |
| `ban_users_bulk` | إشراف | `chat_id`, `user_ids`, `account?` | حظر قائمة من المستخدمين دفعة واحدة وإرجاع تقرير بمن نجح أو فشل حظره. |
| `unban_users_bulk` | إشراف | `chat_id`, `user_ids`, `account?` | رفع الحظر عن قائمة من المستخدمين دفعة واحدة. |
| `get_banned_users` | قراءة | `chat_id`, `account?` | جلب قائمة المستخدمين المحظورين/المطرودين من المجموعة أو القناة. |
| `set_default_chat_permissions` | إشراف | `chat_id`, `send_messages=True`, `send_media=True...`, `account?` | ضبط الصلاحيات الافتراضية لجميع أعضاء المجموعة (الرسائل، الوسائط، الملصقات، الروابط، الاستطلاعات...). |
| `toggle_slow_mode` | إشراف | `chat_id`, `seconds=0`, `account?` | تفعيل أو تعطيل الوضع البطيء (Slow Mode) في المجموعات الخارقة (`0` للتعطيل، أو `10, 30, 60, 300, 900, 3600` ثانية). |
| `get_invite_link` | قراءة | `chat_id`, `account?` | جلب رابط الدعوة الخاص بالمجموعة أو القناة. |
| `export_chat_invite` | قراءة | `chat_id`, `account?` | تصدير/توليد رابط دعوة للمجموعة أو القناة. |
| `join_chat_by_link` | كتابة | `link`, `account?` | الانضمام إلى مجموعة أو قناة خاصة عبر رابط الدعوة الكامل. |
| `import_chat_invite` | كتابة | `hash`, `account?` | الانضمام إلى مجموعة أو قناة خاصة عبر رمز الدعوة (`Invite Hash`). |
| `get_recent_actions` | قراءة | `chat_id`, `account?` | جلب سجل الإجراءات الإدارية الأخيرة (Admin Log) في المجموعة أو القناة. |
| `edit_forum_topic` | كتابة | `chat_id`, `topic_id`, `title?`, `icon_emoji_id?`, `closed?`, `hidden?`, `account?` | تعديل عنوان موضوع منتدى، أيقونته، أو حالته (مغلق/مخفي). |
| `close_forum_topic` | كتابة | `chat_id`, `topic_id`, `account?` | إغلاق موضوع في المنتدى بحيث لا يمكن النشر فيه إلا للمشرفين. |
| `reopen_forum_topic` | كتابة | `chat_id`, `topic_id`, `account?` | إعادة فتح موضوع منتدى مغلق. |
| `hide_forum_topic` | كتابة | `chat_id`, `topic_id`, `account?` | إخفاء موضوع منتدى من شريط التبويبات. |
| `unhide_forum_topic` | كتابة | `chat_id`, `topic_id`, `account?` | إظهار موضوع منتدى مخفي. |
| `delete_topic` | كتابة | `chat_id`, `topic_id`, `account?` | حذف موضوع منتدى بالكامل (حذف جميع رسائله للجميع ثم إخفاؤه). |
| `analyze_group` | قراءة | `chat_id`, `mode="summary"`, `inactivity_days=90`, `account?` | تحليل شامل لمجموعة منتدى: إحصائيات الرسائل، كشف المواضيع المكررة، المواضيع الناقصة، والمواضيع الخاملة (`dead_topics`). يدعم وضع الملخص `summary` والتفصيل `detail`. |
| `export_analyze_group_excel` | قراءة | `chat_id`, `output_path`, `inactivity_days=90`, `account?` | تشغيل التحليل الشامل للمجموعة وتصدير النتائج في ملف Excel (`.xlsx`) منظم في 5 أوراق عمل (Summary, Topics, Duplicates, Gaps, Dead Topics). |
| `get_ref_map` | قراءة | `job_id`, `source_chat_id?`, `source_msg_id?`, `dest_chat_id?`, `dest_msg_id?`, `list_all=False`, `stats_only=False` | الاستعلام عن خريطة المراجع المتقاطعة (`RefMap`) لمهمة ترحيل لمعرفة أي رسالة مصدرية تقابل أي رسالة في الهدف. |

---

### 7. الوسائط والملفات والملصقات (`media.py`) — 12 أداة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `send_file` | كتابة | `chat_id`, `file_path`, `caption?`, `account?` | إرسال ملف مفرد (أو قائمة من 2-10 ملفات كألبوم واحد) إلى محادثة مع وصف اختياري. |
| `send_album` | كتابة | `chat_id`, `file_paths`, `caption?`, `account?` | إرسال مجموعة صور أو فيديوهات (من 2 إلى 10 ملفات) كألبوم وسائط مجمّع. |
| `download_media` | كتابة | `chat_id`, `message_id`, `file_path?`, `account?` | تنزيل الوسائط المرفقة برسالة معينة وحفظها محلياً مع التعرف التلقائي على الامتداد الحقيقي للملف. |
| `upload_file` | كتابة | `file_path`, `account?` | رفع ملف محلي إلى خوادم تيليجرام وإرجاع بياناته الوصفية (الاسم، الحجم، بصمة MD5). |
| `get_media_info` | قراءة | `chat_id`, `message_id`, `account?` | جلب المعلومات التقنية عن الوسائط المرفقة في رسالة محددة. |
| `send_voice` | كتابة | `chat_id`, `file_path`, `account?` | إرسال مقطع صوتي بصيغة `.ogg` أو `.opus` كرسالة صوتية (Voice Note). |
| `get_sticker_sets` | قراءة | `account?` | جلب قائمة بجميع حزم الملصقات (Sticker Sets) المضافة في الحساب. |
| `send_sticker` | كتابة | `chat_id`, `file_path`, `account?` | إرسال ملف `.webp` كملصق (Sticker) إلى محادثة. |
| `get_gif_search` | قراءة | `query`, `limit=10`, `account?` | البحث عن صور متحركة (GIFs) وإرجاع قائمة بمعرفات المستندات (`Document IDs`) الخاصة بها. |
| `send_gif` | كتابة | `chat_id`, `gif_id`, `account?` | إرسال صورة متحركة (GIF) إلى محادثة باستخدام معرفها (`gif_id`) الناتج من `get_gif_search`. |
| `publish_media_with_template` | كتابة | `target_chat_id`, `target_topic_id`, `cleaned_text`, `media_payload?`, `content_hash?`, `account?` | نشر نص منسق ووسائط (ملف أو ألبوم) إلى موضوع محدد مع التحقق المسبق من صلاحية الموضوع، دعم إعادة المحاولة التلقائية عند انقطاع الشبكة، وإرجاع حالات مهيكلة (`SUCCESS`, `FAILED_FLOODWAIT`, `EMPTY_AFTER_CLEANING`). |
| `validate_topic` | قراءة | `chat_id`, `topic_id`, `account?` | التحقق مما إذا كان موضوع المنتدى موجوداً ومفتوحاً للنشر (`{"valid": true, "can_post": true}`). |

---

### 8. الملف الشخصي والخصوصية والبوتات (`profile.py`) — 11 أداة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `get_me` | قراءة | `account?` | جلب معلومات حسابك الشخصي الحالي بصيغة JSON. |
| `update_profile` | كتابة | `first_name?`, `last_name?`, `about?`, `account?` | تحديث الاسم الأول، اسم العائلة، أو النبذة الشخصية (Bio) لحسابك. |
| `set_profile_photo` | كتابة | `file_path`, `account?` | تعيين صورة شخصية جديدة للحساب من ملف محلي. |
| `delete_profile_photo` | كتابة | `account?` | حذف الصورة الشخصية الحالية للحساب. |
| `get_privacy_settings` | قراءة | `account?` | جلب إعدادات الخصوصية الخاصة بآخر ظهور (`Last Seen Status`). |
| `set_privacy_settings` | كتابة | `key`, `allow_users?`, `disallow_users?`, `account?` | تعديل إعدادات الخصوصية (`status` لآخر ظهور، `phone` لرقم الهاتف، `profile_photo` للصورة الشخصية) وتحديد قوائم السماح والمنع. |
| `get_full_user` | قراءة | `username`, `account?` | جلب الملف الشخصي الكامل لأي مستخدم: النبذة (`bio`)، القناة الشخصية المربوطة، تاريخ الميلاد، حالة التوثيق وPremium، وعدد المجموعات المشتركة. |
| `get_user_photos` | قراءة | `user_id`, `limit=10`, `account?` | جلب معرفات الصور الشخصية لمستخدم معين. |
| `get_user_status` | قراءة | `user_id`, `account?` | جلب حالة اتصال مستخدم معين (متصل، آخر ظهور...). |
| `get_bot_info` | قراءة | `bot_username`, `account?` | جلب معلومات تفصيلية عن بوت معين عبر معرفه. |
| `set_bot_commands` | كتابة | `bot_username`, `commands`, `account?` | ضبط قائمة الأوامر (`commands`) لبوت (تعمل فقط إذا كان الحساب المشغّل نفسه حساب بوت). |

---

### 9. مجلدات وفلاتر المحادثات (`folders.py`) — 7 أدوات

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `list_folders` | قراءة | `account?` | عرض جميع مجلدات المحادثات (Chat Folders) في الحساب مع معرفاتها، الإيموجي، وإعدادات الفلترة. |
| `get_folder` | قراءة | `folder_id`, `account?` | جلب تفاصيل مجلد محدد بما في ذلك أسماء ومعرفات جميع المحادثات المضمنة، المستبعدة، والمثبتة داخله. |
| `create_folder` | كتابة | `title`, `emoticon?`, `chat_ids?`, `contacts...`, `account?` | إنشاء مجلد محادثات جديد (بحد أقصى 10 مجلدات مخصصة حسب قيود تيليجرام). |
| `add_chat_to_folder` | كتابة | `folder_id`, `chat_id`, `pinned=False`, `account?` | إضافة محادثة إلى مجلد موجود مع إمكانية تثبيتها داخل المجلد. |
| `remove_chat_from_folder` | كتابة | `folder_id`, `chat_id`, `account?` | إزالة محادثة من مجلد معين (دون حذف المحادثة نفسها). |
| `delete_folder` | كتابة | `folder_id`, `account?` | حذف مجلد مخصص (مع بقاء جميع المحادثات محفوظة في الحساب). |
| `reorder_folders` | كتابة | `folder_ids`, `account?` | تغيير ترتيب ظهور المجلدات في تطبيق تيليجرام. |

---

### 10. التتبع اللحظي للأحداث والرسائل (`events.py`) — أداتان

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `wait_for_new_message` | قراءة | `timeout=50.0` | الانتظار حتى وصول أي رسالة خاصة جديدة وإرجاع قائمة بالمحادثات التي لديها رسائل معلقة فوراً. |
| `wait_for_settled_message` | قراءة | `settle_ms=6000`, `max_wait_ms=50000` | انتظار ذكي مع تجميع الرسائل المتتالية (**Debounced Wait**) ليُرجع للوكيل دفعة الرسائل كاملة دفعة واحدة بعد توقف الطرف الآخر عن الكتابة. |

---

### 11. نسخ مواضيع المنتديات (`forum_forward.py`) — أداة واحدة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `forward_topics_from_group` | كتابة | `from_chat_id`, `to_chat_id`, `delay=0.5`, `job_id?`, `force=False`, `account?` | نسخ جميع مواضيع المنتدى من مجموعة خارقة إلى أخرى **بدون وسم التحويل**، مع حفظ التقدم بعد كل موضوع في `JobStore` لإمكانية الاستئناف. |

---

### 12. تحليل المحتوى والترحيل المنسق (`content.py`) — أداتان

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `analyze_chat_content` | قراءة | `chat_id`, `limit=500`, `account?` | فحص محتوى المحادثة وتجميع الرسائل المرتبطة ببعضها (Multi-part groups)، اكتشاف التجمعات المكررة عبر بصمة المحتوى، وحساب ملخص درجات الجودة. |
| `curate_content_to_group` | كتابة | `source_chat_id`, `target_chat_id`, `target_topic_id?`, `delay=0.5`, `job_id?`, `force=False`, `account?` | ترحيل منسق للمحتوى إلى مجموعة أو موضوع هدف مع الحفاظ على ترابط وترتيب الرسائل متعددة الأجزاء، واختيار النسخة الأعلى جودة تلقائياً. |

---

### 13. قاعدة البيانات وتتبع الحلقات ومنع التكرار (`database.py`) — 10 أدوات

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `initialize_database` | كتابة | `account?` | تهيئة قاعدة بيانات SQLite وإنشاء الجداول المطلوبة وإرجاع مسار ملف القاعدة. |
| `compute_content_hash_tool` | قراءة | `text`, `file_name=""`, `file_size_bytes=0`, `account?` | حساب بصمة محتوى قياسية (`sha256:...`) بناءً على النص واسم الملف وحجمه لاكتشاف التكرار قبل النقل. |
| `check_duplicate` | قراءة | `source_channel_id`, `source_message_id`, `content_hash`, `account?` | التحقق مما إذا كانت الرسالة قد تمت معالجتها مسبقاً في قاعدة البيانات. |
| `record_message_status` | كتابة | `source_channel_id`, `source_message_id`, `content_hash`, `status`, `target_topic_id?`, `failure_reason?`, `account?` | تسجيل أو تحديث حالة معالجة الرسالة في قاعدة البيانات. |
| `get_message_status_tool` | قراءة | `content_hash`, `account?` | الاستعلام عن حالة رسالة معينة في قاعدة البيانات بواسطة بصمة المحتوى `content_hash`. |
| `add_series_episode_tool` | كتابة | `series_name`, `season_number`, `episode_number`, `telegram_message_id?`, `topic_id?`, `account?` | تسجيل حلقة مسلسل في جدول `series_episodes`. |
| `audit_series_sequence` | قراءة | `series_name`, `season_number`, `account?` | تدقيق تسلسل حلقات موسم معين لاكتشاف أرقام الحلقات المفقودة (`missing_episodes`). |
| `record_topic_binding` | كتابة | `series_name`, `chat_id`, `topic_id`, `binding_type="PRIMARY"`, `account?` | تسجيل ربط رسمي دائم بين اسم المسلسل ومعرف الموضوع في قاعدة البيانات. |
| `get_topic_binding` | قراءة | `series_name?`, `chat_id?`, `account?` | البحث في قاعدة البيانات عن الموضوع المرتبط بمسلسل معين. |
| `record_migration_progress` | كتابة | `job_id`, `source_topic_id?`, `target_topic_id?`, `increment=0`, `status?`, `account?` | تسجيل وتحديث تقدم مهام الترحيل الضخمة داخل جدول `migration_jobs`. |

---

### 14. الترحيل الذاتي الشامل وإدارة المهام (`migration.py`) — 15 أداة

| الأداة | النوع | المعاملات الأساسية | الشرح |
|---|---|---|---|
| `start_autonomous_migration` | كتابة | `source_chat_id`, `target_chat_id`, `job_id?`, `account?` | إطلاق مهمة ترحيل ذاتية شاملة من مجموعة منتدى إلى أخرى في الخلفية مع حفظ الحالة في `JobStore`. |
| `pause_migration` | كتابة | `job_id`, `account?` | إيقاف مؤقت لمهمة ترحيل قيد التشغيل. |
| `resume_migration` | كتابة | `job_id`, `account?` | استئناف مهمة ترحيل متوقفة مؤقتاً من آخر موضوع تم ترحيله. |
| `get_migration_status` | قراءة | `job_id`, `account?` | الاستعلام عن حالة مهمة الترحيل الحالية (النسبة المئوية، المواضيع المنجزة، والمتبقية). |
| `stop_migration` | كتابة | `job_id`, `account?` | إنهاء وإلغاء مهمة ترحيل نهائياً. |
| `list_migration_jobs` | قراءة | `account?` | استعراض كافة مهام الترحيل المسجلة وحالاتها. |
| `reorder_series_episodes` | كتابة | `source_chat_id`, `source_topic_id`, `target_chat_id`, `target_topic_id`, `account?` | **إعادة الترتيب الصارم للحلقات:** أداة مخصصة لإصلاح المواضيع التي انعكس فيها ترتيب الحلقات؛ تقوم بمسح الموضوع الهدف، استخراج أرقام الحلقات (بالعربية والإنجليزية مثل `الحلقة 5` أو `S01E05` أو `EP05`)، إزالة المكرر والضوضاء، ثم إعادة إرسالها واحدة تلو الأخرى بترتيب تصاعدي صارم والتحقق من صحة التسلسل النهائي. |
