// server.js

// --- Impor modul yang diperlukan ---
const http = require('http');
const https = require('https'); // Modul HTTPS bawaan
const path = require('path');
const { Server } = require("socket.io");

const express = require('express');
const bodyParser = require('body-parser');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const piBot = require('./run.js');

// --- KONFIGURASI PENTING ---
const TELEGRAM_TOKEN = '8072498870:AAF36SvRq1pT3GJWCgaJO-ENvAupfCNWRho';
const WEBHOOK_URL = 'https://server5.zendshost.id';
const PORT = process.env.PORT || 2003;
// ----------------------------


const CONFIG_FILE = './config.json';
let config = loadConfig();
let adminChatId = null;
let userState = {};

// Inisialisasi Bot Telegram & Server Express
const bot = new TelegramBot(TELEGRAM_TOKEN);
const app = express();

// --- Rate Limiting Telegram ---
let notificationQueue = [];
let isProcessingQueue = false;
const TELEGRAM_DELAY_MS = 2000;

// --- Integrasi Socket.IO dengan Express ---
const server = http.createServer(app); 
const io = new Server(server);         

// --- Override console.log untuk streaming ke browser ---
const originalLog = console.log;
console.log = function(...args) {
    originalLog.apply(console, args);

    const logMessage = args.map(arg => {
        if (typeof arg === 'object' && arg !== null) {
            try {
                if (arg instanceof Error) {
                    return arg.stack || arg.message;
                }
                return JSON.stringify(arg, null, 2);
            } catch (e) {
                return '[Circular Object]';
            }
        }
        return String(arg);
    }).join(' ');

    io.emit('log', logMessage);
};


app.use(bodyParser.json());

// Set Webhook
const webhookPath = `/webhook/${TELEGRAM_TOKEN}`;
bot.setWebHook(`${WEBHOOK_URL}${webhookPath}`);

// Endpoint untuk menerima update dari Telegram
app.post(webhookPath, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Endpoint untuk menampilkan halaman log
app.get('/log', (req, res) => {
    res.sendFile(path.join(__dirname, 'log.html'));
});

// Handler untuk koneksi WebSocket
io.on('connection', (socket) => {
  console.log('Browser terhubung untuk melihat log.');
  socket.on('disconnect', () => {
    originalLog('Browser terputus.');
  });
});


// --- FUNGSI HELPER ---
function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE);
            return JSON.parse(data);
        }
    } catch (error) {
        console.error("Gagal memuat config:", error);
    }
    return { mnemonics: [], recipient: '', memo: 'Pi Transfer' };
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        piBot.updateConfig(config); 
    } catch (error) {
        console.error("Gagal menyimpan config:", error);
    }
}

function removeMnemonicAndUpdate(mnemonicToRemove) {
    const initialCount = config.mnemonics.length;
    const trimmedToRemove = mnemonicToRemove.trim();
    config.mnemonics = config.mnemonics.filter(m => m.trim() !== trimmedToRemove);
    
    if (config.mnemonics.length < initialCount) {
        console.log(`Mnemonic dihapus: ${trimmedToRemove.substring(0, 15)}...`);
        saveConfig(); 
        return true;
    }
    return false;
}

