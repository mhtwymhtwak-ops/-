'use strict';

// ─── Load .env ────────────────────────────────────────────────────────────────
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
const os    = require('os');
const https = require('https');
const http  = require('http');
const TelegramBot    = require('node-telegram-bot-api');
const qrcode         = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

// ─── Config ───────────────────────────────────────────────────────────────────
const BOT_TOKEN  = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID   = process.env.ADMIN_ID
  ? Number(process.env.ADMIN_ID)
  : process.env.ADMIN_USER_ID ? Number(process.env.ADMIN_USER_ID) : null;

const CHECK_CONCURRENCY = Math.max(1, Number(process.env.CHECK_CONCURRENCY || 15));
const CHECK_DELAY_MS    = Math.max(0, Number(process.env.CHECK_DELAY_MS    || 300));
const SESSIONS_DIR      = path.resolve(process.env.SESSIONS_DIR || path.join(__dirname, 'sessions'));
const DATA_FILE         = path.resolve(process.env.DATA_FILE   || path.join(__dirname, 'data.json'));
const BATCH_SIZE        = 500;
const EXPORT_THRESHOLD  = 200; // إرسال ملف بدل رسائل إذا الأرقام أكثر من هذا

if (!BOT_TOKEN) { console.error('❌  BOT_TOKEN env var is required.'); process.exit(1); }
if (!ADMIN_ID || Number.isNaN(ADMIN_ID)) {
  console.error('❌  ADMIN_ID env var is required (numeric Telegram user id).');
  process.exit(1);
}

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─── Data Persistence ─────────────────────────────────────────────────────────
let appData = {
  allowedUsers: [],      // قائمة المستخدمين المسموح لهم
  inviteCodes:  {},      // { code: { maxUses, usedCount, usedBy:[], createdAt } }
  userStats:    {},      // { userId: { totalChecked, registered, unregistered, dailyChecks:{date:n}, joinedViaCode, name } }
};

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      appData = { ...appData, ...parsed };
    }
  } catch (e) { console.error('⚠️ Failed to load data.json:', e.message); }
}

function saveData() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(appData, null, 2), 'utf8'); }
  catch (e) { console.error('⚠️ Failed to save data.json:', e.message); }
}

loadData();

function isAllowed(userId) {
  const uid = Number(userId);
  if (uid === ADMIN_ID) return true;
  if (!inviteSystemOn) return true;
  return appData.allowedUsers.includes(uid);
}

function allowUser(userId) {
  const uid = Number(userId);
  if (!appData.allowedUsers.includes(uid)) {
    appData.allowedUsers.push(uid);
    saveData();
  }
}

function revokeUser(userId) {
  const uid = Number(userId);
  appData.allowedUsers = appData.allowedUsers.filter(id => id !== uid);
  saveData();
}

