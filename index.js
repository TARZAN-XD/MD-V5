// index.js

const {
    makeWASocket,
    useMultiFileAuthState,
    getContentType,
    WAMessageStubType
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');

// === الإعدادات ===
// ** هام جداً: غيّر هذا الرقم إلى رقمك مع رمز الدولة بدون (+) **
const ownerNumber = '66826186068'; 
const PORT = process.env.PORT || 3000;
const prefix = '!'; // بادئة الأوامر
const app = express();
const logger = pino({ level: 'silent' });

// متجر لتخزين الرسائل مؤقتًا (لمكافحة الحذف)
const messagesStore = new Map();
// متجر لتخزين الحالات مؤقتًا (لمنع حذف الحالات)
const statusStore = new Map(); 

// ==================

async function startBot() {
    // 1. إعداد المصادقة
    const { state, saveCreds } = await useMultiFileAuthState('session');

    // 2. إنشاء اتصال واتساب
    const sock = makeWASocket({
        logger,
        printQRInTerminal: false,
        browser: ['My Custom Anti-Delete Bot', 'Chrome', '1.0.0'],
        auth: {
            creds: state.creds,
            // تم تصحيح الخطأ هنا بتمرير المفاتيح مباشرة
            keys: state.keys, 
        },
        shouldUsePairingCode: true
    });

    // ----------------------------------------------------
    // *** منطق الويب لطلب رمز الاقتران (يعمل مرة واحدة) ***
    // ----------------------------------------------------
    
    // يتم تنفيذ هذا فقط إذا لم يكن البوت مسجلاً بعد
    if (!sock.authState.creds.registered) {
        let pairingCode = 'جاري التوليد...';
        try {
            // طلب رمز الاقتران من Baileys
            pairingCode = await sock.requestPairingCode(ownerNumber);
            console.log(`تم توليد رمز الاقتران: ${pairingCode}`);
        } catch (error) {
            console.error('خطأ في توليد رمز الاقتران:', error);
            pairingCode = 'فشل التوليد. تحقق من إعداداتك.';
        }

        // إنشاء صفحة HTML لعرض الرمز
        app.get('/', (req, res) => {
            const htmlResponse = `
                <!DOCTYPE html><html lang="ar">
                <head><meta charset="UTF-8"><title>رمز اقتران البوت</title>
                <style>
                    body { font-family: Tahoma, Arial, sans-serif; text-align: center; padding-top: 50px; background-color: #f4f4f4; direction: rtl; }
                    .container { background-color: #ffffff; padding: 25px; border-radius: 12px; box-shadow: 0 6px 12px rgba(0,0,0,0.15); display: inline-block; max-width: 90%; }
                    .code { font-size: 2.5em; color: #25D366; border: 3px solid #25D366; padding: 15px 30px; border-radius: 8px; margin: 30px 0; display: inline-block; font-weight: bold; letter-spacing: 5px; }
                </style>
                </head>
                <body>
                    <div class="container">
                        <h1>✅ بوتك جاهز!</h1>
                        <p>لاستكمال ربط البوت، استخدم رمز الاقتران التالي في واتساب:</p>
                        <div class="code">${pairingCode}</div>
                        <p>خطوات الربط: *الإعدادات* > *الأجهزة المرتبطة* > *ربط جهاز* > *ربط باستخدام رقم الهاتف بدلاً من ذلك*.</p>
                        <p style="color: red;">⚠️ بعد الاستخدام، قد يحتاج البوت لعدة ثواني للبدء وسيتم إزالة هذه الصفحة.</p>
                    </div>
                </body></html>
            `;
            res.send(htmlResponse);
        });
    } else {
        // إذا كان البوت مسجلاً بالفعل، اعرض صفحة تفيد بأنه قيد التشغيل
        app.get('/', (req, res) => {
            res.send('<h1>🤖 البوت يعمل بالفعل!</h1><p>تم الربط بنجاح والبوت قيد التشغيل.</p>');
        });
    }

    // تشغيل خادم الويب
    app.listen(PORT, () => {
        console.log(`خادم الويب يعمل على المنفذ: ${PORT}`);
    });

    // ----------------------------------------------------
    // *** منطق البوت (الحفظ، إعادة الاتصال) ***
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
            }
        } else if (connection === 'open') {
            console.log('تم فتح الاتصال بنجاح. البوت جاهز للعمل!');
        }
    });

    // ----------------------------------------------------
    // *** ميزة: مكافحة الحذف (Anti-Delete) ***
    // ----------------------------------------------------

    // 1. تخزين الرسائل الواردة
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        const jid = msg.key.remoteJid;
        
        if (jid === 'status@broadcast') {
            // تخزين الحالات (Anti-Status Delete)
            if (!msg.key.fromMe) {
                statusStore.set(msg.key.id, msg);
                // يمكننا جعل البوت يرسل تنبيه لك لاحقًا
            }
            return;
        }

        // تخزين أي رسالة عادية في المتجر قبل حذفها
        messagesStore.set(msg.key.id, msg);

        // *** منطق الأوامر المتعددة (الخطوة التالية) ***
        await handleCommands(sock, msg);
    });

    // 2. اعتراض حدث الحذف
    sock.ev.on('messages.delete', async (item) => {
        if (!item.messages || item.messages.length === 0) return;

        for (const message of item.messages) {
            const deletedMsg = messagesStore.get(message.key.id);
            if (deletedMsg && !deletedMsg.key.fromMe) { // تأكد أنه ليس البوت هو من حذف الرسالة

                // استخراج محتوى الرسالة المحذوفة
                const type = getContentType(deletedMsg.message);
                let content = 'غير محدد (ربما وسائط)';

                if (type === 'conversation' || type === 'extendedTextMessage') {
                    content = deletedMsg.message.conversation || deletedMsg.message.extendedTextMessage.text;
                } else if (type === 'imageMessage') {
                    content = 'صورة';
                } else if (type === 'videoMessage') {
                    content = 'فيديو';
                }
                
                const sender = deletedMsg.key.participant || deletedMsg.key.remoteJid;

                const text = `
                    🚨 *رسالة تم حذفها!* 🚨
                    
                    *من:* ${sender.split('@')[0]}
                    *الدردشة:* ${deletedMsg.key.remoteJid}
                    
                    *المحتوى المحذوف:* \`\`\`${content}\`\`\`
                `;

                // إعادة إرسال تنبيه بالرسالة المحذوفة
                await sock.sendMessage(deletedMsg.key.remoteJid, { text });
            }
            messagesStore.delete(message.key.id);
        }
    });
}

