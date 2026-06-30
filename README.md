# WhatsApp Checker Bot v3

بوت تيليغرام لفحص أرقام واتساب مع نظام أكواد الدعوة.

## المتغيرات المطلوبة (Environment Variables)

| المتغير | الوصف | مثال |
|---------|-------|------|
| `BOT_TOKEN` | توكن البوت من @BotFather | `123456:ABC-DEF...` |
| `ADMIN_ID` | رقم حسابك على تيليغرام (من @userinfobot) | `123456789` |
| `CHECK_CONCURRENCY` | عدد الاتصالات المتزامنة (اختياري) | `15` |
| `CHECK_DELAY_MS` | تأخير بين الأرقام بالمللي ثانية (اختياري) | `300` |

---

## التشغيل على Railway

### 1. ارفع الملفات على GitHub
```bash
git init
git add .
git commit -m "WhatsApp Checker Bot v3"
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

### 2. أنشئ مشروع جديد على Railway
- اذهب إلى [railway.app](https://railway.app)
- اضغط **New Project → Deploy from GitHub repo**
- اختر الريبو

### 3. أضف المتغيرات السرية
في Railway → Variables:
```
BOT_TOKEN=your_bot_token
ADMIN_ID=your_telegram_id
```

### 4. Deploy
Railway سيبني ويشغّل البوت تلقائياً عبر Docker.

---

## التشغيل المحلي
```bash
cp .env.example .env
# عدّل .env
npm install
npm start
```

---

## المميزات
- 🔐 نظام أكواد الدعوة (5/10/15/20/30/40/50/100 استخدام)
- 📤 تصدير النتائج كملف إذا تجاوزت 200 رقم
- 📊 تقرير يومي تلقائي في 23:59
- ❌ زر إلغاء الربط أثناء QR أو رقم الهاتف
- 📂 زر فحص الملف في القائمة الرئيسية
- 💾 حفظ البيانات في data.json
- 🌐 دعم العربية والإنجليزية