function generateCode(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createInviteCode(maxUses) {
  let code;
  do { code = generateCode(); } while (appData.inviteCodes[code]);
  appData.inviteCodes[code] = { maxUses, usedCount: 0, usedBy: [], createdAt: Date.now() };
  saveData();
  return code;
}

function useInviteCode(code, userId) {
  const uid  = Number(userId);
  const entry = appData.inviteCodes[code?.toUpperCase?.() || code];
  if (!entry) return { ok: false, reason: 'not_found' };
  if (entry.usedCount >= entry.maxUses) return { ok: false, reason: 'exhausted' };
  entry.usedCount++;
  entry.usedBy.push(uid);
  allowUser(uid);
  // track which code the user used
  if (!appData.userStats[uid]) appData.userStats[uid] = { totalChecked:0, registered:0, unregistered:0, dailyChecks:{}, joinedViaCode: code.toUpperCase(), name: '' };
  else appData.userStats[uid].joinedViaCode = code.toUpperCase();
  saveData();
  const remaining = entry.maxUses - entry.usedCount;
  return { ok: true, remaining };
}

function deleteInviteCode(code) {
  delete appData.inviteCodes[code];
  saveData();
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function todayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' }); // YYYY-MM-DD
}

function recordChecks(userId, total, registered, unregistered) {
  const uid = Number(userId);
  const day = todayKey();
  if (!appData.userStats[uid]) appData.userStats[uid] = { totalChecked:0, registered:0, unregistered:0, dailyChecks:{}, joinedViaCode:null, name:'' };
  const st = appData.userStats[uid];
  st.totalChecked   += total;
  st.registered     += registered;
  st.unregistered   += unregistered;
  if (!st.dailyChecks[day]) st.dailyChecks[day] = 0;
  st.dailyChecks[day] += total;
  st.lastActive = Date.now();
  saveData();
}

function updateUserName(userId, name) {
  const uid = Number(userId);
  if (!appData.userStats[uid]) appData.userStats[uid] = { totalChecked:0, registered:0, unregistered:0, dailyChecks:{}, joinedViaCode:null, name:'' };
  appData.userStats[uid].name = name || '';
  saveData();
}

// ─── i18n ─────────────────────────────────────────────────────────────────────
const STRINGS = {
  ar: {
    choose_lang:       '🌐 اختر لغتك\nChoose your language:',
    btn_ar:            '🇸🇦 العربية',
    btn_en:            '🇬🇧 English',
    welcome:
      '👋 <b>أهلاً وسهلاً!</b>\n\n' +
      '🤖 بوت فحص أرقام واتساب — إليك شرح الأزرار الرئيسية:\n\n' +
      '🔗 <b>ربط الحساب</b> — اربط جلسة واتساب بالـ QR أو رقم هاتف\n' +
      '♻️ <b>استعادة الجلسة</b> — استرجع جلسة محفوظة مسبقاً\n' +
      '🔢 <b>فحص الأرقام</b> — أرسل أرقاماً للتحقق من تسجيلها على واتساب\n' +
      '📂 <b>فحص الملف</b> — ارفع ملف .txt أو .csv يحتوي الأرقام\n' +
      '📊 <b>الحالة</b> — عرض تفاصيل جلستك الحالية\n\n' +
      '✨ حتى ٢٠٠ نتيجة تُرسل مباشرةً، وما فوقها يُصدَّر تلقائياً كملف.',
    main_title:        '🏠 <b>القائمة الرئيسية</b>',
    status_line:       (s) => `\nالحالة: ${s}`,
    btn_link:          '🔗 ربط الحساب',
    btn_restore:       '♻️ استعادة الجلسة',
    btn_check:         '🔢 فحص الأرقام',
    btn_check_file:    '📂 فحص الملف',
    btn_status:        '📊 الحالة',
    btn_help:          '❓ مساعدة',
    btn_lang:          '🌐 اللغة',
    btn_users:         '👥 المستخدمون',
    btn_broadcast:     '📢 رسالة جماعية',
    btn_codes:         '🔐 الأكواد',
    btn_shared:        (on) => on ? '🔓 الجلسة المشتركة: مفعّلة' : '🔒 الجلسة المشتركة: معطّلة',
    btn_logout:        '🚪 تسجيل خروج',
    btn_back:          '🔙 رجوع',
    btn_home:          '🏠 الرئيسية',
    btn_refresh:       '🔄 تحديث',
    btn_qr:            '📷 QR كود',
    btn_phone:         '📱 رقم الهاتف',
    btn_retry_phone:   '🔄 إعادة المحاولة',
    btn_check_s:       '🔢 فحص',
    btn_link_s:        '🔗 ربط',
    btn_cancel_link:   '❌ إلغاء الربط',
    linking_cancelled: '❌ تم إلغاء عملية الربط.',
    link_prompt:       '🔗 <b>اختر طريقة الربط:</b>\n\n📷 <b>QR كود</b> — امسح الكود من واتساب\n📱 <b>رقم الهاتف</b> — احصل على رمز ربط',
    phone_prompt:      '📱 أرسل رقمك مع رمز الدولة <b>بدون +</b>\n\nمثال: <code>9665xxxxxxxx</code>',
    phone_invalid:     '⚠️ الرقم غير صالح. أرسله مع رمز الدولة بدون + (مثال: 9665xxxxxxxx)',
    preparing_qr:      '⏳ جاري تجهيز كود QR...',
    qr_caption:        '📲 <b>لربط الجهاز:</b>\nافتح واتساب ← الأجهزة المرتبطة ← ربط جهاز\nثم امسح هذا الكود',
    qr_fail:           (e) => `⚠️ تعذر إرسال QR: ${e}`,
    requesting_code:   '⏳ جاري طلب رمز الربط...',
    pairing_msg:       (code) =>
      `🔑 <b>رمز ربط الجهاز</b>\n\n` +
      `افتح واتساب ← الأجهزة المرتبطة ← ربط جهاز ← ربط برقم الهاتف\n\n` +
      `<code>${code}</code>\n\n⌛ صالح لمدة 60 ثانية`,
    pairing_copy:      (c) => `📋 نسخ: ${c}`,
    pairing_fail:      (e) => `⚠️ فشل رمز الربط: ${e}\n\nيمكنك المحاولة مجدداً.`,
    authenticated:     '🔐 تم التحقق، جاري تجهيز الجلسة...',
    auth_fail:         (m) => `⚠️ فشل التحقق: ${m}`,
    ready_msg:         (name, phone) => `✅ <b>تم الربط بنجاح</b>${name}${phone}\n\nأرسل ملفًا أو اضغط «🔢 فحص الأرقام»`,
    disconnected:      (r) => `⚠️ انقطع الاتصال: ${r}`,
    session_active:    '✅ الجلسة نشطة بالفعل.',
    no_session:        '⚠️ لا توجد جلسة محفوظة.\nاستخدم «🔗 ربط الحساب» لإنشاء جلسة جديدة.',
    restoring:         '♻️ جاري استعادة الجلسة...',
    restore_fail:      (e) => `⚠️ فشل الاستعادة: ${e}`,
    start_fail:        (e) => `⚠️ تعذر بدء الجلسة: ${e}`,
    logging_out:       '🚪 جاري تسجيل الخروج...',
    logged_out:        '✅ تم تسجيل الخروج وحذف بيانات الجلسة.',
    must_link:         (s) => `⚠️ يجب الربط أولاً.\nالحالة: ${s}`,
    check_prompt:      (n) => `📥 أرسل الأرقام أو ملف .txt/.csv\n(حتى ${n} رقم/رسالة)`,
    checked_so_far:    (n) => `\n📊 فحصت <b>${n}</b> رقم في هذه الجلسة.`,
    status_title:      '📊 <b>حالة الجلسة</b>',
    status_state:      (s) => `• الحالة: ${s}`,
    status_method:     '• طريقة الربط: ',
    method_qr:         'QR كود',
    method_phone:      'رقم الهاتف',
    method_restore:    'استعادة محفوظة',
    method_borrowed:   '🔌 جلسة مستعارة',
    method_shared:     '🌐 جلسة مشتركة',
    method_none:       '—',
    wa_state:          (s) => `• واتساب: <code>${s}</code>`,
    acct_title:        '👤 <b>معلومات الحساب</b>',
    acct_name:         (n) => `• الاسم: ${n}`,
    acct_number:       (n) => `• الرقم: <code>${n}</code>`,
    acct_platform:     (p) => `• المنصة: ${p}`,
    time_title:        '⏱ <b>التوقيت</b>',
    time_auth:         (t) => `• المصادقة: ${t}`,
    time_ready:        (t) => `• الجاهزية: ${t}`,
    time_duration:     (d) => `• مدة الاتصال: ${d}`,
    stats_title:       '📈 <b>إحصائيات الفحص</b>',
    stats_line:        (t,r,u,e) => `• إجمالي: ${t} | ✅ ${r} | ❌ ${u} | ⚠️ ${e}`,
    pairing_code_show: (c) => `\n🔑 رمز الربط: <code>${c}</code>`,
    last_dc:           (r) => `\n⚠️ آخر انقطاع: ${r}`,
    last_err:          (e) => `⚠️ آخر خطأ: ${e}`,
    help_text:         (admin) =>
      '📖 <b>طريقة الاستخدام</b>\n\n' +
      '① اضغط «🔗 ربط الحساب» واختر QR أو رقم الهاتف\n' +
      '② بعد الربط أرسل ملف .txt/.csv مباشرةً\n' +
      '③ كل ضغطة = 100 رقم عشوائي من البادئة المختارة\n' +
      '④ النتائج: ✅ المسجّلة ثم ❌ غير المسجّلة\n' +
      '⑤ إذا تجاوزت الأرقام 200 تُرسل كملف .txt تلقائياً\n\n' +
      '• «♻️ استعادة» تعيد الاتصال بجلسة محفوظة\n' +
      '• الأرقام تُقبل بدون + وتُنظَّف تلقائياً' + admin,
    help_admin:
      '\n\n<b>صلاحيات الأدمن:</b>\n' +
      '• 👥 المستخدمون — عرض وإدارة الجلسات\n' +
      '• 🔐 الأكواد — إنشاء وإدارة أكواد الدعوة\n' +
      '• 📢 رسالة جماعية — إرسال لكل المستخدمين\n' +
      '• 🔒/🔓 الجلسة المشتركة — السماح لكل المستخدمين بالفحص بأي جلسة نشطة',
    no_numbers:        '⚠️ لم أجد أرقاماً صالحة.',
    file_only_text:    '⚠️ يُقبل ملفات النص فقط (.txt أو .csv)',
    file_too_large:    '⚠️ الملف كبير جدًا (الحد الأقصى 5 MB)',
    reading_file:      '⏳ جاري قراءة الملف...',
    file_ok:           (n, g) => `📂 <b>تم تحليل الملف</b>\n\n📊 الأرقام: <b>${n}</b> | المجموعات: <b>${g}</b>\n\n👇 اختر مجموعة — كل ضغطة = 100 عشوائي`,
    file_err:          (e) => `⚠️ تعذر قراءة الملف: ${e}`,
    checking:          (n) => `🔎 جاري فحص <b>${n}</b> رقم...`,
    batch_prog:        (b,t,n) => `🔎 الدفعة <b>${b}/${t}</b> — ${n} رقم...`,
    done_prog:         (d,t) => `🔎 تم: <b>${d}/${t}</b>`,
    batch_done_prog:   (b,t,d,n) => `🔎 الدفعة <b>${b}/${t}</b> — تم: <b>${d}/${n}</b>`,
    picking:           (p,n,l) => `🎲 بادئة <b>${p}</b> | 📦 ${n} رقم | 🔁 متبقٍ: ${l}`,
    no_checked:        '⚠️ لم يتم فحص أي رقم.',
    not_reg_header:    (n) => `🔴 Not Registered [ ${n} ]`,
    err_header:        (n) => `⚠️ Errors [ ${n} ]`,
    check_more:        (n) => n > 0 ? `🔢 فحص أخرى (تم: ${n})` : '🔢 فحص أخرى',
    back_list:         (n) => `↩️ رجوع للقائمة (فحصت: ${n})`,
    back_prefixes:     '↩️ رجوع للبادئات',
    new_round:         (p,l) => `🔁 جولة جديدة من ${p} (${l} متبقٍ)`,
    back_parent:       (p) => `↩️ رجوع لـ ${p}`,
    prefix_list_btn:   (n) => `📋 البادئات (فحصت: ${n})`,
    next_action:       '▸ اختر الإجراء التالي:',
    prefix_header:     (p,t,d) => `📞 <b>بادئة ${p}</b> | إجمالي: ${t} | ✅ تم: ${d}\n\n👇 اختر بادئة فرعية:`,
    done_total:        (n) => `✅ تم فحص: <b>${n}</b> رقم حتى الآن`,
    expired:           '⚠️ انتهت صلاحية الاختيار. أرسل الملف مجددًا.',
    session_not_ready: '⚠️ الجلسة غير مربوطة.',
    all_done:          '✅ تم فحص جميع أرقام هذه البادئة!',
    no_file:           '⚠️ لا يوجد ملف محمّل. أرسل الملف مجددًا.',
    admin_only:        '⛔ هذا للأدمن فقط.',
    no_users:          '👥 لا يوجد مستخدمون مرتبطون حالياً.',
    users_title:       (n) => `👥 <b>المستخدمون المرتبطون (${n})</b>\n`,
    user_line:         (id,name,phone,st) => `• <code>${id}</code> — ${name} | 📞 ${phone} | ${st}`,
    btn_use:           '🔌 استخدام',
    btn_kick:          '🚪 طرد',
    btn_revoke:        '🔑 سحب الصلاحية',
    kicking:           (n) => `🚪 جاري طرد ${n}...`,
    kicked:            (n) => `✅ تم طرد ${n}.`,
    kicked_notify:     '⚠️ تم إنهاء جلستك وسحب صلاحيتك من قِبَل الأدمن.',
    no_target:         '⚠️ المستخدم غير موجود.',
    info_title:        '👤 <b>معلومات المستخدم</b>',
    info_id:           (id) => `• Telegram ID: <code>${id}</code>`,
    info_name:         (n) => `• الاسم: ${n}`,
    info_phone:        (p) => `• الرقم: <code>${p}</code>`,
    info_status:       (s) => `• الحالة: ${s}`,
    info_checks:       (t,r,u) => `• فحص: ${t} (✅${r} ❌${u})`,
    info_code:         (c) => `• كود الدخول: <code>${c}</code>`,
    info_allowed:      (a) => `• الصلاحية: ${a ? '✅ مسموح' : '❌ محظور'}`,
    btn_use_full:      '🔌 استخدام جلسته',
    no_session_target: '⚠️ جلسة هذا المستخدم غير جاهزة.',
    borrowed_msg:      (n,p) => `🔌 <b>تم ربط جلسة المستخدم</b>\n\n👤 ${n} | 📞 ${p}\n\nيمكنك الآن فحص الأرقام عبر جلسته.`,
    new_user_notif:    (id,n,p) =>
      `🔔 <b>مستخدم جديد ربط جلسة</b>\n\n🆔 ID: <code>${id}</code>\n👤 الاسم: ${n}\n📞 الرقم: <code>${p}</code>`,
    broadcast_prompt:  '📢 <b>رسالة جماعية</b>\n\nأرسل الرسالة التي تريد إيصالها لجميع المستخدمين:',
    broadcast_cancel:  '❌ إلغاء',
    broadcast_sending: (n) => `📤 جاري الإرسال لـ ${n} مستخدم...`,
    broadcast_done:    (s,f) => `✅ تم الإرسال\n• نجح: ${s}\n• فشل: ${f}`,
    broadcast_none:    '⚠️ لا يوجد مستخدمون لإرسال الرسالة إليهم.',
    broadcast_from:    '📢 <b>رسالة من الأدمن:</b>\n\n',
    shared_on:         '🔓 تم تفعيل <b>الجلسة المشتركة</b>\n\nالآن يستطيع جميع المستخدمين الفحص بأي جلسة نشطة.',
    shared_off:        '🔒 تم إيقاف <b>الجلسة المشتركة</b>\n\nكل مستخدم يحتاج جلسته الخاصة للفحص.',
    shared_using:      (n,p) => `🌐 <b>جلسة مشتركة</b>\n👤 ${n} | 📞 ${p}\n\nيمكنك الفحص الآن.`,
    no_shared:         '⚠️ لا توجد جلسة نشطة حالياً. انتظر حتى يربط أحد جلسته.',
    dur_d: 'ي', dur_h: 'س', dur_m: 'د', dur_s: 'ث',
    cmd_start: 'القائمة الرئيسية', cmd_link: 'ربط واتساب', cmd_restore: 'استعادة جلسة',
    cmd_check: 'فحص أرقام', cmd_status: 'حالة الجلسة', cmd_help: 'المساعدة',
    cmd_users: '👥 المستخدمون (أدمن)', cmd_logout: '🚪 تسجيل خروج (أدمن)',
    // ─── Invite Codes ────────────────────────────────────────────────────────
    invite_required:   '🔐 <b>هذا البوت خاص</b>\n\nأدخل كود الدعوة للمتابعة:',
    invite_invalid:    '❌ الكود غير صحيح أو انتهت استخداماته.\nحاول مجدداً أو تواصل مع الأدمن.',
    invite_ok:         (r) => `✅ <b>تم قبول الكود!</b>\nالاستخدامات المتبقية: ${r}`,
    invite_ok_last:    '✅ <b>تم قبول الكود!</b> (آخر استخدام)',
    codes_title:       (n) => `🔐 <b>أكواد الدعوة (${n})</b>\n`,
    code_line:         (code,used,max) => `• <code>${code}</code> — استُخدم ${used}/${max} مرة`,
    no_codes:          '⚠️ لا توجد أكواد حالياً.',
    create_code_title: '🔢 <b>إنشاء كود دعوة جديد</b>\n\nاختر عدد الاستخدامات المسموحة:',
    code_created:      (code, max) => `✅ <b>تم إنشاء الكود</b>\n\n🔑 <code>${code}</code>\n\n📊 الاستخدامات: ${max}`,
    code_deleted:      '✅ تم حذف الكود.',
    btn_create_code:   '➕ إنشاء كود جديد',
    btn_delete_code:   '🗑 حذف',
    btn_code_info:     '🔍 تفاصيل',
    code_info_title:   (c) => `🔐 <b>كود: <code>${c}</code></b>`,
    code_info_max:     (n) => `• الاستخدامات المسموحة: ${n}`,
    code_info_used:    (n) => `• استُخدم: ${n} مرة`,
    code_info_users:   (ids) => `• المستخدمون: ${ids || '—'}`,
    code_info_date:    (d) => `• تاريخ الإنشاء: ${d}`,
    // ─── Pause System ────────────────────────────────────────────────────────
    btn_pause:             '⏸ إيقاف البوت مؤقتاً',
    btn_resume:            '▶️ تشغيل البوت',
    bot_paused_msg:        '⏸ <b>تم إيقاف البوت مؤقتاً</b>\n\nالمستخدمون لن يتمكنوا من الفحص حتى تعيد التشغيل.',
    bot_resumed_msg:       '▶️ <b>تم تشغيل البوت</b>\n\nالمستخدمون يمكنهم الفحص الآن.',
    bot_paused_notice:     '⏸ البوت متوقف مؤقتاً من قِبَل الأدمن. يرجى المحاولة لاحقاً.',
    // ─── Invite System Toggle ─────────────────────────────────────────────
    btn_invite_system:     (on) => on ? '🔐 نظام الدعوة: مفعّل' : '🔓 نظام الدعوة: معطّل',
    invite_system_on_msg:  '🔐 <b>تم تفعيل نظام الدعوة</b>\n\nالمستخدمون الجدد يحتاجون كود دعوة للدخول.',
    invite_system_off_msg: '🔓 <b>تم تعطيل نظام الدعوة</b>\n\nأي شخص يمكنه الدخول مباشرة بدون كود.',
    // ─── Active Sessions Panel ────────────────────────────────────────────
    btn_sessions_panel:    '📡 الجلسات النشطة',
    sessions_title:        (n) => `📡 <b>الجلسات النشطة (${n})</b>\n\nاختر الجلسة المشتركة للمستخدمين:`,
    no_active_sessions:    '⚠️ لا توجد جلسات نشطة حالياً.',
    session_shared_set:    (n) => `✅ تم تعيين جلسة <b>${escapeHtml(n)}</b> كجلسة مشتركة للجميع.`,
    session_shared_auto:   '✅ تم ضبط الجلسة المشتركة على الوضع التلقائي (أي جلسة نشطة).',
    // ─── Export ──────────────────────────────────────────────────────────────
    export_sending:    '📤 جاري إعداد الملف...',
    export_reg_name:   (d) => `registered_${d}.txt`,
    export_unreg_name: (d) => `not_registered_${d}.txt`,
    export_caption:    (r,u) => `📊 <b>نتائج الفحص</b>\n\n✅ مسجّل: <b>${r}</b>\n❌ غير مسجّل: <b>${u}</b>`,
    // ─── Daily Report ────────────────────────────────────────────────────────
    daily_report:      (date, total, reg, unreg, topName, topCount, activeUsers) =>
      `📊 <b>التقرير اليومي — ${date}</b>\n\n` +
      `🔢 إجمالي الأرقام المفحوصة: <b>${total}</b>\n` +
      `✅ مسجّلة: <b>${reg}</b>\n` +
      `❌ غير مسجّلة: <b>${unreg}</b>\n` +
      `👥 المستخدمون النشطون: <b>${activeUsers}</b>\n\n` +
      `🏆 <b>أكثر مستخدم نشاطاً:</b>\n` +
      `👤 ${topName}\n🔢 فحص <b>${topCount}</b> رقم`,
    daily_report_no_activity: (date) =>
      `📊 <b>التقرير اليومي — ${date}</b>\n\n😴 لم يكن هناك نشاط اليوم.`,
  },

  en: {
    choose_lang:       '🌐 Choose your language\nاختر لغتك:',
    btn_ar:            '🇸🇦 العربية',
    btn_en:            '🇬🇧 English',
    welcome:
      '👋 <b>Welcome!</b>\n\n' +
      '🤖 WhatsApp Number Checker Bot — Here\'s a guide to the main buttons:\n\n' +
      '🔗 <b>Link Account</b> — Connect a WhatsApp session via QR or phone number\n' +
      '♻️ <b>Restore Session</b> — Reconnect a previously saved session\n' +
      '🔢 <b>Check Numbers</b> — Send numbers to verify WhatsApp registration\n' +
      '📂 <b>Check File</b> — Upload a .txt or .csv file with numbers\n' +
      '📊 <b>Status</b> — View your current session details\n\n' +
      '✨ Up to 200 results are sent inline; larger sets are auto-exported as files.',
    main_title:        '🏠 <b>Main Menu</b>',
    status_line:       (s) => `\nStatus: ${s}`,
    btn_link:          '🔗 Link Account',
    btn_restore:       '♻️ Restore Session',
    btn_check:         '🔢 Check Numbers',
    btn_check_file:    '📂 Check File',
    btn_status:        '📊 Status',
    btn_help:          '❓ Help',
    btn_lang:          '🌐 Language',
    btn_users:         '👥 Users',
    btn_broadcast:     '📢 Broadcast',
    btn_codes:         '🔐 Invite Codes',
    btn_shared:        (on) => on ? '🔓 Shared Session: ON' : '🔒 Shared Session: OFF',
    btn_logout:        '🚪 Logout',
    btn_back:          '🔙 Back',
    btn_home:          '🏠 Home',
    btn_refresh:       '🔄 Refresh',
    btn_qr:            '📷 QR Code',
    btn_phone:         '📱 Phone Number',
    btn_retry_phone:   '🔄 Retry',
    btn_check_s:       '🔢 Check',
    btn_link_s:        '🔗 Link',
    btn_cancel_link:   '❌ Cancel Linking',
    linking_cancelled: '❌ Linking process cancelled.',
    link_prompt:       '🔗 <b>Choose linking method:</b>\n\n📷 <b>QR Code</b> — Scan from WhatsApp\n📱 <b>Phone Number</b> — Get a pairing code',
    phone_prompt:      '📱 Send your number with country code <b>without +</b>\n\nExample: <code>9665xxxxxxxx</code>',
    phone_invalid:     '⚠️ Invalid number. Send it with country code without + (e.g. 9665xxxxxxxx)',
    preparing_qr:      '⏳ Preparing QR code...',
    qr_caption:        '📲 <b>To link your device:</b>\nOpen WhatsApp → Linked Devices → Link a Device\nThen scan this code',
    qr_fail:           (e) => `⚠️ Failed to send QR: ${e}`,
    requesting_code:   '⏳ Requesting pairing code...',
    pairing_msg:       (code) =>
      `🔑 <b>Device Pairing Code</b>\n\n` +
      `Open WhatsApp → Linked Devices → Link a Device → Link with Phone Number\n\n` +
      `<code>${code}</code>\n\n⌛ Valid for 60 seconds`,
    pairing_copy:      (c) => `📋 Copy: ${c}`,
    pairing_fail:      (e) => `⚠️ Pairing failed: ${e}\n\nYou can try again.`,
    authenticated:     '🔐 Authenticated, preparing session...',
    auth_fail:         (m) => `⚠️ Auth failed: ${m}`,
    ready_msg:         (name, phone) => `✅ <b>Linked Successfully</b>${name}${phone}\n\nSend a file or press «🔢 Check Numbers»`,
    disconnected:      (r) => `⚠️ Disconnected: ${r}`,
    session_active:    '✅ Session is already active.',
    no_session:        '⚠️ No saved session found.\nUse «🔗 Link Account» to create one.',
    restoring:         '♻️ Restoring saved session...',
    restore_fail:      (e) => `⚠️ Restore failed: ${e}`,
    start_fail:        (e) => `⚠️ Failed to start session: ${e}`,
    logging_out:       '🚪 Logging out...',
    logged_out:        '✅ Logged out and session data deleted.',
    must_link:         (s) => `⚠️ You must link first.\nStatus: ${s}`,
    check_prompt:      (n) => `📥 Send numbers or a .txt/.csv file\n(up to ${n} per message)`,
    checked_so_far:    (n) => `\n📊 Checked <b>${n}</b> numbers this session.`,
    status_title:      '📊 <b>Session Status</b>',
    status_state:      (s) => `• Status: ${s}`,
    status_method:     '• Link Method: ',
    method_qr:         'QR Code',
    method_phone:      'Phone Number',
    method_restore:    'Saved Restore',
    method_borrowed:   '🔌 Borrowed Session',
    method_shared:     '🌐 Shared Session',
    method_none:       '—',
    wa_state:          (s) => `• WhatsApp: <code>${s}</code>`,
    acct_title:        '👤 <b>Account Info</b>',
    acct_name:         (n) => `• Name: ${n}`,
    acct_number:       (n) => `• Number: <code>${n}</code>`,
    acct_platform:     (p) => `• Platform: ${p}`,
    time_title:        '⏱ <b>Timing</b>',
    time_auth:         (t) => `• Authenticated: ${t}`,
    time_ready:        (t) => `• Ready at: ${t}`,
    time_duration:     (d) => `• Connected for: ${d}`,
    stats_title:       '📈 <b>Check Statistics</b>',
    stats_line:        (t,r,u,e) => `• Total: ${t} | ✅ ${r} | ❌ ${u} | ⚠️ ${e}`,
    pairing_code_show: (c) => `\n🔑 Pairing Code: <code>${c}</code>`,
    last_dc:           (r) => `\n⚠️ Last Disconnect: ${r}`,
    last_err:          (e) => `⚠️ Last Error: ${e}`,
    help_text:         (admin) =>
      '📖 <b>How to Use</b>\n\n' +
      '① Press «🔗 Link Account» and choose QR or Phone\n' +
      '② After linking, send a .txt/.csv file directly\n' +
      '③ Each tap = 100 random numbers from the chosen prefix\n' +
      '④ Results: ✅ Registered first, then ❌ Unregistered\n' +
      '⑤ If numbers exceed 200, results are sent as a .txt file\n\n' +
      '• «♻️ Restore» reconnects a saved session\n' +
      '• Numbers accepted without + and cleaned automatically' + admin,
    help_admin:
      '\n\n<b>Admin Features:</b>\n' +
      '• 👥 Users — view and manage sessions\n' +
      '• 🔐 Invite Codes — create and manage invite codes\n' +
      '• 📢 Broadcast — send message to all users\n' +
      '• 🔒/🔓 Shared Session — allow all users to check with any active session',
    no_numbers:        '⚠️ No valid numbers found.',
    file_only_text:    '⚠️ Only text files accepted (.txt or .csv)',
    file_too_large:    '⚠️ File too large (max 5 MB)',
    reading_file:      '⏳ Reading file...',
    file_ok:           (n, g) => `📂 <b>File Analyzed</b>\n\n📊 Numbers: <b>${n}</b> | Groups: <b>${g}</b>\n\n👇 Choose a group — each tap = 100 random`,
    file_err:          (e) => `⚠️ Failed to read file: ${e}`,
    checking:          (n) => `🔎 Checking <b>${n}</b> numbers...`,
    batch_prog:        (b,t,n) => `🔎 Batch <b>${b}/${t}</b> — ${n} numbers...`,
    done_prog:         (d,t) => `🔎 Done: <b>${d}/${t}</b>`,
    batch_done_prog:   (b,t,d,n) => `🔎 Batch <b>${b}/${t}</b> — Done: <b>${d}/${n}</b>`,
    picking:           (p,n,l) => `🎲 Prefix <b>${p}</b> | 📦 ${n} numbers | 🔁 Left: ${l}`,
    no_checked:        '⚠️ No numbers were checked.',
    not_reg_header:    (n) => `🔴 Not Registered [ ${n} ]`,
    err_header:        (n) => `⚠️ Errors [ ${n} ]`,
    check_more:        (n) => n > 0 ? `🔢 Check More (Done: ${n})` : '🔢 Check More',
    back_list:         (n) => `↩️ Back to List (Checked: ${n})`,
    back_prefixes:     '↩️ Back to Prefixes',
    new_round:         (p,l) => `🔁 New Round from ${p} (${l} left)`,
    back_parent:       (p) => `↩️ Back to ${p}`,
    prefix_list_btn:   (n) => `📋 Prefixes (Checked: ${n})`,
    next_action:       '▸ Choose next action:',
    prefix_header:     (p,t,d) => `📞 <b>Prefix ${p}</b> | Total: ${t} | ✅ Done: ${d}\n\n👇 Choose sub-prefix:`,
    done_total:        (n) => `✅ Checked so far: <b>${n}</b> numbers`,
    expired:           '⚠️ Selection expired. Please send the file again.',
    session_not_ready: '⚠️ Session not linked.',
    all_done:          '✅ All numbers in this prefix checked!',
    no_file:           '⚠️ No file loaded. Please send the file again.',
    admin_only:        '⛔ Admins only.',
    no_users:          '👥 No connected users at the moment.',
    users_title:       (n) => `👥 <b>Connected Users (${n})</b>\n`,
    user_line:         (id,name,phone,st) => `• <code>${id}</code> — ${name} | 📞 ${phone} | ${st}`,
    btn_use:           '🔌 Use',
    btn_kick:          '🚪 Kick',
    btn_revoke:        '🔑 Revoke Access',
    kicking:           (n) => `🚪 Kicking ${n}...`,
    kicked:            (n) => `✅ ${n} has been kicked.`,
    kicked_notify:     '⚠️ Your session was ended and access revoked by the admin.',
    no_target:         '⚠️ User not found.',
    info_title:        '👤 <b>User Info</b>',
    info_id:           (id) => `• Telegram ID: <code>${id}</code>`,
    info_name:         (n) => `• Name: ${n}`,
    info_phone:        (p) => `• Number: <code>${p}</code>`,
    info_status:       (s) => `• Status: ${s}`,
    info_checks:       (t,r,u) => `• Checks: ${t} (✅${r} ❌${u})`,
    info_code:         (c) => `• Invite Code: <code>${c}</code>`,
    info_allowed:      (a) => `• Access: ${a ? '✅ Allowed' : '❌ Revoked'}`,
    btn_use_full:      '🔌 Use Their Session',
    no_session_target: '⚠️ This user\'s session is not ready.',
    borrowed_msg:      (n,p) => `🔌 <b>User Session Linked</b>\n\n👤 ${n} | 📞 ${p}\n\nYou can now check numbers using their session.`,
    new_user_notif:    (id,n,p) =>
      `🔔 <b>New User Linked a Session</b>\n\n🆔 ID: <code>${id}</code>\n👤 Name: ${n}\n📞 Number: <code>${p}</code>`,
    broadcast_prompt:  '📢 <b>Broadcast Message</b>\n\nSend the message you want to deliver to all users:',
    broadcast_cancel:  '❌ Cancel',
    broadcast_sending: (n) => `📤 Sending to ${n} users...`,
    broadcast_done:    (s,f) => `✅ Broadcast done\n• Succeeded: ${s}\n• Failed: ${f}`,
    broadcast_none:    '⚠️ No users to send the message to.',
    broadcast_from:    '📢 <b>Message from Admin:</b>\n\n',
    shared_on:         '🔓 <b>Shared Session</b> is now ON\n\nAll users can check numbers using any active session.',
    shared_off:        '🔒 <b>Shared Session</b> is now OFF\n\nEach user needs their own session to check.',
    shared_using:      (n,p) => `🌐 <b>Shared Session</b>\n👤 ${n} | 📞 ${p}\n\nYou can now check numbers.`,
    no_shared:         '⚠️ No active session available. Wait for someone to link their session.',
    dur_d: 'd', dur_h: 'h', dur_m: 'm', dur_s: 's',
    cmd_start: 'Main Menu', cmd_link: 'Link WhatsApp', cmd_restore: 'Restore Session',
    cmd_check: 'Check Numbers', cmd_status: 'Session Status', cmd_help: 'Help',
    cmd_users: '👥 Users (Admin)', cmd_logout: '🚪 Logout (Admin)',
    // ─── Invite Codes ────────────────────────────────────────────────────────
    invite_required:   '🔐 <b>This bot is private</b>\n\nEnter your invite code to continue:',
    invite_invalid:    '❌ Invalid code or all uses exhausted.\nTry again or contact the admin.',
    invite_ok:         (r) => `✅ <b>Code accepted!</b>\nRemaining uses: ${r}`,
    invite_ok_last:    '✅ <b>Code accepted!</b> (last use)',
    codes_title:       (n) => `🔐 <b>Invite Codes (${n})</b>\n`,
    code_line:         (code,used,max) => `• <code>${code}</code> — used ${used}/${max}`,
    no_codes:          '⚠️ No invite codes found.',
    create_code_title: '🔢 <b>Create New Invite Code</b>\n\nChoose the maximum number of uses:',
    code_created:      (code, max) => `✅ <b>Code Created</b>\n\n🔑 <code>${code}</code>\n\n📊 Max Uses: ${max}`,
    code_deleted:      '✅ Code deleted.',
    btn_create_code:   '➕ Create New Code',
    btn_delete_code:   '🗑 Delete',
    btn_code_info:     '🔍 Details',
    code_info_title:   (c) => `🔐 <b>Code: <code>${c}</code></b>`,
    code_info_max:     (n) => `• Max Uses: ${n}`,
    code_info_used:    (n) => `• Used: ${n} times`,
    code_info_users:   (ids) => `• Users: ${ids || '—'}`,
    code_info_date:    (d) => `• Created: ${d}`,
    // ─── Pause System ────────────────────────────────────────────────────────
    btn_pause:             '⏸ Pause Bot',
    btn_resume:            '▶️ Resume Bot',
    bot_paused_msg:        '⏸ <b>Bot Paused</b>\n\nUsers cannot check numbers until you resume.',
    bot_resumed_msg:       '▶️ <b>Bot Resumed</b>\n\nUsers can now check numbers.',
    bot_paused_notice:     '⏸ Bot is temporarily paused by admin. Please try again later.',
    // ─── Invite System Toggle ─────────────────────────────────────────────
    btn_invite_system:     (on) => on ? '🔐 Invite System: ON' : '🔓 Invite System: OFF',
    invite_system_on_msg:  '🔐 <b>Invite System Enabled</b>\n\nNew users need an invite code to enter.',
    invite_system_off_msg: '🔓 <b>Invite System Disabled</b>\n\nAnyone can join directly without a code.',
    // ─── Active Sessions Panel ────────────────────────────────────────────
    btn_sessions_panel:    '📡 Active Sessions',
    sessions_title:        (n) => `📡 <b>Active Sessions (${n})</b>\n\nSelect shared session for users:`,
    no_active_sessions:    '⚠️ No active sessions at the moment.',
    session_shared_set:    (n) => `✅ Session <b>${escapeHtml(n)}</b> set as shared session for all users.`,
    session_shared_auto:   '✅ Shared session set to auto mode (any active session).',
    // ─── Export ──────────────────────────────────────────────────────────────
    export_sending:    '📤 Preparing file...',
    export_reg_name:   (d) => `registered_${d}.txt`,
    export_unreg_name: (d) => `not_registered_${d}.txt`,
    export_caption:    (r,u) => `📊 <b>Check Results</b>\n\n✅ Registered: <b>${r}</b>\n❌ Not Registered: <b>${u}</b>`,
    // ─── Daily Report ────────────────────────────────────────────────────────
    daily_report:      (date, total, reg, unreg, topName, topCount, activeUsers) =>
      `📊 <b>Daily Report — ${date}</b>\n\n` +
      `🔢 Total Numbers Checked: <b>${total}</b>\n` +
      `✅ Registered: <b>${reg}</b>\n` +
      `❌ Not Registered: <b>${unreg}</b>\n` +
      `👥 Active Users: <b>${activeUsers}</b>\n\n` +
      `🏆 <b>Top User:</b>\n` +
      `👤 ${topName}\n🔢 Checked <b>${topCount}</b> numbers`,
    daily_report_no_activity: (date) =>
      `📊 <b>Daily Report — ${date}</b>\n\n😴 No activity today.`,
  },
};

function s(userId, key, ...args) {
  const lang = userLangs.get(Number(userId)) || 'ar';
  const val  = (STRINGS[lang] || STRINGS.ar)[key];
  if (val === undefined) return key;
  return typeof val === 'function' ? val(...args) : val;
}

// ─── Global State ─────────────────────────────────────────────────────────────
const userStates      = new Map();
const userFilePending = new Map();
const userLangs       = new Map();
let   sharedSessionOn      = false;
let   botPaused            = false;
let   inviteSystemOn       = true;
let   sharedSessionUserId  = null; // null = أي جلسة نشطة، رقم = جلسة محددة

function isAdmin(userId) { return Number(userId) === ADMIN_ID; }

function getState(userId) {
  const id = Number(userId);
  if (!userStates.has(id)) {
    userStates.set(id, {
      client: null, status: 'disconnected', method: null, screen: 'main',
      pairingRequested: false, pairingPhone: null, pairingCode: null,
      chatId: null, info: null, connectedAt: null, authenticatedAt: null,
      lastDisconnectReason: null, lastError: null, userId: id,
      checks: { totalChecked: 0, registered: 0, unregistered: 0, errors: 0 },
    });
  }
  return userStates.get(id);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function cleanNumber(raw)  { return String(raw || '').replace(/\D+/g, ''); }
function escapeHtml(str)   { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function hasSavedSession(userId) {
  return fs.existsSync(path.join(SESSIONS_DIR, `session-tg_${userId}`));
}
function statusLabel(st, userId) {
  const uid = userId ?? st.userId;
  switch (st.status) {
    case 'ready':           return userLangs.get(Number(uid)) === 'en' ? '✅ Connected & Ready' : '✅ مربوط وجاهز';
    case 'authenticated':   return userLangs.get(Number(uid)) === 'en' ? '🔐 Authenticated...' : '🔐 تم التحقق...';
    case 'connecting':      return userLangs.get(Number(uid)) === 'en' ? '⏳ Connecting...' : '⏳ جاري الاتصال...';
    case 'qr_pending':      return userLangs.get(Number(uid)) === 'en' ? '📷 Awaiting QR Scan' : '📷 بانتظار مسح QR';
    case 'pairing_pending': return userLangs.get(Number(uid)) === 'en' ? '📱 Awaiting Pairing Code' : '📱 بانتظار رمز الربط';
    default:                return userLangs.get(Number(uid)) === 'en' ? '❌ Disconnected' : '❌ غير مربوط';
  }
}
function formatDuration(ms, userId) {
  if (!ms || ms < 0) return '—';
  const sec = Math.floor(ms / 1000);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60), sc = sec % 60;
  const p = [];
  if (d) p.push(`${d}${s(userId,'dur_d')}`);
  if (h) p.push(`${h}${s(userId,'dur_h')}`);
  if (m) p.push(`${m}${s(userId,'dur_m')}`);
  if (!d && !h) p.push(`${sc}${s(userId,'dur_s')}`);
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
    mod.get(url, (res) => {
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

// ─── Shared Session ────────────────────────────────────────────────────────────
function getSharedClient() {
  if (sharedSessionUserId !== null) {
    const pinned = userStates.get(Number(sharedSessionUserId));
    if (pinned && pinned.status === 'ready' && pinned.client) return pinned;
  }
  for (const [, st] of userStates) {
    if (st.status === 'ready' && st.client) return st;
  }
  return null;
}

// ─── Country Codes ─────────────────────────────────────────────────────────────
const COUNTRY_CODES = new Set([
  '1','7','20','27','30','31','32','33','34','36','39','40','41','43','44','45','46','47','48','49',
  '51','52','53','54','55','56','57','58','60','61','62','63','64','65','66',
  '81','82','84','86','90','91','92','93','94','95','98',
  '211','212','213','216','218','220','221','222','223','224','225','226','227','228','229',
  '230','231','232','233','234','235','236','237','238','239','240','241','242','243','244',
  '245','246','247','248','249','250','251','252','253','254','255','256','257','258',
  '260','261','262','263','264','265','266','267','268','269','290','291','297','298','299',
  '350','351','352','353','354','355','356','357','358','359','370','371','372','373','374',
  '375','376','377','378','379','380','381','382','383','385','386','387','389',
  '420','421','423','500','501','502','503','504','505','506','507','508','509',
  '590','591','592','593','594','595','596','597','598','599',
  '670','672','673','674','675','676','677','678','679','680','681','682','683','685','686',
  '687','688','689','690','691','692','850','852','853','855','856','870','880','886',
  '960','961','962','963','964','965','966','967','968','970','971','972','973','974','975',
  '976','977','992','993','994','995','996','998',
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

// ─── Session Management ────────────────────────────────────────────────────────
async function destroyClient(state) {
  const client = state.client;
  state.client = null; state.status = 'disconnected'; state.pairingRequested = false;
  if (!client) return;
  await Promise.race([
    (async () => { try { await client.destroy(); } catch (_) {} })(),
    new Promise(r => setTimeout(r, 4000)),
  ]);
  try {
    const proc = client.pupBrowser?.process?.();
    if (proc?.pid) { try { process.kill(proc.pid, 'SIGKILL'); } catch (_) {} }
  } catch (_) {}
  await new Promise(r => setTimeout(r, 800));
}
function clearSessionLocks(userId) {
  const dir = path.join(SESSIONS_DIR, `session-tg_${userId}`);
  if (!fs.existsSync(dir)) return;
  for (const name of ['SingletonLock','SingletonCookie','SingletonSocket']) {
    try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
    const d = path.join(dir, 'Default');
    if (fs.existsSync(d)) { try { fs.unlinkSync(path.join(d, name)); } catch (_) {} }
  }
}

// ─── Keyboards ────────────────────────────────────────────────────────────────
function langKeyboard() {
  return { inline_keyboard: [[
    { text: STRINGS.ar.btn_ar, callback_data: 'set_lang_ar' },
    { text: STRINGS.ar.btn_en, callback_data: 'set_lang_en' },
  ]] };
}
function mainMenuKeyboard(userId) {
  const rows = [
    [{ text: s(userId,'btn_link'), callback_data:'menu_link' }, { text: s(userId,'btn_restore'), callback_data:'menu_restore' }],
    [{ text: s(userId,'btn_check'), callback_data:'menu_check' }, { text: s(userId,'btn_check_file'), callback_data:'menu_file_list' }],
    [{ text: s(userId,'btn_status'), callback_data:'menu_status' }, { text: s(userId,'btn_help'), callback_data:'menu_help' }],
    [{ text: s(userId,'btn_lang'), callback_data:'menu_lang' }],
  ];
  if (isAdmin(userId)) {
    rows.push([
      { text: s(userId,'btn_users'),     callback_data: 'menu_users' },
      { text: s(userId,'btn_broadcast'), callback_data: 'menu_broadcast' },
    ]);
    rows.push([
      { text: s(userId,'btn_codes'),          callback_data: 'menu_codes' },
      { text: s(userId,'btn_sessions_panel'), callback_data: 'menu_sessions' },
    ]);
    rows.push([
      { text: s(userId,'btn_shared', sharedSessionOn),        callback_data: 'menu_shared_toggle' },
      { text: s(userId,'btn_invite_system', inviteSystemOn),  callback_data: 'menu_invite_toggle' },
    ]);
    rows.push([
      { text: botPaused ? s(userId,'btn_resume') : s(userId,'btn_pause'), callback_data: 'menu_pause_toggle' },
    ]);
    rows.push([{ text: s(userId,'btn_logout'), callback_data: 'menu_logout' }]);
  }
  return { inline_keyboard: rows };
}
function linkMenuKeyboard(userId) {
  return { inline_keyboard: [
    [{ text: s(userId,'btn_qr'), callback_data:'link_qr' }, { text: s(userId,'btn_phone'), callback_data:'link_phone' }],
    [{ text: s(userId,'btn_back'), callback_data:'back_main' }],
  ]};
}
function backKeyboard(userId) {
  return { inline_keyboard: [[{ text: s(userId,'btn_back'), callback_data:'back_main' }]] };
}
function phoneRetryKeyboard(userId) {
  return { inline_keyboard: [
    [{ text: s(userId,'btn_retry_phone'), callback_data:'link_phone' }],
    [{ text: s(userId,'btn_back'), callback_data:'back_main' }],
  ]};
}
function cancelLinkKeyboard(userId) {
  return { inline_keyboard: [[
    { text: s(userId,'btn_cancel_link'), callback_data:'cancel_link' },
  ]]};
}
function statusKeyboard(state) {
  const uid = state.userId;
  const row1 = [{ text: s(uid,'btn_refresh'), callback_data:'menu_status' }];
  if (state.status === 'ready') row1.push({ text: s(uid,'btn_check_s'), callback_data:'menu_check' });
  else row1.push({ text: s(uid,'btn_link_s'), callback_data:'menu_link' });
  const rows = [row1];
  if (isAdmin(uid)) rows.push([
    { text: s(uid,'btn_users'), callback_data:'menu_users' },
    { text: s(uid,'btn_logout'), callback_data:'menu_logout' },
  ]);
  rows.push([{ text: s(uid,'btn_back'), callback_data:'back_main' }]);
  return { inline_keyboard: rows };
}
function afterCheckKeyboard(userId, totalChecked, hasPending) {
  const rows = [];
  if (hasPending) rows.push([{ text: s(userId,'back_list',totalChecked), callback_data:'menu_file_list' }]);
  rows.push([
    { text: s(userId,'check_more',totalChecked), callback_data:'menu_check' },
    { text: s(userId,'btn_status'), callback_data:'menu_status' },
  ]);
  rows.push([{ text: s(userId,'btn_home'), callback_data:'back_main' }]);
  return { inline_keyboard: rows };
}
function buildPrefixMarkup(parentGroups, checked, userId) {
  const prefixes = Object.keys(parentGroups).sort();
  const btns = prefixes.map(p => {
    const total = parentGroups[p].length;
    const done  = Object.entries(checked).filter(([k]) => k.startsWith(p)).reduce((sum,[,v]) => sum + v.size, 0);
    const icon  = done >= total ? '✅' : done > 0 ? '🔄' : '📞';
    return { text: `${icon} ${p} (${total})`, callback_data: `pfx:${p}` };
  });
  const rows = [];
  for (let i = 0; i < btns.length; i += 4) rows.push(btns.slice(i, i+4));
  rows.push([{ text: s(userId,'btn_back'), callback_data:'back_main' }]);
  return { inline_keyboard: rows };
}
function buildSubPrefixMarkup(parentPrefix, subGroups, checked, userId) {
  const prefixes = Object.keys(subGroups).filter(p => p.startsWith(parentPrefix)).sort();
  const btns = prefixes.map(p => {
    const done = checked[p] ? checked[p].size : 0;
    const rem  = subGroups[p].length - done;
    const icon = rem === 0 ? '✅' : done > 0 ? '🔄' : '🔢';
    return { text: `${icon} ${p} (${rem})`, callback_data: `subpfx:${p}` };
  });
  const rows = [];
  for (let i = 0; i < btns.length; i += 4) rows.push(btns.slice(i, i+4));
  rows.push([{ text: s(userId,'back_prefixes'), callback_data:'menu_file_list' }]);
  return { inline_keyboard: rows };
}

// ─── Codes Keyboard ────────────────────────────────────────────────────────────
function codesListKeyboard(userId) {
  const codes = Object.entries(appData.inviteCodes);
  const rows  = [];
  for (const [code, info] of codes) {
    const label = `🔑 ${code} (${info.usedCount}/${info.maxUses})`;
    rows.push([
      { text: label,                    callback_data: `code_info_${code}` },
      { text: s(userId,'btn_delete_code'), callback_data: `code_del_${code}` },
    ]);
  }
  rows.push([{ text: s(userId,'btn_create_code'), callback_data: 'code_create' }]);
  rows.push([{ text: s(userId,'btn_back'),         callback_data: 'back_main' }]);
  return { inline_keyboard: rows };
}
function createCodeUsesKeyboard(userId) {
  const options = [5, 10, 15, 20, 30, 40, 50, 100];
  const rows = [];
  for (let i = 0; i < options.length; i += 4) {
    rows.push(options.slice(i, i+4).map(n => ({ text: String(n), callback_data: `code_uses_${n}` })));
  }
  rows.push([{ text: s(userId,'btn_back'), callback_data: 'menu_codes' }]);
  return { inline_keyboard: rows };
}

// ─── Screens ──────────────────────────────────────────────────────────────────
async function showLangChoice(chatId) {
  await bot.sendMessage(chatId, STRINGS.ar.choose_lang, { reply_markup: langKeyboard() });
}
async function showMain(chatId, state) {
  state.screen = 'main';
  const uid = state.userId;
  await bot.sendMessage(
    chatId,
    `${s(uid,'main_title')}${s(uid,'status_line', statusLabel(state, uid))}`,
    { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(uid) },
  );
}
async function showLinkMenu(chatId, state) {
  state.screen = 'link';
  await bot.sendMessage(chatId, s(state.userId,'link_prompt'), { parse_mode:'HTML', reply_markup: linkMenuKeyboard(state.userId) });
}
async function showStatus(chatId, state) {
  state.screen = 'status';
  const uid = state.userId;
  const lines = [s(uid,'status_title'), ''];
  lines.push(s(uid,'status_state', statusLabel(state, uid)));
  const meth =
    state.method === 'qr'       ? s(uid,'method_qr') :
    state.method === 'phone'    ? s(uid,'method_phone') :
    state.method === 'restore'  ? s(uid,'method_restore') :
    state.method === 'borrowed' ? s(uid,'method_borrowed') :
    state.method === 'shared'   ? s(uid,'method_shared') : s(uid,'method_none');
  lines.push(s(uid,'status_method') + meth);
  if (state.client && state.status === 'ready') {
    let waState = '—';
    try { waState = await state.client.getState() || '—'; } catch (_) {}
    lines.push(s(uid,'wa_state', escapeHtml(waState)));
  }
  if (state.info) {
    lines.push('', s(uid,'acct_title'));
    lines.push(s(uid,'acct_name',     escapeHtml(state.info.pushname || '—')));
    lines.push(s(uid,'acct_number',   escapeHtml(state.info.wid?.user || '—')));
    lines.push(s(uid,'acct_platform', escapeHtml(state.info.platform || '—')));
  }
  if (state.connectedAt || state.authenticatedAt) {
    lines.push('', s(uid,'time_title'));
    if (state.authenticatedAt) lines.push(s(uid,'time_auth', escapeHtml(formatDateTime(state.authenticatedAt))));
    if (state.connectedAt) {
      lines.push(s(uid,'time_ready',    escapeHtml(formatDateTime(state.connectedAt))));
      lines.push(s(uid,'time_duration', escapeHtml(formatDuration(Date.now() - state.connectedAt, uid))));
    }
  }
  const c = state.checks;
  if (c?.totalChecked > 0) {
    lines.push('', s(uid,'stats_title'));
    lines.push(s(uid,'stats_line', c.totalChecked, c.registered, c.unregistered, c.errors));
  }
  if (state.status === 'pairing_pending' && state.pairingCode)
    lines.push(s(uid,'pairing_code_show', escapeHtml(state.pairingCode)));
  if (state.lastDisconnectReason)
    lines.push(s(uid,'last_dc', escapeHtml(String(state.lastDisconnectReason))));
  if (state.lastError)
    lines.push(s(uid,'last_err', escapeHtml(String(state.lastError))));
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode:'HTML', reply_markup: statusKeyboard(state) });
}
async function showHelp(chatId, state) {
  state.screen = 'help';
  const uid = state.userId;
  const adminExtra = isAdmin(uid) ? s(uid,'help_admin') : '';
  await bot.sendMessage(chatId, s(uid,'help_text', adminExtra), { parse_mode:'HTML', reply_markup: backKeyboard(uid) });
}
async function promptCheck(chatId, state) {
  const uid = state.userId;
  if (botPaused && !isAdmin(uid)) {
    await bot.sendMessage(chatId, s(uid,'bot_paused_notice'), { reply_markup: mainMenuKeyboard(uid) });
    return;
  }
  if (state.status !== 'ready' || !state.client) {
    if (sharedSessionOn) {
      const shared = getSharedClient();
      if (shared) {
        state.client = shared.client;
        state.status = 'ready';
        state.info   = shared.info;
        state.method = 'shared';
        await bot.sendMessage(chatId,
          s(uid,'shared_using', escapeHtml(shared.info?.pushname||'—'), shared.info?.wid?.user||'—'),
          { parse_mode:'HTML', reply_markup: mainMenuKeyboard(uid) });
      } else {
        await bot.sendMessage(chatId, s(uid,'no_shared'), { reply_markup: mainMenuKeyboard(uid) });
        return;
      }
    } else {
      await bot.sendMessage(chatId, s(uid,'must_link', statusLabel(state,uid)), { reply_markup: mainMenuKeyboard(uid) });
      return;
    }
  }
  state.screen = 'awaiting_numbers';
  const total = state.checks.totalChecked;
  const extra = total > 0 ? s(uid,'checked_so_far', total) : '';
  await bot.sendMessage(chatId, `${s(uid,'check_prompt', BATCH_SIZE)}${extra}`,
    { parse_mode:'HTML', reply_markup: backKeyboard(uid) });
}
async function promptPhone(chatId, state) {
  state.screen = 'awaiting_phone';
  await bot.sendMessage(chatId, s(state.userId,'phone_prompt'),
    { parse_mode:'HTML', reply_markup: cancelLinkKeyboard(state.userId) });
}

// ─── Invite Code Gate ──────────────────────────────────────────────────────────
async function showInvitePrompt(chatId, userId) {
  const state = getState(userId);
  state.screen = 'awaiting_invite';
  await bot.sendMessage(chatId, s(userId,'invite_required'), { parse_mode:'HTML' });
}

// ─── Admin: Users panel ────────────────────────────────────────────────────────
async function showAdminUsers(chatId, adminId) {
  const uid    = adminId;
  const active = [...userStates.entries()].filter(([,st]) => st.client || st.status === 'ready');
  if (!active.length) {
    await bot.sendMessage(chatId, s(uid,'no_users'), { reply_markup: backKeyboard(uid) }); return;
  }
  const lines = [s(uid,'users_title', active.length)];
  const rows  = [];
  for (const [tid, st] of active) {
    const name  = st.info?.pushname || '—';
    const phone = st.info?.wid?.user || '—';
    lines.push(s(uid,'user_line', tid, escapeHtml(name), phone, statusLabel(st, tid)));
    rows.push([
      { text: `👤 ${name}`,              callback_data: `admin_info_${tid}` },
      { text: s(uid,'btn_use'),          callback_data: `admin_use_${tid}` },
      { text: s(uid,'btn_kick'),         callback_data: `admin_kick_${tid}` },
    ]);
  }
  rows.push([{ text: s(uid,'btn_back'), callback_data:'back_main' }]);
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode:'HTML', reply_markup: { inline_keyboard: rows } });
}
async function adminKickUser(chatId, adminId, targetId) {
  const uid   = adminId;
  const state = userStates.get(Number(targetId));
  if (!state) { await bot.sendMessage(chatId, s(uid,'no_target')); return; }
  const name = state.info?.pushname || targetId;
  await bot.sendMessage(chatId, s(uid,'kicking', escapeHtml(String(name))));
  await destroyClient(state);
  // سحب الصلاحية أيضاً
  revokeUser(Number(targetId));
  if (state.chatId) {
    try {
      const tLang = userLangs.get(Number(targetId)) || 'ar';
      await bot.sendMessage(state.chatId, STRINGS[tLang].kicked_notify);
    } catch (_) {}
  }
  await bot.sendMessage(chatId, s(uid,'kicked', escapeHtml(String(name))), { reply_markup: backKeyboard(uid) });
}

// ─── Admin: Codes panel ────────────────────────────────────────────────────────
async function showAdminCodes(chatId, adminId) {
  const uid   = adminId;
  const codes = Object.entries(appData.inviteCodes);
  if (!codes.length) {
    await bot.sendMessage(chatId, s(uid,'no_codes'), {
      reply_markup: { inline_keyboard: [
        [{ text: s(uid,'btn_create_code'), callback_data:'code_create' }],
        [{ text: s(uid,'btn_back'),         callback_data:'back_main'  }],
      ]},
    });
    return;
  }
  const lines = [s(uid,'codes_title', codes.length)];
  for (const [code, info] of codes) {
    lines.push(s(uid,'code_line', code, info.usedCount, info.maxUses));
  }
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode:'HTML', reply_markup: codesListKeyboard(uid) });
}

// ─── Admin: Active Sessions Panel ──────────────────────────────────────────────
async function showActiveSessions(chatId, adminId) {
  const uid = adminId;
  const active = [...userStates.entries()].filter(([,st]) => st.status === 'ready' && st.client);
  if (!active.length) {
    await bot.sendMessage(chatId, s(uid,'no_active_sessions'), { reply_markup: backKeyboard(uid) });
    return;
  }
  const lines = [s(uid,'sessions_title', active.length), ''];
  const rows  = [];
  for (const [tid, st] of active) {
    const name  = escapeHtml(st.info?.pushname || '—');
    const phone = st.info?.wid?.user || '—';
    const isPinned = sharedSessionUserId === Number(tid);
    const icon  = isPinned ? '🟢' : '⚪';
    lines.push(`${icon} <code>${tid}</code> — ${name} | 📞 ${phone}`);
    rows.push([{
      text: `${icon} ${name} (${phone})`,
      callback_data: `session_set_shared_${tid}`,
    }]);
  }
  const autoIcon = sharedSessionUserId === null ? '✅' : '🔄';
  rows.push([{ text: `${autoIcon} تلقائي (أي جلسة نشطة)`, callback_data: 'session_set_shared_auto' }]);
  rows.push([{ text: s(uid,'btn_back'), callback_data: 'back_main' }]);
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
}

// ─── Admin: Broadcast ──────────────────────────────────────────────────────────
async function startBroadcast(chatId, adminId) {
  const state = getState(adminId);
  state.screen = 'awaiting_broadcast';
  const uid = adminId;
  await bot.sendMessage(chatId, s(uid,'broadcast_prompt'), {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: s(uid,'broadcast_cancel'), callback_data:'back_main' }]] },
  });
}
async function sendBroadcast(adminChatId, adminId, text) {
  const uid       = adminId;
  const allUsers  = [...userStates.entries()].filter(([id]) => Number(id) !== ADMIN_ID);
  if (!allUsers.length) {
    await bot.sendMessage(adminChatId, s(uid,'broadcast_none')); return;
  }
  await bot.sendMessage(adminChatId, s(uid,'broadcast_sending', allUsers.length));
  let ok = 0, fail = 0;
  for (const [tid, st] of allUsers) {
    const tChatId = st.chatId;
    if (!tChatId) { fail++; continue; }
    try {
      await bot.sendMessage(tChatId, s(uid,'broadcast_from') + escapeHtml(text), { parse_mode:'HTML' });
      ok++;
    } catch (_) { fail++; }
    await new Promise(r => setTimeout(r, 50));
  }
  await bot.sendMessage(adminChatId, s(uid,'broadcast_done', ok, fail), { reply_markup: mainMenuKeyboard(uid) });
}

