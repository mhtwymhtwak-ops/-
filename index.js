'use strict';

// ─── Load .env ───────────────────────────────────────────────────────────────
const _fs0   = require('fs');
const _path0 = require('path');
const _envPath = _path0.resolve(__dirname, '.env');
if (_fs0.existsSync(_envPath)) {
  _fs0.readFileSync(_envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#=\s][^=\s]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  });
}

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');
const TelegramBot = require('node-telegram-bot-api');
const qrcode = require('qrcode');
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

// ─── Config ──────────────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID   = process.env.ADMIN_ID
  ? Number(process.env.ADMIN_ID)
  : process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;

const CHECK_CONCURRENCY = Math.max(1, Number(process.env.CHECK_CONCURRENCY || 5));
const CHECK_DELAY_MS    = Math.max(0, Number(process.env.CHECK_DELAY_MS    || 100));
const SESSIONS_DIR      = path.resolve(process.env.SESSIONS_DIR || path.join(__dirname, 'sessions'));
const BATCH_SIZE        = 500;

if (!BOT_TOKEN) { console.error('❌  BOT_TOKEN is required.'); process.exit(1); }
if (!ADMIN_ID || Number.isNaN(ADMIN_ID)) { console.error('❌  ADMIN_ID is required.'); process.exit(1); }
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function isAdmin(id) { return Number(id) === ADMIN_ID; }
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── Translations ─────────────────────────────────────────────────────────────
const STRINGS = {
  ar: {
    main_menu:          '👋 <b>القائمة الرئيسية</b>\n\nالحالة: {status}',
    link_account:       '🔗 ربط الحساب',
    restore_session:    '♻️ استعادة الجلسة',
    check_numbers:      '🔢 فحص الأرقام',
    status_btn:         '📊 الحالة',
    help_btn:           '❓ مساعدة',
    broadcast_btn:      '📢 رسالة جماعية',
    users_btn:          '👥 المستخدمون',
    logout_btn:         '🚪 تسجيل خروج',
    lang_btn:           '🌐 English',
    back_btn:           '🔙 رجوع',
    home_btn:           '🏠 الرئيسية',
    refresh_btn:        '🔄 تحديث',
    check_btn:          '🔢 فحص',
    link_btn:           '🔗 ربط',
    logout_btn2:        '🚪 خروج',
    qr_btn:             '📷 QR كود',
    phone_btn:          '📱 رقم الهاتف',
    choose_link:        '🔗 اختر طريقة الربط:',
    connecting:         '⏳ جاري الاتصال بواتساب...',
    status_title:       '📊 <b>حالة الجلسة</b>',
    status_label:       '• الحالة: {v}',
    method_label:       '• طريقة الربط: {v}',
    method_qr:          'QR كود',
    method_phone:       'رقم الهاتف',
    method_restore:     'استعادة محفوظة',
    method_borrowed:    '🔌 مستعارة',
    acc_info:           '👤 <b>معلومات الحساب</b>',
    acc_name:           '• الاسم: {v}',
    acc_phone:          '• الرقم: <code>{v}</code>',
    timing:             '⏱ <b>التوقيت</b>',
    ready_at:           '• الجاهزية: {v}',
    duration:           '• مدة الاتصال: {v}',
    check_stats:        '📈 <b>إحصائيات الفحص</b>',
    check_stats_val:    '• إجمالي: {total} | ✅ {reg} | ❌ {unreg} | ⚠️ {err}',
    pairing_code_label: '🔑 رمز الربط: <code>{v}</code>',
    last_error:         '⚠️ آخر خطأ: {v}',
    help_text:
      '📖 <b>طريقة الاستخدام</b>\n\n' +
      '1) اضغط «🔗 ربط الحساب» واختر QR أو رقم الهاتف.\n' +
      '2) بعد الربط أرسل ملف .txt/.csv مباشرة.\n' +
      '3) كل ضغطة = 100 رقم عشوائي من البادئة المختارة.\n' +
      '4) النتائج: ✅ المسجلة أولًا ثم ❌ غير المسجلة.\n\n' +
      '• «♻️ استعادة الجلسة» تُعيد الاتصال بجلسة محفوظة.',
    help_admin_extra:   '\n• 👥 «المستخدمون» — إدارة الجلسات.',
    must_link:          '⚠️ يجب الربط أولًا.\nالحالة: {status}',
    send_numbers:       '📥 أرسل قائمة الأرقام أو ملف .txt/.csv الآن.\n(حتى {batch} رقم/رسالة)',
    checked_so_far:     '\n📊 تم فحص <b>{n}</b> رقم في هذه الجلسة.',
    send_phone:         '📱 أرسل رقم هاتفك مع رمز الدولة بدون + (مثال: 9677xxxxxxxx)',
    no_users:           '👥 لا يوجد مستخدمون مرتبطون حاليًا.',
    users_title:        '👥 <b>المستخدمون المرتبطون ({n})</b>\n',
    use_btn:            '🔌 استخدام',
    kick_btn:           '🚪 طرد',
    msg_btn:            '📩 مراسلة',
    dm_prompt:          '📩 اكتب الرسالة التي تريد إرسالها لـ <b>{name}</b>:',
    dm_sent:            '✅ تم إرسال الرسالة لـ {name}.',
    dm_failed:          '⚠️ فشل إرسال الرسالة: {e}',
    dm_received:        '📩 <b>رسالة من الأدمن</b>\n\n{text}',
    user_not_found:     '⚠️ المستخدم غير موجود.',
    kicked:             '✅ تم طرد {name}.',
    session_ended:      '⚠️ تم إنهاء جلستك من قِبَل الأدمن.',
    qr_caption:         '📲 افتح واتساب › الأجهزة المرتبطة › ربط جهاز، ثم امسح هذا الكود.',
    qr_fail:            '⚠️ تعذر إرسال QR: {e}',
    pairing_title:
      '🔑 <b>رمز ربط الجهاز</b>\n\n' +
      'افتح واتساب › الأجهزة المرتبطة › ربط جهاز › ربط برقم الهاتف:\n\n' +
      '<code>{code}</code>\n\n⌛ صالح لمدة 60 ثانية.',
    copy_code:          '📋 نسخ الرمز: {code}',
    pairing_fail:       '⚠️ فشل توليد رمز التحقق: {e}',
    connected:          '✅ <b>تم الربط بنجاح</b> {name}\n\nأرسل ملفًا أو اضغط «🔢 فحص الأرقام».',
    new_user_notif:
      '🔔 <b>مستخدم جديد ربط جلسة</b>\n\n' +
      '🆔 Telegram ID: <code>{uid}</code>\n' +
      '👤 الاسم: {name}\n' +
      '📞 الرقم: <code>{phone}</code>\n' +
      '📅 وقت الربط: {time}',
    use_session_btn:    '🔌 استخدام جلسته',
    logged_out_wa:      '⚠️ تم تسجيل الخروج من واتساب.',
    disconnected:       '⚠️ انقطع الاتصال: {reason}',
    session_active:     '✅ الجلسة نشطة بالفعل.',
    no_saved_session:   '⚠️ لا توجد جلسة محفوظة. استخدم «🔗 ربط الحساب».',
    restoring:          '♻️ جاري استعادة الجلسة المحفوظة...',
    logging_out:        '🚪 جاري تسجيل الخروج...',
    logged_out:         '✅ تم تسجيل الخروج وحذف الجلسة.',
    session_fail:       '⚠️ تعذر بدء الجلسة: {e}',
    file_only_text:     '⚠️ يُقبل ملفات النص فقط (.txt أو .csv).',
    file_too_big:       '⚠️ الملف كبير جدًا (5 MB حد أقصى).',
    reading_file:       '⏳ جاري قراءة الملف...',
    no_valid_numbers:   '⚠️ لم أجد أرقامًا صالحة.',
    file_analyzed:
      '📂 <b>تم تحليل الملف</b>\n\n' +
      '📊 الأرقام: <b>{total}</b> | المجموعات: <b>{groups}</b>\n\n' +
      '👇 اختر مجموعة — كل ضغطة = 100 عشوائي بدون تكرار',
    file_read_fail:     '⚠️ تعذر قراءة الملف: {e}',
    no_numbers_found:   '⚠️ لم أتعرف على أرقام صالحة.',
    invalid_phone:      '⚠️ رقم غير صالح.',
    preparing_code:     '⏳ جاري تجهيز رمز الربط...',
    not_linked:         '⚠️ غير مربوط.',
    checking:           '🔎 جاري فحص <b>{n}</b> رقم...',
    check_report:
      '📋 <b>تقرير فحص جديد</b>\n\n' +
      '👤 <b>المستخدم:</b>\n' +
      '• الاسم: {name}\n• رقم واتساب: <code>{phone}</code>\n' +
      '• Telegram ID: <code>{uid}</code>\n• وقت الفحص: {time}\n\n' +
      '📊 <b>النتائج:</b>\n• ✅ مسجل: {reg}\n• ❌ غير مسجل: {unreg}\n• ⚠️ أخطاء: {err}\n• إجمالي: {total}',
    registered_title:   '✅ <b>الأرقام المسجلة [ {n} ]</b>\nاضغط على أي رقم لنسخه:',
    unregistered_title: '❌ <b>الأرقام غير المسجلة [ {n} ]</b>\nاضغط على أي رقم لنسخه:',
    errors_count:       '⚠️ أخطاء في الفحص: {n} رقم',
    check_summary:      '📊 <b>ملخص الفحص</b>\n✅ مسجل: {reg} | ❌ غير مسجل: {unreg}',
    no_checked:         '⚠️ لم يتم فحص أي رقم.',
    back_to_list:       '↩️ رجوع للقائمة (فحصت: {n})',
    check_more:         '🔢 فحص أخرى ({n})',
    check_more_plain:   '🔢 فحص أخرى',
    prefix_title:       '📞 <b>بادئة {p}</b> | إجمالي: {total} | ✅ تم: {done}\n\n👇 اختر بادئة فرعية:',
    batch_info:         '🎲 بادئة <b>{p}</b> | 📦 {n} رقم | 🔁 متبقٍ: {left}',
    next_round:         '🔁 جولة جديدة من {p} ({left} متبقٍ)',
    back_to_prefix:     '↩️ رجوع لـ {p}',
    prefix_list:        '📋 قائمة البادئات ({n})',
    next_action:        '▸ اختر الإجراء التالي:',
    back_to_prefixes:   '↩️ رجوع للبادئات',
    all_checked:        '✅ تم فحص جميع أرقام هذه البادئة!',
    session_not_ready:  '⚠️ الجلسة غير مربوطة.',
    expired_choice:     '⚠️ انتهت صلاحية الاختيار. أرسل الملف مجددًا.',
    expired_choice2:    '⚠️ انتهت صلاحية الاختيار.',
    no_file_loaded:     '⚠️ لا يوجد ملف محمّل.',
    checked_so_far2:    '\n\n✅ تم فحص: <b>{n}</b> رقم حتى الآن',
    broadcast_prompt:   '📢 <b>رسالة جماعية</b>\n\nاكتب الرسالة التي تريد إرسالها لجميع المستخدمين:',
    admin_only:         '⛔ للأدمن فقط.',
    no_users_now:       '⚠️ لا يوجد مستخدمون حالياً.',
    sending_broadcast:  '📤 جاري الإرسال لـ {n} مستخدم...',
    broadcast_msg:      '📢 <b>رسالة من الأدمن</b>\n\n{text}',
    broadcast_done:     '✅ <b>تم الإرسال</b>\n\n• وصلت: {ok}\n• فشلت: {fail}',
    broadcast_done2:    '✅ وصلت: {ok} | فشلت: {fail}',
    user_info_title:    '👤 <b>معلومات المستخدم</b>',
    user_session_ready: '🔌 <b>تم ربط جلسة المستخدم</b>\n👤 {name} | 📞 {phone}\n\nأرسل ملفًا أو اضغط «🔢 فحص الأرقام».',
    session_not_ready2: '⚠️ جلسة هذا المستخدم غير جاهزة.',
    lang_changed:       '✅ تم تغيير اللغة إلى العربية 🇸🇦',
    status_ready:       '✅ مربوط وجاهز',
    status_connecting:  '⏳ جاري الاتصال...',
    status_qr:          '📷 بانتظار مسح QR',
    status_pairing:     '📱 بانتظار رمز الربط',
    status_disconnected:'❌ غير مربوط',
    groups_btn:         '📂 ملفات القروبات',
    no_groups:          '📂 لا يوجد قروبات مضافة بعد.\n\nأضف البوت لأي قروب وسيبدأ بحفظ الملفات تلقائياً.',
    groups_title:       '📂 <b>القروبات ({n})</b>\n\nاختر قروب لعرض ملفاته:',
    no_files_group:     '📭 لم يُرسل في هذا القروب أي ملف بعد.',
    group_files_title:  '📂 <b>{name}</b>\n\n📄 الملفات ({n}):\nاختر ملف لتحميله وفحصه:',
    file_loading:       '⏳ جاري تحميل الملف...',
    clear_group_btn:    '🗑 مسح ملفات القروب',
    group_cleared:      '✅ تم مسح ملفات {name}.',
    forwarded_saved:    '✅ <b>تم حفظ الملف</b> في قروب «{group}»\n\nاضغط 📂 ملفات القروبات لعرضه واختياره للفحص.',
    link_group_btn:     '🔗 ربط قناة / قروب',
    send_group_username:'📎 أرسل يوزرنيم القناة أو القروب\n(مثال: <code>@channelname</code>)\n\n⚠️ تأكد أن البوت مضاف كأدمن فيها أولاً.',
    group_linked:       '✅ <b>تم ربط القناة/القروب بنجاح</b>\n\n📂 الاسم: <b>{name}</b>\n\nأي ملف .txt أو .csv ينزل فيها سيظهر تلقائياً في «📂 ملفات القروبات».',
    group_link_fail:    '⚠️ تعذّر الوصول إلى القناة/القروب.\n\nتحقق من:\n• صحة اليوزرنيم\n• إضافة البوت كأدمن فيها',
    group_link_already: 'ℹ️ القناة/القروب مربوطة مسبقاً: <b>{name}</b>',
  },
  en: {
    main_menu:          '👋 <b>Main Menu</b>\n\nStatus: {status}',
    link_account:       '🔗 Link Account',
    restore_session:    '♻️ Restore Session',
    check_numbers:      '🔢 Check Numbers',
    status_btn:         '📊 Status',
    help_btn:           '❓ Help',
    broadcast_btn:      '📢 Broadcast',
    users_btn:          '👥 Users',
    logout_btn:         '🚪 Logout',
    lang_btn:           '🌐 العربية',
    back_btn:           '🔙 Back',
    home_btn:           '🏠 Home',
    refresh_btn:        '🔄 Refresh',
    check_btn:          '🔢 Check',
    link_btn:           '🔗 Link',
    logout_btn2:        '🚪 Logout',
    qr_btn:             '📷 QR Code',
    phone_btn:          '📱 Phone Number',
    choose_link:        '🔗 Choose link method:',
    connecting:         '⏳ Connecting to WhatsApp...',
    status_title:       '📊 <b>Session Status</b>',
    status_label:       '• Status: {v}',
    method_label:       '• Link method: {v}',
    method_qr:          'QR Code',
    method_phone:       'Phone Number',
    method_restore:     'Saved restore',
    method_borrowed:    '🔌 Borrowed',
    acc_info:           '👤 <b>Account Info</b>',
    acc_name:           '• Name: {v}',
    acc_phone:          '• Number: <code>{v}</code>',
    timing:             '⏱ <b>Timing</b>',
    ready_at:           '• Ready at: {v}',
    duration:           '• Connected for: {v}',
    check_stats:        '📈 <b>Check Statistics</b>',
    check_stats_val:    '• Total: {total} | ✅ {reg} | ❌ {unreg} | ⚠️ {err}',
    pairing_code_label: '🔑 Pairing code: <code>{v}</code>',
    last_error:         '⚠️ Last error: {v}',
    help_text:
      '📖 <b>How to use</b>\n\n' +
      '1) Press «🔗 Link Account» and choose QR or phone number.\n' +
      '2) After linking, send a .txt/.csv file directly.\n' +
      '3) Each press = 100 random numbers from the selected prefix.\n' +
      '4) Results: ✅ Registered first, then ❌ Not registered.\n\n' +
      '• «♻️ Restore Session» reconnects a saved session.',
    help_admin_extra:   '\n• 👥 «Users» — manage sessions.',
    must_link:          '⚠️ You must link first.\nStatus: {status}',
    send_numbers:       '📥 Send your number list or a .txt/.csv file now.\n(up to {batch} numbers/message)',
    checked_so_far:     '\n📊 Checked <b>{n}</b> numbers this session.',
    send_phone:         '📱 Send your phone number with country code, no + (e.g. 9677xxxxxxxx)',
    no_users:           '👥 No users currently linked.',
    users_title:        '👥 <b>Linked Users ({n})</b>\n',
    use_btn:            '🔌 Use',
    kick_btn:           '🚪 Kick',
    msg_btn:            '📩 Message',
    dm_prompt:          '📩 Write the message to send to <b>{name}</b>:',
    dm_sent:            '✅ Message sent to {name}.',
    dm_failed:          '⚠️ Failed to send message: {e}',
    dm_received:        '📩 <b>Message from admin</b>\n\n{text}',
    user_not_found:     '⚠️ User not found.',
    kicked:             '✅ Kicked {name}.',
    session_ended:      '⚠️ Your session was ended by the admin.',
    qr_caption:         '📲 Open WhatsApp › Linked Devices › Link a Device, then scan this code.',
    qr_fail:            '⚠️ Failed to send QR: {e}',
    pairing_title:
      '🔑 <b>Device Pairing Code</b>\n\n' +
      'Open WhatsApp › Linked Devices › Link a Device › Link with phone number:\n\n' +
      '<code>{code}</code>\n\n⌛ Valid for 60 seconds.',
    copy_code:          '📋 Copy code: {code}',
    pairing_fail:       '⚠️ Failed to generate pairing code: {e}',
    connected:          '✅ <b>Linked successfully</b> {name}\n\nSend a file or press «🔢 Check Numbers».',
    new_user_notif:
      '🔔 <b>New user linked a session</b>\n\n' +
      '🆔 Telegram ID: <code>{uid}</code>\n' +
      '👤 Name: {name}\n' +
      '📞 Number: <code>{phone}</code>\n' +
      '📅 Linked at: {time}',
    use_session_btn:    '🔌 Use their session',
    logged_out_wa:      '⚠️ Logged out from WhatsApp.',
    disconnected:       '⚠️ Disconnected: {reason}',
    session_active:     '✅ Session is already active.',
    no_saved_session:   '⚠️ No saved session. Use «🔗 Link Account».',
    restoring:          '♻️ Restoring saved session...',
    logging_out:        '🚪 Logging out...',
    logged_out:         '✅ Logged out and session deleted.',
    session_fail:       '⚠️ Failed to start session: {e}',
    file_only_text:     '⚠️ Only text files are accepted (.txt or .csv).',
    file_too_big:       '⚠️ File is too large (max 5 MB).',
    reading_file:       '⏳ Reading file...',
    no_valid_numbers:   '⚠️ No valid numbers found.',
    file_analyzed:
      '📂 <b>File analyzed</b>\n\n' +
      '📊 Numbers: <b>{total}</b> | Groups: <b>{groups}</b>\n\n' +
      '👇 Choose a group — each press = 100 random without repetition',
    file_read_fail:     '⚠️ Failed to read file: {e}',
    no_numbers_found:   '⚠️ No valid numbers recognized.',
    invalid_phone:      '⚠️ Invalid phone number.',
    preparing_code:     '⏳ Preparing pairing code...',
    not_linked:         '⚠️ Not linked.',
    checking:           '🔎 Checking <b>{n}</b> numbers...',
    check_report:
      '📋 <b>New Check Report</b>\n\n' +
      '👤 <b>User:</b>\n' +
      '• Name: {name}\n• WhatsApp: <code>{phone}</code>\n' +
      '• Telegram ID: <code>{uid}</code>\n• Time: {time}\n\n' +
      '📊 <b>Results:</b>\n• ✅ Registered: {reg}\n• ❌ Not registered: {unreg}\n• ⚠️ Errors: {err}\n• Total: {total}',
    registered_title:   '✅ <b>Registered Numbers [ {n} ]</b>\nTap any number to copy:',
    unregistered_title: '❌ <b>Not Registered [ {n} ]</b>\nTap any number to copy:',
    errors_count:       '⚠️ Check errors: {n} numbers',
    check_summary:      '📊 <b>Check Summary</b>\n✅ Registered: {reg} | ❌ Not registered: {unreg}',
    no_checked:         '⚠️ No numbers were checked.',
    back_to_list:       '↩️ Back to list (checked: {n})',
    check_more:         '🔢 Check more ({n})',
    check_more_plain:   '🔢 Check more',
    prefix_title:       '📞 <b>Prefix {p}</b> | Total: {total} | ✅ Done: {done}\n\n👇 Choose a sub-prefix:',
    batch_info:         '🎲 Prefix <b>{p}</b> | 📦 {n} numbers | 🔁 Remaining: {left}',
    next_round:         '🔁 New round from {p} ({left} remaining)',
    back_to_prefix:     '↩️ Back to {p}',
    prefix_list:        '📋 Prefix list ({n})',
    next_action:        '▸ Choose next action:',
    back_to_prefixes:   '↩️ Back to prefixes',
    all_checked:        '✅ All numbers in this prefix have been checked!',
    session_not_ready:  '⚠️ Session not linked.',
    expired_choice:     '⚠️ Selection expired. Send the file again.',
    expired_choice2:    '⚠️ Selection expired.',
    no_file_loaded:     '⚠️ No file loaded.',
    checked_so_far2:    '\n\n✅ Checked: <b>{n}</b> numbers so far',
    broadcast_prompt:   '📢 <b>Broadcast</b>\n\nWrite the message to send to all users:',
    admin_only:         '⛔ Admins only.',
    no_users_now:       '⚠️ No users currently.',
    sending_broadcast:  '📤 Sending to {n} users...',
    broadcast_msg:      '📢 <b>Message from admin</b>\n\n{text}',
    broadcast_done:     '✅ <b>Sent</b>\n\n• Delivered: {ok}\n• Failed: {fail}',
    broadcast_done2:    '✅ Delivered: {ok} | Failed: {fail}',
    user_info_title:    '👤 <b>User Info</b>',
    user_session_ready: '🔌 <b>Using user session</b>\n👤 {name} | 📞 {phone}\n\nSend a file or press «🔢 Check Numbers».',
    session_not_ready2: '⚠️ This user\'s session is not ready.',
    lang_changed:       '✅ Language changed to English 🇬🇧',
    groups_btn:         '📂 Group Files',
    no_groups:          '📂 No groups added yet.\n\nAdd the bot to any group and it will save files automatically.',
    groups_title:       '📂 <b>Groups ({n})</b>\n\nChoose a group to view its files:',
    no_files_group:     '📭 No files have been sent in this group yet.',
    group_files_title:  '📂 <b>{name}</b>\n\n📄 Files ({n}):\nChoose a file to load and check:',
    file_loading:       '⏳ Loading file...',
    clear_group_btn:    '🗑 Clear group files',
    group_cleared:      '✅ Files cleared for {name}.',
    forwarded_saved:    '✅ <b>File saved</b> under group «{group}»\n\nPress 📂 Group Files to view and select it for checking.',
    link_group_btn:     '🔗 Link Channel / Group',
    send_group_username:'📎 Send the channel or group username\n(e.g. <code>@channelname</code>)\n\n⚠️ Make sure the bot is added as admin first.',
    group_linked:       '✅ <b>Channel/Group linked successfully</b>\n\n📂 Name: <b>{name}</b>\n\nAny .txt or .csv file posted there will appear automatically in «📂 Group Files».',
    group_link_fail:    '⚠️ Could not access the channel/group.\n\nCheck:\n• Username is correct\n• Bot is added as admin',
    group_link_already: 'ℹ️ Already linked: <b>{name}</b>',
    status_ready:       '✅ Linked & ready',
    status_connecting:  '⏳ Connecting...',
    status_qr:          '📷 Waiting for QR scan',
    status_pairing:     '📱 Waiting for pairing code',
    status_disconnected:'❌ Not linked',
  },
};

function t(lang, key, vars = {}) {
  const str = (STRINGS[lang] || STRINGS.ar)[key] || STRINGS.ar[key] || key;
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] !== undefined ? vars[k] : `{${k}}`);
}

