// index.js

const { 
    makeWASocket, 
    useMultiFileAuthState, 
    makeCacheableSignalRepository
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express'); // استيراد Express.js

// === الإعدادات ===
const ownerNumber = '966xxxxxxxxx'; // ضع رقمك هنا (بدون +)
const PORT = process.env.PORT || 3000; // لاستخدام المنفذ المحدد من Render
const app = express();
const logger = pino({ level: 'silent' });
// ==================

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('session');

    const sock = makeWASocket({
        logger,
        printQRInTerminal: false,
        browser: ['My Custom Anti-Delete Bot', 'Chrome', '1.0.0'],
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalRepository(state.keys, logger),
        },
        shouldUsePairingCode: true // تفعيل رمز الاقتران
    });

    // ----------------------------------------------------
    // *** منطق الويب لطلب رمز الاقتران ***
    // ----------------------------------------------------

    if (!sock.authState.creds.registered) {
        let pairingCode = '';
        try {
            pairingCode = await sock.requestPairingCode(ownerNumber);
            console.log(`تم توليد رمز الاقتران في الخلفية: ${pairingCode}`);
        } catch (error) {
            console.error('خطأ في توليد رمز الاقتران:', error);
            pairingCode = 'فشل توليد الرمز. تحقق من رقم المالك.';
        }

        // إنشاء مسار (Route) لعرض رمز الاقتران
        app.get('/', (req, res) => {
            const htmlResponse = `
                <!DOCTYPE html>
                <html lang="ar">
                <head>
                    <meta charset="UTF-8">
                    <title>رمز اقتران بوت واتساب</title>
                    <style>
                        body { font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background-color: #f4f4f4; }
                        .container { background-color: #ffffff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.1); display: inline-block; }
                        .code { font-size: 2em; color: #1e88e5; border: 2px solid #1e88e5; padding: 10px 20px; border-radius: 5px; margin: 20px 0; display: inline-block; font-weight: bold; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>🤖 بوتك يعمل على Render!</h1>
                        <p>لاستكمال الربط، استخدم رمز الاقتران التالي في واتساب:</p>
                        <div class="code">${pairingCode}</div>
                        <p>اذهب إلى: *الإعدادات* > *الأجهزة المرتبطة* > *ربط جهاز* > *ربط باستخدام رقم الهاتف بدلاً من ذلك*.</p>
                        <p>⚠️ بعد استخدام الرمز، سيتم إزالة هذه الصفحة تلقائياً وسيصبح البوت جاهزاً.</p>
                    </div>
                </body>
                </html>
            `;
            res.send(htmlResponse);
        });
    }

    // تشغيل خادم الويب
    app.listen(PORT, () => {
        console.log(`خادم الويب يعمل على المنفذ: ${PORT}`);
    });

    // ----------------------------------------------------
    // *** منطق البوت (الحفظ، إعادة الاتصال، الأوامر) ***
    // ----------------------------------------------------

    // حفظ بيانات الاعتماد
    sock.ev.on('creds.update', saveCreds);

    // متابعة حالة الاتصال
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== 401;
            console.log('فصل الاتصال. هل يجب إعادة الاتصال؟', shouldReconnect);
            if (shouldReconnect) {
                startBot(); // محاولة إعادة الاتصال
            } else {
                 console.log('تم فصل الاتصال بشكل دائم (تسجيل خروج). يرجى البدء من جديد.');
            }
        } else if (connection === 'open') {
            console.log('تم فتح الاتصال بنجاح. البوت جاهز للعمل!');
        }
    });

    // === ضع منطق الأوامر ومكافحة الحذف هنا (كما شرحنا سابقاً) ===
    // (messages.upsert) و (messages.delete)
    // ========================================================
}

startBot();