// Fungsi untuk memproses Queue Notifikasi Telegram via URL API
async function processNotificationQueue() {
    if (isProcessingQueue || notificationQueue.length === 0) {
        return;
    }
    isProcessingQueue = true;
    
    const { chatId, message, options } = notificationQueue.shift();

    try {
        console.log(`[Telegram] Mengirim notifikasi via API URL. Sisa queue: ${notificationQueue.length}`);
        
        // Encode komponen URL
        const encodedMessage = encodeURIComponent(message);
        const encodedParseMode = encodeURIComponent(options.parse_mode);
        
        // Buat URL API
        const apiUrl = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage?chat_id=${chatId}&text=${encodedMessage}&parse_mode=${encodedParseMode}&disable_web_page_preview=${options.disable_web_page_preview}`;

        // Kirim request menggunakan modul https
        const req = https.get(apiUrl, (res) => {
            if (res.statusCode !== 200) {
                console.error(`Gagal mengirim notifikasi Telegram, status code: ${res.statusCode}`);
                res.on('data', (chunk) => console.error(`Response body: ${chunk}`));
            }
        });

        req.on('error', (e) => {
            console.error("Error saat request ke API Telegram:", e.message);
        });

        req.end();
        
    } catch (error) {
        console.error("Gagal memproses notifikasi Telegram:", error.message);
    } finally {
        isProcessingQueue = false;
        if (notificationQueue.length > 0) {
            setTimeout(processNotificationQueue, TELEGRAM_DELAY_MS);
        }
    }
}


// Fungsi yang dipanggil oleh piBot untuk mengirim notifikasi
function sendAdminNotification(message) {
    if (adminChatId) {
        const options = { parse_mode: 'Markdown', disable_web_page_preview: true };
        notificationQueue.push({ chatId: adminChatId, message, options });
        if (!isProcessingQueue) {
            processNotificationQueue();
        }
    }
}

piBot.setNotifier(sendAdminNotification);
piBot.setMnemonicRemover(removeMnemonicAndUpdate);
piBot.updateConfig(config);


// --- HANDLER PERINTAH TELEGRAM (Tidak ada perubahan di sini) ---

bot.onText(/\/start|\/help/, (msg) => {
    adminChatId = msg.chat.id;
    const helpText = `
🤖 *Selamat Datang di Pileakers* 🤖
___________________________
Bot ini hanya berfungsi untuk memindahkan (sweep) seluruh saldo dari banyak wallet ke satu wallet tujuan.
___________________________
Berikut adalah perintah yang tersedia:
*/run* - Memulai proses bot.
*/stop* - Menghentikan proses bot.
*/status* - Melihat status bot saat ini.
*/log* - Dapatkan link untuk melihat log real-time di browser.
___________________________
*Pengaturan:*
*/setrecipient* <alamat_wallet> - Mengatur alamat wallet penerima.
*/setmemo* <teks_memo> - Mengatur memo untuk transaksi.
*/addmnemonics* - Menambah frasa mnemonik baru (akan dipandu).
*/clearmnemonics* - Menghapus SEMUA frasa mnemonik yang tersimpan.
*/saveconfig* - Mengunduh file konfigurasi \`config.json\`.
___________________________
*PEMBERITAHUAN:* Bot hanya akan mengirim notifikasi jika *transaksi berhasil*.
___________________________
🥷🏻 *Developer* @zendshost
___________________________
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
});

bot.onText(/\/log/, (msg) => {
    const logUrl = `${WEBHOOK_URL}/log`;
    bot.sendMessage(msg.chat.id, `Untuk melihat log secara real-time (termasuk error, hapus wallet, dan status), buka link berikut:\n\n${logUrl}`);
});

bot.onText(/\/run/, (msg) => {
    if (!config.recipient || config.mnemonics.length === 0) {
        return bot.sendMessage(msg.chat.id, "❌ Gagal memulai. Harap atur alamat penerima dan tambahkan mnemonik terlebih dahulu.");
    }
    if (piBot.startBot(config)) {
        bot.sendMessage(msg.chat.id, "✅ Bot Running.");
    } else {
        bot.sendMessage(msg.chat.id, "ℹ️ Bot sudah Running.");
    }
});

bot.onText(/\/stop/, (msg) => {
    if (piBot.stopBot()) {
        bot.sendMessage(msg.chat.id, "✅ Bot Stop.");
    } else {
        bot.sendMessage(msg.chat.id, "ℹ️ Bot Off.");
    }
});

bot.onText(/\/status/, (msg) => {
    const status = piBot.getStatus();
    const statusText = `
*--------------------*
- *Status:* ${status.isRunning ? 'Online ✅' : 'Stop ⏹️'}
- *Wallet Berikutnya:* #${status.isRunning ? status.currentIndex + 1 : 'N/A'}
- *Penerima:* \`${config.recipient || 'Belum diatur'}\`
- *Memo:* \`${config.memo || 'Belum diatur'}\`
- *Total Phrase:* ${config.mnemonics.length}
*--------------------*
    `;
    bot.sendMessage(msg.chat.id, statusText, { parse_mode: 'Markdown' });
});