// ─── WhatsApp Client ───────────────────────────────────────────────────────────
function buildClient(userId) {
  return new Client({
    authStrategy: new LocalAuth({ clientId: `tg_${userId}`, dataPath: SESSIONS_DIR }),
    puppeteer: {
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas','--no-first-run','--no-zygote',
        '--disable-gpu','--single-process','--disable-background-networking',
        '--disable-default-apps','--disable-sync','--disable-translate',
        '--hide-scrollbars','--metrics-recording-only','--mute-audio',
        '--no-default-browser-check','--safebrowsing-disable-auto-update',
      ],
    },
  });
}

function attachHandlers(state, userId, chatId, method, phoneNumber) {
  const client = state.client;
  const uid    = Number(userId);

  client.on('qr', async (qr) => {
    if (method === 'qr') {
      state.status = 'qr_pending';
      try { qrcodeTerminal.generate(qr, { small: true }); } catch (_) {}
      try {
        const buf = await qrcode.toBuffer(qr, { width: 512, margin: 1 });
        await bot.sendPhoto(chatId, buf, {
          caption: s(uid,'qr_caption'),
          parse_mode: 'HTML',
          reply_markup: cancelLinkKeyboard(uid),
        });
      } catch (e) {
        await bot.sendMessage(chatId, s(uid,'qr_fail', e.message), { reply_markup: cancelLinkKeyboard(uid) });
      }
    } else if (method === 'phone' && phoneNumber && !state.pairingRequested) {
      state.pairingRequested = true;
      try {
        const code   = await client.requestPairingCode(phoneNumber);
        const pretty = code?.length === 8 ? `${code.slice(0,4)}-${code.slice(4)}` : code;
        state.pairingCode = pretty;
        state.status = 'pairing_pending';
        await bot.sendMessage(chatId, s(uid,'pairing_msg', escapeHtml(pretty)), {
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [
            [{ text: s(uid,'pairing_copy', pretty), copy_text: { text: pretty } }],
            [{ text: s(uid,'btn_cancel_link'), callback_data:'cancel_link' }],
          ]},
        });
      } catch (e) {
        state.pairingRequested = false;
        state.lastError = e.message;
        await bot.sendMessage(chatId, s(uid,'pairing_fail', e.message), { reply_markup: phoneRetryKeyboard(uid) });
      }
    }
  });

  client.on('authenticated', async () => {
    state.status = 'authenticated';
    state.authenticatedAt = Date.now();
    await bot.sendMessage(chatId, s(uid,'authenticated'));
  });

  client.on('auth_failure', async (msg) => {
    state.status = 'disconnected';
    state.lastError = String(msg);
    await bot.sendMessage(chatId, s(uid,'auth_fail', msg), { reply_markup: backKeyboard(uid) });
  });

  client.on('ready', async () => {
    state.status = 'ready';
    state.connectedAt = Date.now();
    state.pairingCode = null;
    try { state.info = client.info || null; } catch (_) {}
    const info  = state.info;
    const who   = info?.pushname ? ` (${info.pushname})` : '';
    const phone = info?.wid?.user ? ` — ${info.wid.user}` : '';
    // حفظ اسم المستخدم في الإحصائيات
    updateUserName(uid, info?.pushname || '');
    await bot.sendMessage(chatId,
      s(uid,'ready_msg', escapeHtml(who), escapeHtml(phone)),
      { parse_mode:'HTML', reply_markup: mainMenuKeyboard(uid) });
    if (!isAdmin(uid) && ADMIN_ID) {
      try {
        await bot.sendMessage(ADMIN_ID,
          s(ADMIN_ID,'new_user_notif', uid, escapeHtml(info?.pushname||'—'), info?.wid?.user||'—'),
          {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[
              { text: s(ADMIN_ID,'btn_use_full'), callback_data: `admin_use_${uid}` },
              { text: s(ADMIN_ID,'btn_kick'),     callback_data: `admin_kick_${uid}` },
            ]]},
          });
      } catch (_) {}
    }
  });

  client.on('disconnected', async (reason) => {
    state.status = 'disconnected';
    state.client = null;
    state.pairingRequested = false;
    state.pairingCode = null;
    state.lastDisconnectReason = String(reason);
    await bot.sendMessage(chatId, s(uid,'disconnected', reason), { reply_markup: mainMenuKeyboard(uid) });
  });
}

