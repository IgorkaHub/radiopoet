// generate-first-qr.js
// -------------------------------------------
// Генерация ПЕРВОГО QR для первого входа
// Работает полностью оффлайн
// -------------------------------------------

const Crypto = require("crypto");
const QRCode = require("qrcode");
const fs = require("fs");

const QR_SECRET = "ВАШ_СЕКРЕТ_КЛЮЧ";  // вставь сюда тот самый секретный ключ
const TS = Date.now();

// payload
const payload = {
    uid: "admin",
    ts: TS,
};

// подпись
const sign = Crypto.createHmac("sha256", QR_SECRET)
    .update(JSON.stringify(payload))
    .digest("hex");

// полный объект
const full = { ...payload, sign };

// кодируем в base64
const base = Buffer.from(JSON.stringify(full)).toString("base64");

// URL
const url = `http://localhost:4000/auth?data=${base}`;

// генерируем QR
QRCode.toFile("first-login-qr.png", url, {
    width: 500
}, (err) => {
    if (err) throw err;
    console.log("QR-Сгенерирован → first-login-qr.png");
    console.log("Отсканируй его ТЕЛЕФОНОМ!");
});