bot.onText(/\/setrecipient (.+)/, (msg, match) => {
    const recipient = match[1];
    const isValidGAddress = recipient && recipient.startsWith('G') && recipient.length === 56;
    const isValidMAddress = recipient && recipient.startsWith('M') && recipient.length === 69;
    if (isValidGAddress || isValidMAddress) {
        config.recipient = recipient;
        saveConfig();
        bot.sendMessage(msg.chat.id, `✅ Alamat Wallet diatur ke: \`${recipient}\``, { parse_mode: 'Markdown' });
        if (isValidMAddress) {
            bot.sendMessage(msg.chat.id, `ℹ️ *Catatan:* Anda menggunakan alamat Muxed (M). Memo yang diatur via /setmemo akan diabaikan saat pengiriman ke alamat ini.`);
        }
    } else {
        bot.sendMessage(msg.chat.id, "❌ Alamat Wallet Tidak valid. Pastikan alamat dimulai dengan 'G' (56 karakter) atau 'M' (69 karakter).");
    }
});

bot.onText(/\/setmemo (.+)/, (msg, match) => {
    config.memo = match[1];
    saveConfig();
    bot.sendMessage(msg.chat.id, `✅ Memo diatur ke: \`${config.memo}\``, { parse_mode: 'Markdown' });
});

bot.onText(/\/addmnemonics/, (msg) => {
    userState[msg.chat.id] = 'awaiting_mnemonics';
    bot.sendMessage(msg.chat.id, "Silakan kirim daftar frasa mnemonik Anda. Pisahkan setiap frasa dengan baris baru (enter).");
});

bot.onText(/\/clearmnemonics/, (msg) => {
    config.mnemonics = [];
    saveConfig(); 
    bot.sendMessage(msg.chat.id, "🗑️ Semua frasa telah dihapus.");
});

bot.onText(/\/saveconfig/, (msg) => {
    if (fs.existsSync(CONFIG_FILE)) {
        bot.sendDocument(msg.chat.id, CONFIG_FILE, {
            caption: 'Berikut adalah file konfigurasi Anda saat ini.'
        });
    } else {
        bot.sendMessage(msg.chat.id, '❌ File `config.json` tidak ditemukan.');
    }
});

bot.on('message', (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    if (userState[msg.chat.id] === 'awaiting_mnemonics') {
        const newMnemonics = msg.text.split('\n').map(m => m.trim()).filter(m => m.length > 0);
        if (newMnemonics.length > 0) {
            const existingMnemonics = config.mnemonics.map(m => m.trim());
            const toAdd = newMnemonics.filter(m => !existingMnemonics.includes(m));
            
            config.mnemonics = [...existingMnemonics, ...toAdd];
            saveConfig();
            
            const addedCount = toAdd.length;
            bot.sendMessage(msg.chat.id, ` Tambah Lagi /addmnemonics \n✅ Berhasil menambahkan ${addedCount} frasa baru.\nTotal frasa sekarang: ${config.mnemonics.length}`);
        } else {
            bot.sendMessage(msg.chat.id, "⚠️ Tidak ada frasa valid yang terdeteksi.");
        }
        delete userState[msg.chat.id];
    }
});

// Jalankan server HTTP
server.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
    console.log(`Webhook terpasang di: ${WEBHOOK_URL}${webhookPath}`);
    console.log(`Halaman log tersedia di: ${WEBHOOK_URL}/log`);
});