async function startSession(userId, chatId, method, phoneNumber) {
  const state = getState(userId);
  const uid   = Number(userId);
  state.userId = uid;
  await destroyClient(state);
  clearSessionLocks(uid);
  Object.assign(state, {
    method, status: 'connecting', pairingRequested: false,
    pairingPhone: phoneNumber || null, pairingCode: null,
    chatId, lastError: null,
  });
  state.client = buildClient(uid);
  attachHandlers(state, uid, chatId, method, phoneNumber);
  try {
    await state.client.initialize();
  } catch (e) {
    state.status = 'disconnected'; state.client = null; state.lastError = e.message;
    if (/already running|SingletonLock|ProcessSingleton/i.test(e.message||'')) {
      await new Promise(r => setTimeout(r, 1500));
      clearSessionLocks(uid);
      try {
        state.client = buildClient(uid);
        attachHandlers(state, uid, chatId, method, phoneNumber);
        state.status = 'connecting';
        await state.client.initialize(); return;
      } catch (e2) {
        state.status = 'disconnected'; state.client = null; state.lastError = e2.message;
        await bot.sendMessage(chatId, s(uid,'start_fail', e2.message), { reply_markup: backKeyboard(uid) }); return;
      }
    }
    await bot.sendMessage(chatId, s(uid,'start_fail', e.message), { reply_markup: backKeyboard(uid) });
  }
}