// ─── State ───────────────────────────────────────────────────────────────────
const userStates      = new Map();
const userFilePending = new Map();
const monitoredGroups = new Map(); // groupChatId -> { name, username }
const groupFiles      = new Map(); // groupChatId -> Array<{ fileId, fileName, date }>
const MAX_FILES_PER_GROUP = 200;

function getState(userId) {
  if (!userStates.has(userId)) {
    userStates.set(userId, {
      sock: null, status: 'disconnected', method: null, screen: 'main',
      pairingRequested: false, pairingCode: null,
      chatId: null, info: null, connectedAt: null, authenticatedAt: null,
      lastDisconnectReason: null, lastError: null, userId, lang: 'ar', pendingDmTarget: null,
      checks: { totalChecked: 0, registered: 0, unregistered: 0, errors: 0 },
    });
  }
  return userStates.get(userId);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function cleanNumber(raw) { return String(raw || '').replace(/\D+/g, ''); }
function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function hasSavedSession(userId) {
  return fs.existsSync(path.join(SESSIONS_DIR, `session-${userId}`, 'creds.json'));
}
function statusLabel(st) {
  const l = st.lang || 'ar';
  switch (st.status) {
    case 'ready':           return t(l, 'status_ready');
    case 'connecting':      return t(l, 'status_connecting');
    case 'qr_pending':      return t(l, 'status_qr');
    case 'pairing_pending': return t(l, 'status_pairing');
    default:                return t(l, 'status_disconnected');
  }
}
function formatDuration(ms) {
  if (!ms || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = [];
  if (d) p.push(`${d}d`); if (h) p.push(`${h}h`);
  if (m) p.push(`${m}m`); if (!d && !h) p.push(`${s % 60}s`);
  return p.join(' ');
}
function formatDateTime(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString('ar-EG', { timeZone: 'Asia/Riyadh' }); }
  catch (_) { return new Date(ts).toISOString(); }
}
function chunkLines(lines, maxLen = 3800) {
  const chunks = []; let buf = '';
  for (const line of lines) {
    const next = buf ? buf + '\n' + line : line;
    if (next.length > maxLen) { if (buf) chunks.push(buf); buf = line; } else buf = next;
  }
  if (buf) chunks.push(buf);
  return chunks;
}
function downloadUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, res => {
      const ch = [];
      res.on('data', c => ch.push(c));
      res.on('end', () => resolve(Buffer.concat(ch).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Country Codes & Grouping ─────────────────────────────────────────────────
const COUNTRY_CODES = new Set([
  '1','7','20','27','30','31','32','33','34','36','39',
  '40','41','43','44','45','46','47','48','49',
  '51','52','53','54','55','56','57','58',
  '60','61','62','63','64','65','66',
  '81','82','84','86','90','91','92','93','94','95','98',
  '211','212','213','216','218','220','221','222','223','224','225','226','227','228','229',
  '230','231','232','233','234','235','236','237','238','239',
  '240','241','242','243','244','245','246','247','248','249',
  '250','251','252','253','254','255','256','257','258',
  '260','261','262','263','264','265','266','267','268','269',
  '290','291','297','298','299',
  '350','351','352','353','354','355','356','357','358','359',
  '370','371','372','373','374','375','376','377','378','379',
  '380','381','382','383','385','386','387','389',
  '420','421','423','500','501','502','503','504','505','506','507','508','509',
  '590','591','592','593','594','595','596','597','598','599',
  '670','672','673','674','675','676','677','678','679',
  '680','681','682','683','685','686','687','688','689','690','691','692',
  '850','852','853','855','856','870','880','886',
  '960','961','962','963','964','965','966','967','968',
  '970','971','972','973','974','975','976','977',
  '992','993','994','995','996','998',
]);
function stripCountryCode(n) {
  for (let l = 3; l >= 1; l--) {
    if (COUNTRY_CODES.has(n.slice(0, l))) return n.slice(l);
  }
  return n;
}
function groupByPrefix(numbers) {
  const groups = {};
  for (const n of numbers) {
    const p = stripCountryCode(n).slice(0, 2);
    if (!groups[p]) groups[p] = [];
    groups[p].push(n);
  }
  return groups;
}
function groupBySubPrefix(numbers) {
  const groups = {};
  for (const n of numbers) {
    const p = stripCountryCode(n).slice(0, 3);
    if (!groups[p]) groups[p] = [];
    groups[p].push(n);
  }
  return groups;
}

// ─── Session Destroy ──────────────────────────────────────────────────────────
async function destroyClient(state) {
  const sock = state.sock;
  state.sock = null; state.status = 'disconnected'; state.pairingRequested = false;
  if (sock) {
    try { sock.ev.removeAllListeners(); } catch (_) {}
    try { await Promise.race([sock.end(new Error('destroy')), new Promise(r => setTimeout(r, 2000))]); } catch (_) {}
  }
}

// ─── Keyboards ────────────────────────────────────────────────────────────────
function mainMenuKeyboard(userId, lang = 'ar') {
  const rows = [
    [
      { text: t(lang, 'link_account'),    callback_data: 'menu_link' },
      { text: t(lang, 'restore_session'), callback_data: 'menu_restore' },
    ],
    [
      { text: t(lang, 'check_numbers'), callback_data: 'menu_check' },
      { text: t(lang, 'status_btn'),    callback_data: 'menu_status' },
    ],
    [
      { text: t(lang, 'help_btn'), callback_data: 'menu_help' },
      { text: t(lang, 'lang_btn'), callback_data: 'toggle_lang' },
    ],
  ];
  rows.push([
    { text: t(lang, 'groups_btn'),     callback_data: 'menu_groups' },
    { text: t(lang, 'link_group_btn'), callback_data: 'menu_link_group' },
  ]);
  if (isAdmin(userId)) {
    rows.push([{ text: t(lang, 'broadcast_btn'), callback_data: 'menu_broadcast' }]);
    rows.push([
      { text: t(lang, 'users_btn'),  callback_data: 'menu_users' },
      { text: t(lang, 'logout_btn'), callback_data: 'menu_logout' },
    ]);
  }
  return { inline_keyboard: rows };
}
function linkMenuKeyboard(lang = 'ar') {
  return { inline_keyboard: [
    [{ text: t(lang, 'qr_btn'), callback_data: 'link_qr' }, { text: t(lang, 'phone_btn'), callback_data: 'link_phone' }],
    [{ text: t(lang, 'back_btn'), callback_data: 'back_main' }],
  ]};
}
function backKeyboard(lang = 'ar') {
  return { inline_keyboard: [[{ text: t(lang, 'back_btn'), callback_data: 'back_main' }]] };
}
function statusKeyboard(state) {
  const lang = state.lang || 'ar';
  const row1 = [{ text: t(lang, 'refresh_btn'), callback_data: 'menu_status' }];
  if (state.status === 'ready') row1.push({ text: t(lang, 'check_btn'), callback_data: 'menu_check' });
  else row1.push({ text: t(lang, 'link_btn'), callback_data: 'menu_link' });
  const rows = [row1];
  if (isAdmin(state.userId)) rows.push([
    { text: t(lang, 'users_btn'),   callback_data: 'menu_users' },
    { text: t(lang, 'logout_btn2'), callback_data: 'menu_logout' },
  ]);
  rows.push([{ text: t(lang, 'back_btn'), callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}
function afterCheckKeyboard(userId, totalChecked, hasPending, lang = 'ar') {
  const rows = [];
  if (hasPending) rows.push([{ text: t(lang, 'back_to_list', { n: totalChecked }), callback_data: 'menu_file_list' }]);
  rows.push([
    { text: totalChecked > 0 ? t(lang, 'check_more', { n: totalChecked }) : t(lang, 'check_more_plain'), callback_data: 'menu_check' },
    { text: t(lang, 'status_btn'), callback_data: 'menu_status' },
  ]);
  rows.push([{ text: t(lang, 'home_btn'), callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}
function buildPrefixMarkup(parentGroups, checked, lang = 'ar') {
  const btns = Object.keys(parentGroups).sort().map(p => {
    const total = parentGroups[p].length;
    const done  = Object.entries(checked).filter(([k]) => k.startsWith(p)).reduce((s, [,v]) => s + v.size, 0);
    const icon  = done >= total ? '✅' : done > 0 ? '🔄' : '📞';
    return { text: `${icon} ${p} (${total})`, callback_data: `pfx:${p}` };
  });
  const rows = [];
  for (let i = 0; i < btns.length; i += 4) rows.push(btns.slice(i, i + 4));
  rows.push([{ text: t(lang, 'back_btn'), callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}
function buildSubPrefixMarkup(parentPrefix, subGroups, checked, lang = 'ar') {
  const btns = Object.keys(subGroups).filter(p => p.startsWith(parentPrefix)).sort().map(p => {
    const done = checked[p] ? checked[p].size : 0;
    const rem  = subGroups[p].length - done;
    const icon = rem === 0 ? '✅' : done > 0 ? '🔄' : '🔢';
    return { text: `${icon} ${p} (${rem})`, callback_data: `subpfx:${p}` };
  });
  const rows = [];
  for (let i = 0; i < btns.length; i += 4) rows.push(btns.slice(i, i + 4));
  rows.push([{ text: t(lang, 'back_to_prefixes'), callback_data: 'menu_file_list' }]);
  return { inline_keyboard: rows };
}

// ─── Screens ─────────────────────────────────────────────────────────────────
async function showMain(chatId, state) {
  state.screen = 'main';
  const lang = state.lang || 'ar';
  await bot.sendMessage(chatId,
    t(lang, 'main_menu', { status: statusLabel(state) }),
    { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(state.userId, lang) });
}
async function showLinkMenu(chatId, state) {
  const lang = state.lang || 'ar';
  state.screen = 'link';
  await bot.sendMessage(chatId, t(lang, 'choose_link'), { reply_markup: linkMenuKeyboard(lang) });
}
async function showStatus(chatId, state) {
  const lang = state.lang || 'ar';
  state.screen = 'status';
  const lines = [t(lang, 'status_title'), '', t(lang, 'status_label', { v: statusLabel(state) })];
  const methodVal =
    state.method === 'qr'      ? t(lang, 'method_qr') :
    state.method === 'phone'   ? t(lang, 'method_phone') :
    state.method === 'restore' ? t(lang, 'method_restore') :
    state.method === 'borrowed'? t(lang, 'method_borrowed') : '—';
  lines.push(t(lang, 'method_label', { v: methodVal }));
  if (state.info) {
    lines.push('', t(lang, 'acc_info'));
    lines.push(t(lang, 'acc_name',  { v: escapeHtml(state.info.name  || '—') }));
    lines.push(t(lang, 'acc_phone', { v: escapeHtml(state.info.phone || '—') }));
  }
  if (state.connectedAt) {
    lines.push('', t(lang, 'timing'));
    lines.push(t(lang, 'ready_at', { v: escapeHtml(formatDateTime(state.connectedAt)) }));
    lines.push(t(lang, 'duration', { v: escapeHtml(formatDuration(Date.now() - state.connectedAt)) }));
  }
  const c = state.checks;
  if (c?.totalChecked > 0) {
    lines.push('', t(lang, 'check_stats'));
    lines.push(t(lang, 'check_stats_val', { total: c.totalChecked, reg: c.registered, unreg: c.unregistered, err: c.errors }));
  }
  if (state.status === 'pairing_pending' && state.pairingCode)
    lines.push('', t(lang, 'pairing_code_label', { v: escapeHtml(state.pairingCode) }));
  if (state.lastError) lines.push(t(lang, 'last_error', { v: escapeHtml(String(state.lastError)) }));
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: statusKeyboard(state) });
}
async function showHelp(chatId, state) {
  const lang = state.lang || 'ar';
  state.screen = 'help';
  await bot.sendMessage(chatId,
    t(lang, 'help_text') + (isAdmin(state.userId) ? t(lang, 'help_admin_extra') : ''),
    { parse_mode: 'HTML', reply_markup: backKeyboard(lang) });
}
async function showGroups(chatId, state) {
  const lang = state.lang || 'ar';
  if (monitoredGroups.size === 0) {
    await bot.sendMessage(chatId, t(lang, 'no_groups'), { reply_markup: backKeyboard(lang) });
    return;
  }
  const rows = [];
  for (const [gid, g] of monitoredGroups) {
    const files = groupFiles.get(gid) || [];
    rows.push([{ text: `📂 ${g.name} (${files.length})`, callback_data: `grp:${gid}` }]);
  }
  rows.push([{ text: t(lang, 'back_btn'), callback_data: 'back_main' }]);
  await bot.sendMessage(chatId,
    t(lang, 'groups_title', { n: monitoredGroups.size }),
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}
async function showGroupFiles(chatId, state, groupId) {
  const lang  = state.lang || 'ar';
  const g     = monitoredGroups.get(groupId);
  const files = groupFiles.get(groupId) || [];
  if (!g) { await bot.sendMessage(chatId, t(lang, 'no_groups'), { reply_markup: backKeyboard(lang) }); return; }
  if (files.length === 0) {
    await bot.sendMessage(chatId, t(lang, 'no_files_group'),
      { reply_markup: { inline_keyboard: [[{ text: t(lang, 'back_btn'), callback_data: 'menu_groups' }]] } });
    return;
  }
  const rows = files.map(f => {
    const date = new Date(f.date).toLocaleDateString('ar-EG', { day: '2-digit', month: '2-digit' });
    return [{ text: `📄 ${f.fileName}  [${date}]`, callback_data: `grpfile:${groupId}:${f.fileId}` }];
  });
  rows.push([{ text: t(lang, 'clear_group_btn'), callback_data: `grpclr:${groupId}` }]);
  rows.push([{ text: t(lang, 'back_btn'), callback_data: 'menu_groups' }]);
  await bot.sendMessage(chatId,
    t(lang, 'group_files_title', { name: escapeHtml(g.name), n: files.length }),
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}
async function promptCheck(chatId, state) {
  const lang = state.lang || 'ar';
  if (state.status !== 'ready') {
    await bot.sendMessage(chatId, t(lang, 'must_link', { status: statusLabel(state) }),
      { reply_markup: mainMenuKeyboard(state.userId, lang) });
    return;
  }
  state.screen = 'awaiting_numbers';
  const total = state.checks.totalChecked;
  await bot.sendMessage(chatId,
    t(lang, 'send_numbers', { batch: BATCH_SIZE }) +
    (total > 0 ? t(lang, 'checked_so_far', { n: total }) : ''),
    { parse_mode: 'HTML', reply_markup: backKeyboard(lang) });
}
async function promptPhone(chatId, state) {
  const lang = state.lang || 'ar';
  state.screen = 'awaiting_phone';
  await bot.sendMessage(chatId, t(lang, 'send_phone'), { reply_markup: backKeyboard(lang) });
}

// ─── Admin ────────────────────────────────────────────────────────────────────
async function showAdminUsers(chatId, lang = 'ar') {
  const active = [...userStates.entries()].filter(([, s]) => s.sock || s.status === 'ready');
  if (active.length === 0) {
    await bot.sendMessage(chatId, t(lang, 'no_users'), { reply_markup: backKeyboard(lang) });
    return;
  }
  const lines = [t(lang, 'users_title', { n: active.length })];
  const rows = [];
  for (const [uid, s] of active) {
    lines.push(`• <code>${uid}</code> — ${escapeHtml(s.info?.name || '—')} | 📞 ${s.info?.phone || '—'} | ${statusLabel(s)}`);
    rows.push([
      { text: `👤 ${s.info?.name || uid}`, callback_data: `admin_info_${uid}` },
      { text: t(lang, 'msg_btn'),  callback_data: `admin_msg_${uid}` },
    ]);
    rows.push([
      { text: t(lang, 'use_btn'),  callback_data: `admin_use_${uid}` },
      { text: t(lang, 'kick_btn'), callback_data: `admin_kick_${uid}` },
    ]);
  }
  rows.push([{ text: t(lang, 'back_btn'), callback_data: 'back_main' }]);
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}
async function adminKickUser(chatId, targetUserId, lang = 'ar') {
  const state = userStates.get(Number(targetUserId));
  if (!state) { await bot.sendMessage(chatId, t(lang, 'user_not_found')); return; }
  const name = state.info?.name || targetUserId;
  await destroyClient(state);
  if (state.chatId) {
    try { await bot.sendMessage(state.chatId, t(state.lang || 'ar', 'session_ended'),
      { reply_markup: mainMenuKeyboard(Number(targetUserId), state.lang || 'ar') }); } catch (_) {}
  }
  await bot.sendMessage(chatId, t(lang, 'kicked', { name: escapeHtml(String(name)) }), { reply_markup: backKeyboard(lang) });
}

// ─── WhatsApp via Baileys ─────────────────────────────────────────────────────
async function startSession(userId, chatId, method, phoneNumber) {
  const state = getState(userId);
  const lang  = state.lang || 'ar';
  state.userId = userId;
  await destroyClient(state);

  state.method = method; state.status = 'connecting';
  state.pairingRequested = false; state.pairingCode = null;
  state.chatId = chatId; state.lastError = null;

  try {
    const sessionPath = path.join(SESSIONS_DIR, `session-${userId}`);
    if (method === 'phone' || method === 'qr') {
      try { fs.rmSync(sessionPath, { recursive: true, force: true }); } catch (_) {}
    }
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    const { state: authState, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    const logger = pino({ level: 'silent' });

    const sock = makeWASocket({
      version,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
    });

    state.sock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (method === 'qr') {
          state.status = 'qr_pending';
          try {
            const buf = await qrcode.toBuffer(qr, { width: 512, margin: 1 });
            await bot.sendPhoto(chatId, buf, {
              caption: t(lang, 'qr_caption'),
              reply_markup: backKeyboard(lang),
            });
          } catch (e) {
            await bot.sendMessage(chatId, t(lang, 'qr_fail', { e: e.message }));
          }
        } else if (method === 'phone' && phoneNumber && !state.pairingRequested) {
          state.pairingRequested = true;
          state.status = 'pairing_pending';
          try {
            const code   = await sock.requestPairingCode(phoneNumber);
            const pretty = code?.length === 8 ? `${code.slice(0,4)}-${code.slice(4)}` : code;
            state.pairingCode = pretty;
            await bot.sendMessage(chatId,
              t(lang, 'pairing_title', { code: escapeHtml(pretty) }),
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: t(lang, 'copy_code', { code: pretty }), copy_text: { text: pretty } }],
                    [{ text: t(lang, 'back_btn'), callback_data: 'back_main' }],
                  ],
                },
              });
          } catch (e) {
            state.pairingRequested = false;
            state.lastError = e.message;
            await bot.sendMessage(chatId, t(lang, 'pairing_fail', { e: e.message }), { reply_markup: backKeyboard(lang) });
          }
        }
      }

      if (connection === 'open') {
        state.status = 'ready';
        state.connectedAt = Date.now();
        state.authenticatedAt = state.authenticatedAt || Date.now();
        state.pairingCode = null;
        try {
          const me = sock.user;
          state.info = {
            name:  me?.name || me?.verifiedName || '—',
            phone: (me?.id || '').split(':')[0].split('@')[0] || '—',
          };
        } catch (_) {}

        const info = state.info;
        await bot.sendMessage(chatId,
          t(lang, 'connected', { name: escapeHtml(info?.name || '') + (info?.phone ? ' — ' + info.phone : '') }),
          { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(userId, lang) });

        if (!isAdmin(userId) && ADMIN_ID) {
          try {
            await bot.sendMessage(ADMIN_ID,
              t('ar', 'new_user_notif', {
                uid: userId, name: escapeHtml(info?.name || '—'),
                phone: info?.phone || '—', time: escapeHtml(formatDateTime(Date.now())),
              }),
              {
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[
                  { text: t('ar', 'use_session_btn'), callback_data: `admin_use_${userId}` },
                  { text: t('ar', 'kick_btn'),        callback_data: `admin_kick_${userId}` },
                ]]},
              });
          } catch (_) {}
        }
      }

      if (connection === 'close') {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut  = statusCode === DisconnectReason.loggedOut;
        state.lastDisconnectReason = String(lastDisconnect?.error?.message || statusCode || 'unknown');

        if (!loggedOut && state.sock === sock) {
          state.status = 'connecting';
          setTimeout(() => startSession(userId, chatId, 'restore', null).catch(() => {}), 3000);
        } else {
          state.status = 'disconnected'; state.sock = null;
          await bot.sendMessage(chatId,
            loggedOut ? t(lang, 'logged_out_wa') : t(lang, 'disconnected', { reason: state.lastDisconnectReason }),
            { reply_markup: mainMenuKeyboard(userId, lang) });
        }
      }
    });

  } catch (e) {
    state.status = 'disconnected'; state.sock = null; state.lastError = e.message;
    await bot.sendMessage(chatId, t(lang, 'session_fail', { e: e.message }), { reply_markup: backKeyboard(lang) });
  }
}

async function restoreSession(userId, chatId) {
  const state = getState(userId);
  const lang  = state.lang || 'ar';
  state.userId = userId;
  if (state.status === 'ready') {
    await bot.sendMessage(chatId, t(lang, 'session_active'), { reply_markup: mainMenuKeyboard(userId, lang) });
    return;
  }
  if (!hasSavedSession(userId)) {
    await bot.sendMessage(chatId, t(lang, 'no_saved_session'), { reply_markup: mainMenuKeyboard(userId, lang) });
    return;
  }
  const msg = await bot.sendMessage(chatId, t(lang, 'restoring'));
  await startSession(userId, chatId, 'restore', null);
  try { await bot.deleteMessage(chatId, msg.message_id); } catch (_) {}
}

async function handleLogout(userId, chatId) {
  const state = getState(userId);
  const lang  = state.lang || 'ar';
  await bot.sendMessage(chatId, t(lang, 'logging_out'));
  if (state.sock) { try { await state.sock.logout(); } catch (_) {} }
  await destroyClient(state);
  try { fs.rmSync(path.join(SESSIONS_DIR, `session-${userId}`), { recursive: true, force: true }); } catch (_) {}
  state.info = null; state.connectedAt = null; state.authenticatedAt = null;
  state.method = null; state.lastError = null; state.lastDisconnectReason = null;
  state.checks = { totalChecked: 0, registered: 0, unregistered: 0, errors: 0 };
  await bot.sendMessage(chatId, t(lang, 'logged_out'), { reply_markup: mainMenuKeyboard(userId, lang) });
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
function parseNumbers(text) {
  const tokens = text.split(/[\s,;\r\n]+/).filter(Boolean);
  const numbers = []; const seen = new Set();
  for (const t of tokens) {
    const n = cleanNumber(t);
    if (n.length >= 7 && !seen.has(n)) { seen.add(n); numbers.push(n); }
  }
  return numbers;
}
async function fetchFileNumbers(fileId) {
  const link    = await bot.getFileLink(fileId);
  const content = await downloadUrl(link);
  return parseNumbers(content);
}

// ─── Commands ─────────────────────────────────────────────────────────────────
bot.onText(/^\/start\b/,   async msg => { const s = getState(msg.from.id); s.userId = msg.from.id; await showMain(msg.chat.id, s); });
bot.onText(/^\/help\b/,    async msg => { const s = getState(msg.from.id); s.userId = msg.from.id; await showHelp(msg.chat.id, s); });
bot.onText(/^\/link\b/,    async msg => { const s = getState(msg.from.id); s.userId = msg.from.id; await showLinkMenu(msg.chat.id, s); });
bot.onText(/^\/check\b/,   async msg => { const s = getState(msg.from.id); s.userId = msg.from.id; await promptCheck(msg.chat.id, s); });
bot.onText(/^\/status\b/,  async msg => { const s = getState(msg.from.id); s.userId = msg.from.id; await showStatus(msg.chat.id, s); });
bot.onText(/^\/restore\b/, async msg => { const s = getState(msg.from.id); s.userId = msg.from.id; await restoreSession(msg.from.id, msg.chat.id); });
bot.onText(/^\/logout\b/,  async msg => {
  if (!isAdmin(msg.from.id)) { await bot.sendMessage(msg.chat.id, t(getState(msg.from.id).lang || 'ar', 'admin_only')); return; }
  await handleLogout(msg.from.id, msg.chat.id);
});
bot.onText(/^\/users\b/, async msg => {
  if (!isAdmin(msg.from.id)) { await bot.sendMessage(msg.chat.id, t(getState(msg.from.id).lang || 'ar', 'admin_only')); return; }
  await showAdminUsers(msg.chat.id, getState(msg.from.id).lang || 'ar');
});
bot.onText(/^\/broadcast\b/, async msg => {
  if (!isAdmin(msg.from.id)) { await bot.sendMessage(msg.chat.id, t(getState(msg.from.id).lang || 'ar', 'admin_only')); return; }
  const state = getState(msg.from.id);
  const lang  = state.lang || 'ar';
  state.screen = 'awaiting_broadcast';
  await bot.sendMessage(msg.chat.id, t(lang, 'broadcast_prompt'), { parse_mode: 'HTML', reply_markup: backKeyboard(lang) });
});

async function sendBroadcast(chatId, text, lang = 'ar') {
  const allUsers = [...userStates.entries()];
  const targets = allUsers.filter(([uid]) => Number(uid) !== ADMIN_ID);
  if (targets.length === 0) {
    await bot.sendMessage(chatId, t(lang, 'no_users_now'));
    return;
  }
  const progress = await bot.sendMessage(chatId, t(lang, 'sending_broadcast', { n: targets.length }));
  let success = 0, failed = 0;
  for (const [uid, s] of targets) {
    try {
      const dest = s.chatId || Number(uid);
      await bot.sendMessage(dest, t(s.lang || 'ar', 'broadcast_msg', { text: escapeHtml(text) }), { parse_mode: 'HTML' });
      success++;
    } catch (_) { failed++; }
  }
  await bot.editMessageText(
    t(lang, 'broadcast_done', { ok: success, fail: failed }),
    { chat_id: chatId, message_id: progress.message_id, parse_mode: 'HTML' }
  ).catch(async () => {
    await bot.sendMessage(chatId, t(lang, 'broadcast_done2', { ok: success, fail: failed }));
  });
}

// ─── Callbacks ────────────────────────────────────────────────────────────────
bot.on('callback_query', async q => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const state  = getState(userId);
  state.userId = userId;
  state.chatId = chatId;
  const lang   = state.lang || 'ar';
  try {
    await bot.answerCallbackQuery(q.id).catch(() => {});

    if (q.data === 'toggle_lang') {
      state.lang = state.lang === 'ar' ? 'en' : 'ar';
      const newLang = state.lang;
      await bot.sendMessage(chatId, t(newLang, 'lang_changed'),
        { reply_markup: mainMenuKeyboard(userId, newLang) });
      return;
    }

    if (q.data.startsWith('cpn:')) {
      const num = q.data.slice(4);
      await bot.sendMessage(chatId, `<code>${num}</code>`, { parse_mode: 'HTML' });
      return;
    }

    if (q.data.startsWith('admin_kick_')) {
      if (!isAdmin(userId)) return;
      await adminKickUser(chatId, q.data.replace('admin_kick_', ''), lang);
      return;
    }
    if (q.data.startsWith('admin_msg_')) {
      if (!isAdmin(userId)) return;
      const tid = Number(q.data.replace('admin_msg_', ''));
      const ts  = userStates.get(tid);
      if (!ts) { await bot.sendMessage(chatId, t(lang, 'user_not_found')); return; }
      state.screen = 'awaiting_dm';
      state.pendingDmTarget = tid;
      await bot.sendMessage(chatId,
        t(lang, 'dm_prompt', { name: escapeHtml(ts.info?.name || String(tid)) }),
        { parse_mode: 'HTML', reply_markup: backKeyboard(lang) });
      return;
    }
    if (q.data.startsWith('admin_info_')) {
      if (!isAdmin(userId)) return;
      const tid = Number(q.data.replace('admin_info_', ''));
      const ts  = userStates.get(tid);
      if (!ts) { await bot.sendMessage(chatId, t(lang, 'user_not_found')); return; }
      await bot.sendMessage(chatId,
        `${t(lang, 'user_info_title')}\n• ID: <code>${tid}</code>\n• ${t(lang, 'acc_name', { v: escapeHtml(ts.info?.name || '—') })}\n• ${t(lang, 'acc_phone', { v: ts.info?.phone || '—' })}\n• ${t(lang, 'status_label', { v: statusLabel(ts) })}\n• ${t(lang, 'check_stats_val', { total: ts.checks.totalChecked, reg: ts.checks.registered, unreg: ts.checks.unregistered, err: ts.checks.errors })}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: t(lang, 'use_btn'), callback_data: `admin_use_${tid}` }, { text: t(lang, 'kick_btn'), callback_data: `admin_kick_${tid}` }],
          [{ text: t(lang, 'back_btn'), callback_data: 'menu_users' }],
        ]}});
      return;
    }
    if (q.data.startsWith('admin_use_')) {
      if (!isAdmin(userId)) return;
      const tid = Number(q.data.replace('admin_use_', ''));
      const ts  = userStates.get(tid);
      if (!ts || ts.status !== 'ready' || !ts.sock) {
        await bot.sendMessage(chatId, t(lang, 'session_not_ready2'));
        return;
      }
      state.sock = ts.sock; state.status = 'ready';
      state.info = ts.info; state.method = 'borrowed'; state.chatId = chatId;
      await bot.sendMessage(chatId,
        t(lang, 'user_session_ready', { name: escapeHtml(ts.info?.name || String(tid)), phone: ts.info?.phone || '—' }),
        { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(userId, lang) });
      return;
    }

    if (q.data.startsWith('grp:')) {
      const gid = Number(q.data.slice(4));
      await showGroupFiles(chatId, state, gid);
      return;
    }
    if (q.data.startsWith('grpfile:')) {
      const parts  = q.data.split(':');
      const gid    = Number(parts[1]);
      const fileId = parts.slice(2).join(':');
      if (state.status !== 'ready' || !state.sock) {
        await bot.answerCallbackQuery(q.id, { text: t(lang, 'session_not_ready'), show_alert: true });
        return;
      }
      const pm = await bot.sendMessage(chatId, t(lang, 'file_loading'));
      try {
        const numbers = await fetchFileNumbers(fileId);
        if (numbers.length === 0) {
          await bot.editMessageText(t(lang, 'no_valid_numbers'), { chat_id: chatId, message_id: pm.message_id }).catch(() => {});
          return;
        }
        const parentGroups = groupByPrefix(numbers);
        const subGroups    = groupBySubPrefix(numbers);
        const menuText     = t(lang, 'file_analyzed', { total: numbers.length, groups: Object.keys(parentGroups).length });
        const checked = {};
        userFilePending.set(userId, { parentGroups, subGroups, checked, menuText });
        await bot.editMessageText(menuText, {
          chat_id: chatId, message_id: pm.message_id,
          parse_mode: 'HTML', reply_markup: buildPrefixMarkup(parentGroups, checked, lang),
        }).catch(async () => {
          await bot.sendMessage(chatId, menuText, { parse_mode: 'HTML', reply_markup: buildPrefixMarkup(parentGroups, checked, lang) });
        });
      } catch (e) {
        await bot.editMessageText(t(lang, 'file_read_fail', { e: e.message }), { chat_id: chatId, message_id: pm.message_id }).catch(() => {});
      }
      return;
    }
    if (q.data.startsWith('grpclr:')) {
      if (!isAdmin(userId)) return;
      const gid = Number(q.data.slice(7));
      const g   = monitoredGroups.get(gid);
      groupFiles.set(gid, []);
      await bot.sendMessage(chatId, t(lang, 'group_cleared', { name: escapeHtml(g?.name || String(gid)) }),
        { reply_markup: { inline_keyboard: [[{ text: t(lang, 'back_btn'), callback_data: 'menu_groups' }]] } });
      return;
    }

    if (q.data.startsWith('pfx:')) {
      const parent  = q.data.slice(4);
      const pending = userFilePending.get(userId);
      if (!pending?.parentGroups[parent]) {
        await bot.answerCallbackQuery(q.id, { text: t(lang, 'expired_choice'), show_alert: true });
        return;
      }
      const total = pending.parentGroups[parent].length;
      const done  = Object.entries(pending.checked).filter(([k]) => k.startsWith(parent)).reduce((s,[,v]) => s + v.size, 0);
      await bot.sendMessage(chatId,
        t(lang, 'prefix_title', { p: parent, total, done }),
        { parse_mode: 'HTML', reply_markup: buildSubPrefixMarkup(parent, pending.subGroups, pending.checked, lang) });
      return;
    }

    if (q.data.startsWith('subpfx:')) {
      const prefix  = q.data.slice(7);
      const parent  = prefix.slice(0, 2);
      const pending = userFilePending.get(userId);
      if (!pending?.subGroups[prefix]) {
        await bot.answerCallbackQuery(q.id, { text: t(lang, 'expired_choice2'), show_alert: true });
        return;
      }
      if (state.status !== 'ready' || !state.sock) {
        await bot.answerCallbackQuery(q.id, { text: t(lang, 'session_not_ready'), show_alert: true });
        return;
      }
      if (!pending.checked[prefix]) pending.checked[prefix] = new Set();
      const checkedSet = pending.checked[prefix];
      const remaining  = pending.subGroups[prefix].filter(n => !checkedSet.has(n));
      if (remaining.length === 0) {
        await bot.answerCallbackQuery(q.id, { text: t(lang, 'all_checked'), show_alert: true });
        return;
      }
      const picked   = shuffle(remaining).slice(0, 100);
      for (const n of picked) checkedSet.add(n);
      const leftAfter = remaining.length - picked.length;
      const totalDone = Object.values(pending.checked).reduce((s, st) => s + st.size, 0);
      await bot.sendMessage(chatId,
        t(lang, 'batch_info', { p: prefix, n: picked.length, left: leftAfter }),
        { parse_mode: 'HTML' });
      await checkNumbers(state, chatId, picked, userId);
      const afterRows = [];
      if (leftAfter > 0) afterRows.push([{ text: t(lang, 'next_round', { p: prefix, left: leftAfter }), callback_data: `subpfx:${prefix}` }]);
      afterRows.push([{ text: t(lang, 'back_to_prefix', { p: parent }), callback_data: `pfx:${parent}` }]);
      afterRows.push([{ text: t(lang, 'prefix_list', { n: totalDone }), callback_data: 'menu_file_list' }]);
      afterRows.push([{ text: t(lang, 'home_btn'), callback_data: 'back_main' }]);
      await bot.sendMessage(chatId, t(lang, 'next_action'), { reply_markup: { inline_keyboard: afterRows } });
      return;
    }

    switch (q.data) {
      case 'back_main':    await showMain(chatId, state); break;
      case 'menu_link':    await showLinkMenu(chatId, state); break;
      case 'menu_status':  await showStatus(chatId, state); break;
      case 'menu_check':   await promptCheck(chatId, state); break;
      case 'menu_help':    await showHelp(chatId, state); break;
      case 'menu_groups':  await showGroups(chatId, state); break;
      case 'menu_restore': await restoreSession(userId, chatId); break;
      case 'menu_file_list': {
        const fp = userFilePending.get(userId);
        if (!fp) { await bot.sendMessage(chatId, t(lang, 'no_file_loaded')); break; }
        const done = Object.values(fp.checked).reduce((s, st) => s + st.size, 0);
        await bot.sendMessage(chatId,
          fp.menuText + t(lang, 'checked_so_far2', { n: done }),
          { parse_mode: 'HTML', reply_markup: buildPrefixMarkup(fp.parentGroups, fp.checked, lang) });
        break;
      }
      case 'menu_broadcast':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, t(lang, 'admin_only')); break; }
        state.screen = 'awaiting_broadcast';
        await bot.sendMessage(chatId, t(lang, 'broadcast_prompt'), { parse_mode: 'HTML', reply_markup: backKeyboard(lang) });
        break;
      case 'menu_users':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, t(lang, 'admin_only')); break; }
        await showAdminUsers(chatId, lang); break;
      case 'menu_link_group':
        state.screen = 'awaiting_group';
        await bot.sendMessage(chatId, t(lang, 'send_group_username'),
          { parse_mode: 'HTML', reply_markup: backKeyboard(lang) });
        break;
      case 'menu_logout':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, t(lang, 'admin_only')); break; }
        await handleLogout(userId, chatId); break;
      case 'link_qr':
        await bot.sendMessage(chatId, t(lang, 'connecting'));
        await startSession(userId, chatId, 'qr'); break;
      case 'link_phone':
        await promptPhone(chatId, state); break;
    }
  } catch (e) {
    try { await bot.answerCallbackQuery(q.id, { text: 'Error: ' + e.message }); } catch (_) {}
  }
});

// ─── Messages ────────────────────────────────────────────────────────────────
bot.on('message', async msg => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state  = getState(userId);
  state.userId = userId;
  state.chatId = chatId;
  const lang   = state.lang || 'ar';

  if (msg.document) {
    // ── ملف محوَّل من قناة/قروب → احفظه تلقائياً ──────────────────────
    const fwdChat = msg.forward_from_chat || msg.forward_origin?.chat;
    if (fwdChat && (fwdChat.type === 'channel' || fwdChat.type === 'group' || fwdChat.type === 'supergroup')) {
      const { file_name: fn = 'file', mime_type: mt = '', file_size: fs2 = 0, file_id: fid } = msg.document;
      if ((mt.includes('text') || fn.endsWith('.txt') || fn.endsWith('.csv')) && fs2 <= 5 * 1024 * 1024) {
        const gid   = fwdChat.id;
        const gname = fwdChat.title || fwdChat.username || String(gid);
        if (!monitoredGroups.has(gid)) monitoredGroups.set(gid, { name: gname, username: fwdChat.username || null });
        if (!groupFiles.has(gid)) groupFiles.set(gid, []);
        const files = groupFiles.get(gid);
        if (!files.find(f => f.fileId === fid)) {
          files.unshift({ fileId: fid, fileName: fn, date: (msg.date || Date.now() / 1000) * 1000 });
          if (files.length > MAX_FILES_PER_GROUP) files.pop();
        }
        await bot.sendMessage(chatId,
          t(lang, 'forwarded_saved', { group: escapeHtml(gname) }),
          { parse_mode: 'HTML', reply_markup: {
            inline_keyboard: [
              [{ text: t(lang, 'groups_btn'), callback_data: 'menu_groups' }],
              [{ text: t(lang, 'home_btn'),   callback_data: 'back_main'   }],
            ]
          }});
        return;
      }
    }
    // ────────────────────────────────────────────────────────────────────
    if (state.status !== 'ready' || !state.sock) {
      await bot.sendMessage(chatId, t(lang, 'must_link', { status: statusLabel(state) }),
        { reply_markup: mainMenuKeyboard(userId, lang) });
      return;
    }
    const { file_name: name = '', mime_type: mime = '', file_size: size = 0 } = msg.document;
    if (!mime.includes('text') && !name.endsWith('.txt') && !name.endsWith('.csv')) {
      await bot.sendMessage(chatId, t(lang, 'file_only_text'));
      return;
    }
    if (size > 5 * 1024 * 1024) { await bot.sendMessage(chatId, t(lang, 'file_too_big')); return; }
    try {
      const pm = await bot.sendMessage(chatId, t(lang, 'reading_file'));
      const numbers = await fetchFileNumbers(msg.document.file_id);
      if (numbers.length === 0) {
        await bot.editMessageText(t(lang, 'no_valid_numbers'), { chat_id: chatId, message_id: pm.message_id }).catch(() => {});
        return;
      }
      const parentGroups = groupByPrefix(numbers);
      const subGroups    = groupBySubPrefix(numbers);
      const menuText     = t(lang, 'file_analyzed', { total: numbers.length, groups: Object.keys(parentGroups).length });
      const checked = {};
      userFilePending.set(userId, { parentGroups, subGroups, checked, menuText });
      await bot.editMessageText(menuText, {
        chat_id: chatId, message_id: pm.message_id,
        parse_mode: 'HTML', reply_markup: buildPrefixMarkup(parentGroups, checked, lang),
      }).catch(async () => {
        await bot.sendMessage(chatId, menuText, { parse_mode: 'HTML', reply_markup: buildPrefixMarkup(parentGroups, checked, lang) });
      });
    } catch (e) {
      await bot.sendMessage(chatId, t(lang, 'file_read_fail', { e: e.message }), { reply_markup: backKeyboard(lang) });
    }
    return;
  }

  if (!msg.text || msg.text.startsWith('/')) return;
  const text = msg.text.trim();

  if (state.screen === 'awaiting_broadcast') {
    if (!isAdmin(userId)) { state.screen = 'main'; return; }
    state.screen = 'main';
    await sendBroadcast(chatId, text, lang);
    return;
  }

  if (state.screen === 'awaiting_dm') {
    if (!isAdmin(userId)) { state.screen = 'main'; return; }
    state.screen = 'main';
    const tid = state.pendingDmTarget;
    state.pendingDmTarget = null;
    if (!tid) { await showMain(chatId, state); return; }
    const ts = userStates.get(tid);
    const targetName = escapeHtml(ts?.info?.name || String(tid));
    const dest = ts?.chatId || tid;
    try {
      await bot.sendMessage(dest,
        t(ts?.lang || 'ar', 'dm_received', { text: escapeHtml(text) }),
        { parse_mode: 'HTML' });
      await bot.sendMessage(chatId, t(lang, 'dm_sent', { name: targetName }),
        { reply_markup: { inline_keyboard: [
          [{ text: t(lang, 'msg_btn'), callback_data: `admin_msg_${tid}` }],
          [{ text: t(lang, 'users_btn'), callback_data: 'menu_users' }],
          [{ text: t(lang, 'back_btn'), callback_data: 'back_main' }],
        ]}});
    } catch (e) {
      await bot.sendMessage(chatId, t(lang, 'dm_failed', { e: e.message }),
        { reply_markup: backKeyboard(lang) });
    }
    return;
  }

  if (state.screen === 'awaiting_phone') {
    state.screen = 'main';
    const phone = cleanNumber(text);
    if (phone.length < 8) { await bot.sendMessage(chatId, t(lang, 'invalid_phone'), { reply_markup: backKeyboard(lang) }); return; }
    await bot.sendMessage(chatId, t(lang, 'preparing_code'));
    await startSession(userId, chatId, 'phone', phone);
    return;
  }

  // ── ربط قناة / قروب عبر اليوزرنيم ────────────────────────────────────
  if (state.screen === 'awaiting_group') {
    state.screen = 'main';
    let username = text.trim();
    if (!username.startsWith('@')) username = '@' + username;
    try {
      const chatInfo = await bot.getChat(username);
      const gid      = chatInfo.id;
      const gname    = chatInfo.title || chatInfo.username || String(gid);
      if (monitoredGroups.has(gid)) {
        await bot.sendMessage(chatId,
          t(lang, 'group_link_already', { name: escapeHtml(gname) }),
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            [{ text: t(lang, 'groups_btn'), callback_data: 'menu_groups' }],
            [{ text: t(lang, 'home_btn'),   callback_data: 'back_main'   }],
          ]}});
        return;
      }
      monitoredGroups.set(gid, { name: gname, username: chatInfo.username || null });
      if (!groupFiles.has(gid)) groupFiles.set(gid, []);
      await bot.sendMessage(chatId,
        t(lang, 'group_linked', { name: escapeHtml(gname) }),
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: t(lang, 'groups_btn'), callback_data: 'menu_groups' }],
          [{ text: t(lang, 'home_btn'),   callback_data: 'back_main'   }],
        ]}});
    } catch (_) {
      await bot.sendMessage(chatId, t(lang, 'group_link_fail'),
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: t(lang, 'link_group_btn'), callback_data: 'menu_link_group' }],
          [{ text: t(lang, 'back_btn'),        callback_data: 'back_main'       }],
        ]}});
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────

  if (state.screen === 'awaiting_numbers' || state.status === 'ready') {
    if (state.status !== 'ready' || !state.sock) {
      await bot.sendMessage(chatId, t(lang, 'not_linked'), { reply_markup: mainMenuKeyboard(userId, lang) });
      return;
    }
    const numbers = parseNumbers(text);
    if (numbers.length === 0) { await bot.sendMessage(chatId, t(lang, 'no_numbers_found'), { reply_markup: backKeyboard(lang) }); return; }
    await checkNumbers(state, chatId, numbers, userId);
    return;
  }

  await showMain(chatId, state);
});

// ─── Number Checking ──────────────────────────────────────────────────────────
async function checkNumbers(state, chatId, numbers, userId) {
  const lang  = state.lang || 'ar';
  const total = numbers.length;
  let progressMsgId = null;
  try {
    const sent = await bot.sendMessage(chatId, t(lang, 'checking', { n: total }), { parse_mode: 'HTML' });
    progressMsgId = sent.message_id;
  } catch (_) {}

  const registered = [], unregistered = [], errors = [];
  const results = new Array(total);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= total) return;
      const num = numbers[idx];
      if (!state.sock || state.status !== 'ready') { results[idx] = { kind: 'error', num }; continue; }
      await new Promise(r => setTimeout(r, CHECK_DELAY_MS));
      let success = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const [result] = await state.sock.onWhatsApp(`${num}@s.whatsapp.net`);
          results[idx] = { kind: result?.exists ? 'registered' : 'unregistered', num };
          success = true;
          break;
        } catch (_) {
          if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
        }
      }
      if (!success) results[idx] = { kind: 'error', num };
    }
  };

  await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, total) }, worker));

  for (const r of results) {
    if (r.kind === 'registered') registered.push(r.num);
    else if (r.kind === 'unregistered') unregistered.push(r.num);
    else errors.push(r.num);
  }

  state.checks.totalChecked += total;
  state.checks.registered   += registered.length;
  state.checks.unregistered += unregistered.length;
  state.checks.errors       += errors.length;

  if (ADMIN_ID && !isAdmin(userId)) {
    try {
      const userInfo = state.info;
      let report = t('ar', 'check_report', {
        name: escapeHtml(userInfo?.name || '—'), phone: escapeHtml(userInfo?.phone || '—'),
        uid: userId, time: escapeHtml(formatDateTime(Date.now())),
        reg: registered.length, unreg: unregistered.length, err: errors.length, total,
      });
      if (registered.length > 0)
        report += '\n\n✅ <b>مسجل:</b>\n' + registered.map(n => `• <code>${escapeHtml(n)}</code>`).join('\n');
      if (unregistered.length > 0)
        report += '\n\n❌ <b>غير مسجل:</b>\n' + unregistered.map(n => `• <code>${escapeHtml(stripCountryCode(n))}</code>`).join('\n');

      const chunks = chunkLines(report.split('\n'), 3800);
      const msgKeyboard = {
        inline_keyboard: [[
          { text: `💬 فتح محادثة ${escapeHtml(userInfo?.name || String(userId))}`, url: `tg://user?id=${userId}` },
        ],[
          { text: '📩 مراسلة عبر البوت', callback_data: `admin_msg_${userId}` },
          { text: '🚪 طرد', callback_data: `admin_kick_${userId}` },
        ]],
      };
      for (let i = 0; i < chunks.length; i++) {
        await bot.sendMessage(ADMIN_ID, chunks[i], {
          parse_mode: 'HTML',
          reply_markup: i === chunks.length - 1 ? msgKeyboard : undefined,
        });
      }
    } catch (_) {}
  }

  try { if (progressMsgId) await bot.deleteMessage(chatId, progressMsgId); } catch (_) {}

  const hasPending = userFilePending.has(userId);

  if (registered.length === 0 && unregistered.length === 0 && errors.length === 0) {
    await bot.sendMessage(chatId, t(lang, 'no_checked'),
      { reply_markup: afterCheckKeyboard(userId, state.checks.totalChecked, hasPending, lang) });
    return;
  }

  function buildNumberButtons(nums, emoji) {
    const rows = [];
    for (let i = 0; i < nums.length; i += 3) {
      rows.push(nums.slice(i, i + 3).map(n => ({
        text: `${emoji} ${n}`,
        copy_text: { text: n },
      })));
    }
    return rows;
  }

  if (registered.length > 0) {
    const rows = buildNumberButtons(registered, '✅');
    for (let i = 0; i < rows.length; i += 20) {
      await bot.sendMessage(chatId,
        i === 0 ? t(lang, 'registered_title', { n: registered.length }) : '↓',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows.slice(i, i + 20) } }
      );
    }
  }

  if (unregistered.length > 0) {
    const nums = unregistered.map(n => stripCountryCode(n));
    const rows = buildNumberButtons(nums, '❌');
    for (let i = 0; i < rows.length; i += 20) {
      await bot.sendMessage(chatId,
        i === 0 ? t(lang, 'unregistered_title', { n: unregistered.length }) : '↓',
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows.slice(i, i + 20) } }
      );
    }
  }

  if (errors.length > 0)
    await bot.sendMessage(chatId, t(lang, 'errors_count', { n: errors.length }));

  await bot.sendMessage(chatId,
    t(lang, 'check_summary', { reg: registered.length, unreg: unregistered.length }),
    { parse_mode: 'HTML', reply_markup: afterCheckKeyboard(userId, state.checks.totalChecked, hasPending, lang) }
  );
}