// دالة منفصلة لمعالجة الأوامر (للتنظيم)
async function handleCommands(sock, msg) {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    if (!text.startsWith(prefix)) return;

    const fullCommand = text.slice(prefix.length).trim();
    const command = fullCommand.split(/\s+/)[0].toLowerCase();
    const args = fullCommand.split(/\s+/).slice(1);
    const jid = msg.key.remoteJid;

    switch (command) {
        case 'مرحبا':
            await sock.sendMessage(jid, { text: 'أهلاً بك! أنا بوتك الخاص وأعمل بنجاح. كيف أخدمك؟' });
            break;
        
        case 'الأوامر':
            const commandsList = `
                📝 *قائمة الأوامر المتاحة*
                
                *وظائف عامة:*
                ${prefix}مرحبا - للترحيب.
                ${prefix}حالات_محذوفة - لعرض آخر الحالات التي تم تخزينها (قيد التطوير).
                
                *وظائف متقدمة:*
                (يمكننا إضافة صنع الملصقات، معلومات، إلخ لاحقًا)
                
                _ميزة مكافحة الحذف تعمل تلقائيًا!_
            `;
            await sock.sendMessage(jid, { text: commandsList });
            break;

        case 'حالات_محذوفة':
            if (statusStore.size === 0) {
                 await sock.sendMessage(jid, { text: 'لا توجد حالات جديدة تم تخزينها بعد.' });
                 return;
            }
            // منطق عرض الحالات: يمكنك هنا تصفح الـ statusStore وإرسال الحالات إلى المالك
            await sock.sendMessage(jid, { text: `تم تخزين ${statusStore.size} حالة. هذه الميزة قيد التطوير لإرسال الوسائط.` });
            break;
            
        default:
            await sock.sendMessage(jid, { text: `عفواً، لا أفهم الأمر: ${prefix}${command}.` });
            break;
    }
}

startBot().catch(err => {
    console.error('خطأ فادح في تشغيل البوت:', err);
});