async function restoreSession(userId, chatId) {
  const state = getState(userId);
  const uid   = Number(userId);
  state.userId = uid;
  if (state.status === 'ready') {
    await bot.sendMessage(chatId, s(uid,'session_active'), { reply_markup: mainMenuKeyboard(uid) }); return;
  }
  if (!hasSavedSession(uid)) {
    await bot.sendMessage(chatId, s(uid,'no_session'), { reply_markup: mainMenuKeyboard(uid) }); return;
  }
  await destroyClient(state);
  clearSessionLocks(uid);
  Object.assign(state, { method:'restore', status:'connecting', chatId, lastError:null });
  const loadMsg = await bot.sendMessage(chatId, s(uid,'restoring'));
  state.client = buildClient(uid);
  attachHandlers(state, uid, chatId, 'restore', null);
  try {
    await state.client.initialize();
    try { await bot.deleteMessage(chatId, loadMsg.message_id); } catch (_) {}
  } catch (e) {
    state.status = 'disconnected'; state.client = null; state.lastError = e.message;
    try { await bot.deleteMessage(chatId, loadMsg.message_id); } catch (_) {}
    await bot.sendMessage(chatId, s(uid,'restore_fail', e.message), { reply_markup: mainMenuKeyboard(uid) });
  }
}