// ─── Group File Monitor ──────────────────────────────────────────────────────
bot.on('message', async msg => {
  const type = msg.chat.type;
  if (type !== 'group' && type !== 'supergroup' && type !== 'channel') return;
  const groupId   = msg.chat.id;
  const groupName = msg.chat.title || String(groupId);
  const username  = msg.chat.username || null;
  if (!monitoredGroups.has(groupId))
    monitoredGroups.set(groupId, { name: groupName, username });
  else
    monitoredGroups.get(groupId).name = groupName;

  if (!msg.document) return;
  const { file_id, file_name = 'file', mime_type = '', file_size = 0 } = msg.document;
  if (!mime_type.includes('text') && !file_name.endsWith('.txt') && !file_name.endsWith('.csv')) return;
  if (file_size > 5 * 1024 * 1024) return;
  if (!groupFiles.has(groupId)) groupFiles.set(groupId, []);
  const files = groupFiles.get(groupId);
  if (files.find(f => f.fileId === file_id)) return;
  files.unshift({ fileId: file_id, fileName: file_name, date: (msg.date || Date.now() / 1000) * 1000 });
  if (files.length > MAX_FILES_PER_GROUP) files.pop();
});

// ─── Keep-Alive Server ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running ✅');
}).listen(PORT, () => {
  console.log(`🌐 Keep-alive server on port ${PORT}`);
});

console.log('🤖 Bot is running...');
console.log(`• Admin ID   : ${ADMIN_ID}`);
console.log(`• Sessions   : ${SESSIONS_DIR}`);
console.log(`• Concurrency: ${CHECK_CONCURRENCY}`);