async function handleLogout(userId, chatId) {
  const state = getState(userId);
  const uid   = Number(userId);
  state.userId = uid;
  await bot.sendMessage(chatId, s(uid,'logging_out'));
  await destroyClient(state);
  const sessionDir = path.join(SESSIONS_DIR, `session-tg_${uid}`);
  try { if (fs.existsSync(sessionDir)) fs.rmSync(sessionDir, { recursive:true, force:true }); } catch (_) {}
  Object.assign(state, {
    info: null, connectedAt: null, authenticatedAt: null,
    method: null, lastError: null, lastDisconnectReason: null,
    checks: { totalChecked:0, registered:0, unregistered:0, errors:0 },
  });
  await bot.sendMessage(chatId, s(uid,'logged_out'), { reply_markup: mainMenuKeyboard(uid) });
}

// ─── Cancel Linking ────────────────────────────────────────────────────────────
async function cancelLinking(userId, chatId) {
  const state = getState(userId);
  const uid   = Number(userId);
  state.userId = uid;
  await destroyClient(state);
  clearSessionLocks(uid);
  Object.assign(state, { method: null, status: 'disconnected', lastError: null, pairingCode: null });
  await bot.sendMessage(chatId, s(uid,'linking_cancelled'), { reply_markup: mainMenuKeyboard(uid) });
}

// ─── Parsing ──────────────────────────────────────────────────────────────────
function parseNumbers(text) {
  const tokens  = text.split(/[\s,;\r\n]+/).filter(Boolean);
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
bot.onText(/^\/start\b/, async (msg) => {
  const uid   = msg.from.id;
  const state = getState(uid);
  state.userId = uid;
  state.chatId = msg.chat.id;
  // تسجيل اسم المستخدم
  updateUserName(uid, msg.from.first_name || msg.from.username || '');
  if (!userLangs.has(uid)) {
    await showLangChoice(msg.chat.id);
  } else if (!isAllowed(uid)) {
    await showInvitePrompt(msg.chat.id, uid);
  } else {
    await showMain(msg.chat.id, state);
  }
});
bot.onText(/^\/help\b/,    async (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const st = getState(msg.from.id); st.userId = msg.from.id; await showHelp(msg.chat.id, st);
});
bot.onText(/^\/link\b/,    async (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const st = getState(msg.from.id); st.userId = msg.from.id; await showLinkMenu(msg.chat.id, st);
});
bot.onText(/^\/check\b/,   async (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const st = getState(msg.from.id); st.userId = msg.from.id; await promptCheck(msg.chat.id, st);
});
bot.onText(/^\/status\b/,  async (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const st = getState(msg.from.id); st.userId = msg.from.id; await showStatus(msg.chat.id, st);
});
bot.onText(/^\/restore\b/, async (msg) => {
  if (!isAllowed(msg.from.id)) return;
  const st = getState(msg.from.id); st.userId = msg.from.id; await restoreSession(msg.from.id, msg.chat.id);
});
bot.onText(/^\/logout\b/,  async (msg) => {
  if (!isAdmin(msg.from.id)) { await bot.sendMessage(msg.chat.id, s(msg.from.id,'admin_only')); return; }
  await handleLogout(msg.from.id, msg.chat.id);
});
bot.onText(/^\/users\b/, async (msg) => {
  if (!isAdmin(msg.from.id)) { await bot.sendMessage(msg.chat.id, s(msg.from.id,'admin_only')); return; }
  await showAdminUsers(msg.chat.id, msg.from.id);
});
bot.onText(/^\/codes\b/, async (msg) => {
  if (!isAdmin(msg.from.id)) { await bot.sendMessage(msg.chat.id, s(msg.from.id,'admin_only')); return; }
  await showAdminCodes(msg.chat.id, msg.from.id);
});
bot.onText(/^\/pause\b/, async (msg) => {
  if (!isAdmin(msg.from.id)) { await bot.sendMessage(msg.chat.id, s(msg.from.id,'admin_only')); return; }
  botPaused = !botPaused;
  const uid = msg.from.id;
  await bot.sendMessage(msg.chat.id,
    botPaused ? s(uid,'bot_paused_msg') : s(uid,'bot_resumed_msg'),
    { parse_mode:'HTML', reply_markup: mainMenuKeyboard(uid) });
});

// ─── Callback Queries ─────────────────────────────────────────────────────────
bot.on('callback_query', async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const state  = getState(userId);
  state.userId = userId;
  state.chatId = chatId;

  try {
    await bot.answerCallbackQuery(q.id).catch(() => {});

    // Language selection — allowed before invite check
    if (q.data === 'set_lang_ar' || q.data === 'set_lang_en') {
      const lang = q.data === 'set_lang_ar' ? 'ar' : 'en';
      userLangs.set(userId, lang);
      await bot.sendMessage(chatId, STRINGS[lang].welcome, { parse_mode:'HTML' });
      if (!isAllowed(userId)) { await showInvitePrompt(chatId, userId); return; }
      await showMain(chatId, state);
      return;
    }

    // Block non-allowed users (except admin)
    if (!isAllowed(userId)) {
      await bot.answerCallbackQuery(q.id, { text: s(userId,'invite_required'), show_alert: true });
      return;
    }

    // ── إلغاء الربط ──────────────────────────────────────────────────────────
    if (q.data === 'cancel_link') {
      await cancelLinking(userId, chatId);
      return;
    }

    // ── Session set shared ────────────────────────────────────────────────────
    if (q.data.startsWith('session_set_shared_')) {
      if (!isAdmin(userId)) return;
      const val = q.data.replace('session_set_shared_', '');
      if (val === 'auto') {
        sharedSessionUserId = null;
        await bot.sendMessage(chatId, s(userId,'session_shared_auto'), { parse_mode:'HTML', reply_markup: mainMenuKeyboard(userId) });
      } else {
        const tid = Number(val);
        sharedSessionUserId = tid;
        const ts   = userStates.get(tid);
        const name = ts?.info?.pushname || `#${tid}`;
        await bot.sendMessage(chatId, s(userId,'session_shared_set', name), { parse_mode:'HTML', reply_markup: mainMenuKeyboard(userId) });
      }
      return;
    }

    // ── Admin: codes ──────────────────────────────────────────────────────────
    if (q.data === 'menu_codes') {
      if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); return; }
      await showAdminCodes(chatId, userId); return;
    }
    if (q.data === 'code_create') {
      if (!isAdmin(userId)) return;
      await bot.sendMessage(chatId, s(userId,'create_code_title'), {
        parse_mode:'HTML',
        reply_markup: createCodeUsesKeyboard(userId),
      }); return;
    }
    if (q.data.startsWith('code_uses_')) {
      if (!isAdmin(userId)) return;
      const maxUses = Number(q.data.replace('code_uses_',''));
      const code = createInviteCode(maxUses);
      await bot.sendMessage(chatId, s(userId,'code_created', code, maxUses), {
        parse_mode:'HTML',
        reply_markup: { inline_keyboard: [[{ text: s(userId,'btn_back'), callback_data:'menu_codes' }]] },
      }); return;
    }
    if (q.data.startsWith('code_del_')) {
      if (!isAdmin(userId)) return;
      const code = q.data.replace('code_del_','');
      deleteInviteCode(code);
      await bot.sendMessage(chatId, s(userId,'code_deleted'), { reply_markup: { inline_keyboard: [[{ text: s(userId,'btn_back'), callback_data:'menu_codes' }]] } }); return;
    }
    if (q.data.startsWith('code_info_')) {
      if (!isAdmin(userId)) return;
      const code  = q.data.replace('code_info_','');
      const entry = appData.inviteCodes[code];
      if (!entry) { await bot.sendMessage(chatId, s(userId,'code_deleted')); return; }
      const lines = [
        s(userId,'code_info_title', code),
        s(userId,'code_info_max',   entry.maxUses),
        s(userId,'code_info_used',  entry.usedCount),
        s(userId,'code_info_users', entry.usedBy.join(', ')),
        s(userId,'code_info_date',  formatDateTime(entry.createdAt)),
      ];
      await bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode:'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: s(userId,'btn_delete_code'), callback_data:`code_del_${code}` }],
          [{ text: s(userId,'btn_back'),         callback_data:'menu_codes' }],
        ]},
      }); return;
    }

    // ── Admin: users ──────────────────────────────────────────────────────────
    if (q.data.startsWith('admin_kick_')) {
      if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); return; }
      await adminKickUser(chatId, userId, q.data.replace('admin_kick_',''));
      return;
    }
    if (q.data.startsWith('admin_info_')) {
      if (!isAdmin(userId)) return;
      const tid = Number(q.data.replace('admin_info_',''));
      const ts  = userStates.get(tid);
      if (!ts) { await bot.sendMessage(chatId, s(userId,'no_target')); return; }
      const pStats = appData.userStats[tid];
      const lines = [
        s(userId,'info_title'),
        s(userId,'info_id',      tid),
        s(userId,'info_name',    escapeHtml(ts.info?.pushname || pStats?.name || '—')),
        s(userId,'info_phone',   ts.info?.wid?.user||'—'),
        s(userId,'info_status',  statusLabel(ts, tid)),
        s(userId,'info_checks',  ts.checks.totalChecked, ts.checks.registered, ts.checks.unregistered),
        s(userId,'info_code',    pStats?.joinedViaCode || '—'),
        s(userId,'info_allowed', isAllowed(tid)),
      ];
      await bot.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: s(userId,'btn_use_full'), callback_data:`admin_use_${tid}` },
           { text: s(userId,'btn_kick'),     callback_data:`admin_kick_${tid}` }],
          [{ text: s(userId,'btn_back'),     callback_data:'menu_users' }],
        ]},
      });
      return;
    }
    if (q.data.startsWith('admin_use_')) {
      if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); return; }
      const tid = Number(q.data.replace('admin_use_',''));
      const ts  = userStates.get(tid);
      if (!ts || ts.status !== 'ready' || !ts.client) {
        await bot.sendMessage(chatId, s(userId,'no_session_target')); return;
      }
      state.client = ts.client; state.status = 'ready';
      state.info = ts.info; state.method = 'borrowed';
      await bot.sendMessage(chatId,
        s(userId,'borrowed_msg', escapeHtml(String(ts.info?.pushname||tid)), ts.info?.wid?.user||'—'),
        { parse_mode:'HTML', reply_markup: mainMenuKeyboard(userId) });
      return;
    }

    // ── Prefix parent ─────────────────────────────────────────────────────────
    if (q.data.startsWith('pfx:')) {
      const pp      = q.data.slice(4);
      const pending = userFilePending.get(userId);
      if (!pending?.parentGroups[pp]) {
        await bot.answerCallbackQuery(q.id, { text: s(userId,'expired'), show_alert:true }); return;
      }
      const total = pending.parentGroups[pp].length;
      const done  = Object.entries(pending.checked).filter(([k]) => k.startsWith(pp)).reduce((sum,[,v]) => sum+v.size, 0);
      await bot.sendMessage(chatId, s(userId,'prefix_header', pp, total, done), {
        parse_mode: 'HTML',
        reply_markup: buildSubPrefixMarkup(pp, pending.subGroups, pending.checked, userId),
      });
      return;
    }

    // ── Sub-prefix ────────────────────────────────────────────────────────────
    if (q.data.startsWith('subpfx:')) {
      const prefix  = q.data.slice(7);
      const parent  = prefix.slice(0, 2);
      const pending = userFilePending.get(userId);
      if (!pending?.subGroups[prefix]) {
        await bot.answerCallbackQuery(q.id, { text: s(userId,'expired'), show_alert:true }); return;
      }
      if (botPaused && !isAdmin(userId)) {
        await bot.answerCallbackQuery(q.id, { text: s(userId,'bot_paused_notice'), show_alert:true }); return;
      }
      if (state.status !== 'ready' || !state.client) {
        if (sharedSessionOn) {
          const shared = getSharedClient();
          if (shared) { state.client = shared.client; state.status = 'ready'; state.info = shared.info; state.method = 'shared'; }
          else { await bot.answerCallbackQuery(q.id, { text: s(userId,'no_shared'), show_alert:true }); return; }
        } else {
          await bot.answerCallbackQuery(q.id, { text: s(userId,'session_not_ready'), show_alert:true }); return;
        }
      }
      if (!pending.checked[prefix]) pending.checked[prefix] = new Set();
      const checkedSet = pending.checked[prefix];
      const remaining  = pending.subGroups[prefix].filter(n => !checkedSet.has(n));
      if (!remaining.length) {
        await bot.answerCallbackQuery(q.id, { text: s(userId,'all_done'), show_alert:true }); return;
      }
      const picked   = shuffle(remaining).slice(0, 100);
      for (const n of picked) checkedSet.add(n);
      const leftAfter = remaining.length - picked.length;
      const totalDone = Object.values(pending.checked).reduce((sum,st) => sum+st.size, 0);
      await bot.sendMessage(chatId, s(userId,'picking', prefix, picked.length, leftAfter), { parse_mode:'HTML' });
      await checkNumbers(state, chatId, picked, userId);
      const afterRows = [];
      if (leftAfter > 0) afterRows.push([{ text: s(userId,'new_round', prefix, leftAfter), callback_data:`subpfx:${prefix}` }]);
      afterRows.push([{ text: s(userId,'back_parent', parent), callback_data:`pfx:${parent}` }]);
      afterRows.push([{ text: s(userId,'prefix_list_btn', totalDone), callback_data:'menu_file_list' }]);
      afterRows.push([{ text: s(userId,'btn_home'), callback_data:'back_main' }]);
      await bot.sendMessage(chatId, s(userId,'next_action'), { reply_markup: { inline_keyboard: afterRows } });
      return;
    }

    switch (q.data) {
      case 'back_main':         await showMain(chatId, state); break;
      case 'menu_link':         await showLinkMenu(chatId, state); break;
      case 'menu_status':       await showStatus(chatId, state); break;
      case 'menu_check':        await promptCheck(chatId, state); break;
      case 'menu_help':         await showHelp(chatId, state); break;
      case 'menu_lang':         await showLangChoice(chatId); break;
      case 'menu_restore':      await restoreSession(userId, chatId); break;
      case 'menu_broadcast':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); break; }
        await startBroadcast(chatId, userId); break;
      case 'menu_shared_toggle':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); break; }
        sharedSessionOn = !sharedSessionOn;
        // عند الإيقاف: قطع الجلسة عند كل المستخدمين الذين كانوا يستخدمون الجلسة المشتركة
        if (!sharedSessionOn) {
          for (const [tid, st] of userStates) {
            if (Number(tid) === ADMIN_ID) continue;
            if (st.method === 'shared') {
              st.client = null;
              st.status = 'disconnected';
              st.method = null;
              st.info   = null;
              if (st.chatId) {
                const tLang = userLangs.get(Number(tid)) || 'ar';
                try {
                  await bot.sendMessage(st.chatId,
                    STRINGS[tLang].shared_off,
                    { parse_mode: 'HTML', reply_markup: mainMenuKeyboard(Number(tid)) });
                } catch (_) {}
              }
            }
          }
        }
        await bot.sendMessage(chatId,
          sharedSessionOn ? s(userId,'shared_on') : s(userId,'shared_off'),
          { parse_mode:'HTML', reply_markup: mainMenuKeyboard(userId) });
        break;
      case 'menu_pause_toggle':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); break; }
        botPaused = !botPaused;
        await bot.sendMessage(chatId,
          botPaused ? s(userId,'bot_paused_msg') : s(userId,'bot_resumed_msg'),
          { parse_mode:'HTML', reply_markup: mainMenuKeyboard(userId) });
        break;
      case 'menu_invite_toggle':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); break; }
        inviteSystemOn = !inviteSystemOn;
        await bot.sendMessage(chatId,
          inviteSystemOn ? s(userId,'invite_system_on_msg') : s(userId,'invite_system_off_msg'),
          { parse_mode:'HTML', reply_markup: mainMenuKeyboard(userId) });
        break;
      case 'menu_sessions':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); break; }
        await showActiveSessions(chatId, userId); break;
      case 'menu_file_list': {
        const fp = userFilePending.get(userId);
        if (!fp) { await bot.sendMessage(chatId, s(userId,'no_file'), { reply_markup: backKeyboard(userId) }); break; }
        const totalDone = Object.values(fp.checked).reduce((sum,st) => sum+st.size, 0);
        await bot.sendMessage(chatId,
          `${fp.menuText}\n\n${s(userId,'done_total', totalDone)}`,
          { parse_mode:'HTML', reply_markup: buildPrefixMarkup(fp.parentGroups, fp.checked, userId) });
        break;
      }
      case 'menu_users':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); break; }
        await showAdminUsers(chatId, userId); break;
      case 'menu_logout':
        if (!isAdmin(userId)) { await bot.sendMessage(chatId, s(userId,'admin_only')); break; }
        await handleLogout(userId, chatId); break;
      case 'link_qr':
        await bot.sendMessage(chatId, s(userId,'preparing_qr'));
        await startSession(userId, chatId, 'qr'); break;
      case 'link_phone':
        await promptPhone(chatId, state); break;
    }
  } catch (e) {
    try { await bot.answerCallbackQuery(q.id, { text: 'Error: ' + e.message }); } catch (_) {}
  }
});

// ─── Message Handler ──────────────────────────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const state  = getState(userId);
  state.userId = userId;
  state.chatId = chatId;

  // حفظ اسم المستخدم
  updateUserName(userId, msg.from.first_name || msg.from.username || '');

  // ── تحقق من كود الدعوة ──────────────────────────────────────────────────────
  if (!isAllowed(userId)) {
    if (msg.text && !msg.text.startsWith('/')) {
      // المستخدم يرسل كوداً
      const code = msg.text.trim().toUpperCase();
      const result = useInviteCode(code, userId);
      if (result.ok) {
        const langStr = userLangs.get(userId) || 'ar';
        const welcome = result.remaining > 0
          ? STRINGS[langStr].invite_ok(result.remaining)
          : STRINGS[langStr].invite_ok_last;
        await bot.sendMessage(chatId, welcome, { parse_mode:'HTML' });
        await showMain(chatId, state);
      } else {
        await bot.sendMessage(chatId, s(userId,'invite_invalid'), { parse_mode:'HTML' });
      }
    } else if (!msg.text?.startsWith('/')) {
      await showInvitePrompt(chatId, userId);
    }
    return;
  }

  // ── ملف مرسل ────────────────────────────────────────────────────────────────
  if (msg.document) {
    const uid  = userId;
    if (botPaused && !isAdmin(uid)) {
      await bot.sendMessage(chatId, s(uid,'bot_paused_notice'), { reply_markup: mainMenuKeyboard(uid) });
      return;
    }
    const isReady = state.status === 'ready' && state.client;
    const shared  = sharedSessionOn ? getSharedClient() : null;
    if (!isReady && !shared) {
      await bot.sendMessage(chatId, s(uid,'must_link', statusLabel(state,uid)), { reply_markup: mainMenuKeyboard(uid) });
      return;
    }
    if (!isReady && shared) {
      state.client = shared.client; state.status = 'ready'; state.info = shared.info; state.method = 'shared';
    }
    const doc  = msg.document;
    const name = doc.file_name || '';
    const mime = doc.mime_type || '';
    if (!mime.includes('text') && !name.endsWith('.txt') && !name.endsWith('.csv')) {
      await bot.sendMessage(chatId, s(uid,'file_only_text'), { reply_markup: backKeyboard(uid) }); return;
    }
    if (doc.file_size > 5 * 1024 * 1024) {
      await bot.sendMessage(chatId, s(uid,'file_too_large')); return;
    }
    try {
      const procMsg  = await bot.sendMessage(chatId, s(uid,'reading_file'));
      const numbers  = await fetchFileNumbers(doc.file_id);
      if (!numbers.length) {
        await bot.editMessageText(s(uid,'no_numbers'), { chat_id:chatId, message_id:procMsg.message_id }).catch(()=>{});
        return;
      }
      const parentGroups = groupByPrefix(numbers);
      const subGroups    = groupBySubPrefix(numbers);
      const parents      = Object.keys(parentGroups).sort();
      const menuText     = s(uid,'file_ok', numbers.length, parents.length);
      const checked      = {};
      const markup       = buildPrefixMarkup(parentGroups, checked, uid);
      userFilePending.set(uid, { parentGroups, subGroups, checked, menuText });
      await bot.editMessageText(menuText, {
        chat_id:chatId, message_id:procMsg.message_id, parse_mode:'HTML', reply_markup:markup,
      }).catch(async () => {
        await bot.sendMessage(chatId, menuText, { parse_mode:'HTML', reply_markup:markup });
      });
    } catch (e) {
      await bot.sendMessage(chatId, s(userId,'file_err', e.message), { reply_markup: backKeyboard(userId) });
    }
    return;
  }

  if (!msg.text) return;
  if (msg.text.startsWith('/')) return;
  const text = msg.text.trim();

  // Broadcast awaiting
  if (state.screen === 'awaiting_broadcast' && isAdmin(userId)) {
    state.screen = 'main';
    await sendBroadcast(chatId, userId, text);
    return;
  }

  // Phone number awaiting
  if (state.screen === 'awaiting_phone') {
    state.screen = 'main';
    const phone = cleanNumber(text);
    if (phone.length < 8) {
      await bot.sendMessage(chatId, s(userId,'phone_invalid'), { reply_markup: phoneRetryKeyboard(userId) }); return;
    }
    await bot.sendMessage(chatId, s(userId,'requesting_code'));
    await startSession(userId, chatId, 'phone', phone);
    return;
  }

  // Numbers check
  if (state.screen === 'awaiting_numbers' || state.status === 'ready') {
    if (botPaused && !isAdmin(userId)) {
      await bot.sendMessage(chatId, s(userId,'bot_paused_notice'), { reply_markup: mainMenuKeyboard(userId) });
      return;
    }
    const isReady = state.status === 'ready' && state.client;
    const shared  = sharedSessionOn ? getSharedClient() : null;
    if (!isReady && !shared) {
      await bot.sendMessage(chatId, s(userId,'must_link', statusLabel(state,userId)), { reply_markup: mainMenuKeyboard(userId) });
      return;
    }
    if (!isReady && shared) {
      state.client = shared.client; state.status = 'ready'; state.info = shared.info; state.method = 'shared';
    }
    const numbers = parseNumbers(text);
    if (!numbers.length) { await bot.sendMessage(chatId, s(userId,'no_numbers'), { reply_markup: backKeyboard(userId) }); return; }
    await checkNumbers(state, chatId, numbers, userId);
    return;
  }

  if (!userLangs.has(userId)) { await showLangChoice(chatId); return; }
  await showMain(chatId, state);
});

// ─── Number Checking ──────────────────────────────────────────────────────────
async function checkNumbers(state, chatId, numbers, userId) {
  const uid          = Number(userId);
  const total        = numbers.length;
  const totalBatches = Math.ceil(total / BATCH_SIZE);
  let progressMsgId  = null;

  try {
    const sent = await bot.sendMessage(chatId, s(uid,'checking', total), { parse_mode:'HTML' });
    progressMsgId = sent.message_id;
  } catch (_) {}

  const updateProgress = async (text) => {
    if (!progressMsgId) return;
    try { await bot.editMessageText(text, { chat_id:chatId, message_id:progressMsgId, parse_mode:'HTML' }); } catch (_) {}
  };

  const registered = [], unregistered = [], errors = [];

  for (let b = 0; b < totalBatches; b++) {
    const batch = numbers.slice(b * BATCH_SIZE, (b+1) * BATCH_SIZE);
    if (totalBatches > 1) await updateProgress(s(uid,'batch_prog', b+1, totalBatches, batch.length));

    const results = new Array(batch.length);
    let cursor = 0, done = 0;

    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= batch.length) return;
        const num = batch[idx];
        try {
          if (!state.client || state.status !== 'ready') { results[idx] = { kind:'error', num }; }
          else {
            if (CHECK_DELAY_MS > 0) await new Promise(r => setTimeout(r, CHECK_DELAY_MS));
            const id = await state.client.getNumberId(num);
            results[idx] = { kind: id ? 'registered' : 'unregistered', num };
          }
        } catch (_) { results[idx] = { kind:'error', num }; }
        done++;
      }
    };

    const timer = setInterval(() => {
      const txt = totalBatches > 1
        ? s(uid,'batch_done_prog', b+1, totalBatches, done, batch.length)
        : s(uid,'done_prog', done, batch.length);
      updateProgress(txt);
    }, 1500);

    await Promise.all(Array.from({ length: CHECK_CONCURRENCY }, worker));
    clearInterval(timer);

    for (const r of results) {
      if (r.kind === 'registered')        registered.push(r.num);
      else if (r.kind === 'unregistered') unregistered.push(r.num);
      else                                errors.push(r.num);
    }
  }

  // تحديث الإحصائيات
  state.checks.totalChecked  += total;
  state.checks.registered    += registered.length;
  state.checks.unregistered  += unregistered.length;
  state.checks.errors        += errors.length;
  recordChecks(uid, total, registered.length, unregistered.length);

  if (progressMsgId) { try { await bot.deleteMessage(chatId, progressMsgId); } catch (_) {} }

  const hasPending = userFilePending.has(uid);
  const totalResult = registered.length + unregistered.length;

  // ── إرسال كملف إذا الأرقام أكثر من الحد ──────────────────────────────────
  if (totalResult >= EXPORT_THRESHOLD) {
    await sendResultsAsFiles(chatId, uid, registered, unregistered, errors, hasPending);
    return;
  }

  // ── إرسال كرسائل عادية ────────────────────────────────────────────────────
  const lines = [];
  for (const n of registered) lines.push(`✅ ${n}`);
  if (unregistered.length) {
    if (registered.length) lines.push('━━━━━━━━━━━━━');
    lines.push(s(uid,'not_reg_header', unregistered.length), '');
    for (const n of unregistered) lines.push(`❌ <code>${escapeHtml(stripCountryCode(n))}</code>`);
  }
  if (errors.length) {
    if (lines.length) lines.push('━━━━━━━━━━━━━');
    lines.push(s(uid,'err_header', errors.length), '');
    for (const n of errors) lines.push(`⚠️ <code>${escapeHtml(n)}</code>`);
  }

  if (!lines.length) {
    await bot.sendMessage(chatId, s(uid,'no_checked'), { reply_markup: afterCheckKeyboard(uid, state.checks.totalChecked, hasPending) });
    return;
  }
  const chunks = chunkLines(lines, 3800);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    await bot.sendMessage(chatId, chunks[i], {
      parse_mode: 'HTML',
      reply_markup: isLast ? afterCheckKeyboard(uid, state.checks.totalChecked, hasPending) : undefined,
    });
  }
}

// ─── Export Results as Files ──────────────────────────────────────────────────
async function sendResultsAsFiles(chatId, userId, registered, unregistered, errors, hasPending) {
  const uid  = Number(userId);
  const date = new Date().toISOString().slice(0,10).replace(/-/g,'');

  await bot.sendMessage(chatId, s(uid,'export_sending'));

  const tmpDir = os.tmpdir();

  // ملف الأرقام المسجلة
  if (registered.length > 0) {
    const regContent = registered.join('\n');
    const regFile    = path.join(tmpDir, `reg_${uid}_${date}.txt`);
    fs.writeFileSync(regFile, regContent, 'utf8');
    try {
      await bot.sendDocument(chatId, regFile, {
        caption: `✅ مسجّل على واتساب [ ${registered.length} ]`,
        filename: s(uid,'export_reg_name', date),
      });
    } catch (_) {}
    try { fs.unlinkSync(regFile); } catch (_) {}
  }

  // ملف الأرقام غير المسجلة
  if (unregistered.length > 0) {
    const unregContent = unregistered.map(n => stripCountryCode(n)).join('\n');
    const unregFile    = path.join(tmpDir, `unreg_${uid}_${date}.txt`);
    fs.writeFileSync(unregFile, unregContent, 'utf8');
    try {
      await bot.sendDocument(chatId, unregFile, {
        caption: `❌ غير مسجّل [ ${unregistered.length} ]`,
        filename: s(uid,'export_unreg_name', date),
      });
    } catch (_) {}
    try { fs.unlinkSync(unregFile); } catch (_) {}
  }

  // ملخص + أزرار
  const state = getState(uid);
  await bot.sendMessage(chatId,
    s(uid,'export_caption', registered.length, unregistered.length),
    { parse_mode:'HTML', reply_markup: afterCheckKeyboard(uid, state.checks.totalChecked, hasPending) });
}

// ─── Daily Report ─────────────────────────────────────────────────────────────
let lastReportDay = null;

function buildDailyReport() {
  const today = todayKey();
  let totalChecked = 0, totalReg = 0, totalUnreg = 0;
  let topUserId = null, topCount = 0, activeUsers = 0;

  for (const [uid, stats] of Object.entries(appData.userStats)) {
    const dayCount = stats.dailyChecks?.[today] || 0;
    if (dayCount > 0) {
      totalChecked += dayCount;
      activeUsers++;
      if (dayCount > topCount) { topCount = dayCount; topUserId = uid; }
    }
    totalReg   += (stats.registered   || 0);
    totalUnreg += (stats.unregistered || 0);
  }

  return { today, totalChecked, totalReg, totalUnreg, topUserId, topCount, activeUsers };
}

async function sendDailyReport() {
  if (!ADMIN_ID) return;
  const { today, totalChecked, topUserId, topCount, activeUsers } = buildDailyReport();
  const langStr = userLangs.get(ADMIN_ID) || 'ar';

  if (totalChecked === 0) {
    await bot.sendMessage(ADMIN_ID, STRINGS[langStr].daily_report_no_activity(today), { parse_mode:'HTML' }).catch(() => {});
    return;
  }

  // تحديد المستخدم الأكثر نشاطاً
  const topStats = topUserId ? appData.userStats[topUserId] : null;
  const topWaState = topUserId ? userStates.get(Number(topUserId)) : null;
  const topName =
    topWaState?.info?.pushname ||
    topStats?.name ||
    (topUserId ? `#${topUserId}` : '—');

  const totalReg   = Object.values(appData.userStats).reduce((s,u) => s + (u.dailyChecks?.[today] || 0), 0);

  await bot.sendMessage(ADMIN_ID,
    STRINGS[langStr].daily_report(today, totalChecked, '—', '—', escapeHtml(topName), topCount, activeUsers),
    { parse_mode:'HTML' }
  ).catch(() => {});
}

// فحص كل دقيقة إذا حان وقت التقرير (منتصف الليل بتوقيت الرياض)
setInterval(async () => {
  try {
    const nowRiyadh = new Date().toLocaleString('en-CA', { timeZone: 'Asia/Riyadh', hour12: false });
    const timePart  = nowRiyadh.split(', ')[1] || '';
    const [hh, mm]  = timePart.split(':').map(Number);
    const today     = todayKey();
    // إرسال التقرير عند 23:59
    if (hh === 23 && mm === 59 && lastReportDay !== today) {
      lastReportDay = today;
      await sendDailyReport();
    }
  } catch (_) {}
}, 60 * 1000);

// ─── Command Menu ──────────────────────────────────────────────────────────────
async function setupCommandMenus() {
  const base = (lang) => [
    { command:'start',   description: STRINGS[lang].cmd_start },
    { command:'link',    description: STRINGS[lang].cmd_link },
    { command:'restore', description: STRINGS[lang].cmd_restore },
    { command:'check',   description: STRINGS[lang].cmd_check },
    { command:'status',  description: STRINGS[lang].cmd_status },
    { command:'help',    description: STRINGS[lang].cmd_help },
  ];
  try { await bot.setMyCommands(base('ar'), { scope:{ type:'default' } }); } catch (_) {}
  if (ADMIN_ID) {
    try {
      const lang = userLangs.get(ADMIN_ID) || 'ar';
      await bot.setMyCommands(
        [...base(lang),
          { command:'users',  description: STRINGS[lang].cmd_users },
          { command:'codes',  description: '🔐 إدارة أكواد الدعوة' },
          { command:'pause',  description: '⏸ إيقاف/تشغيل البوت مؤقتاً' },
          { command:'logout', description: STRINGS[lang].cmd_logout },
        ],
        { scope:{ type:'chat', chat_id:ADMIN_ID } },
      );
    } catch (_) {}
  }
}

// ─── Process Safety ────────────────────────────────────────────────────────────
bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));
process.on('SIGINT',  () => { saveData(); process.exit(0); });
process.on('SIGTERM', () => { saveData(); process.exit(0); });

setupCommandMenus().catch(() => {});
console.log(`🤖 Bot v3 ready | CONCURRENCY=${CHECK_CONCURRENCY} | BATCH=${BATCH_SIZE} | DELAY=${CHECK_DELAY_MS}ms | EXPORT_THRESHOLD=${EXPORT_THRESHOLD}`);
