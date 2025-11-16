const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const gTTS = require("gtts");
const multer = require("multer");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const QRCode = require("qrcode");

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());

const WebSocket = require("ws");
const { spawn } = require("child_process");

const LIVE_DIR = path.join(__dirname, "radio_live");
if (!fs.existsSync(LIVE_DIR)) fs.mkdirSync(LIVE_DIR);

let ffmpegLive = null;
let liveActive = false;

// WebSocket сервер для live-аудио
const wss = new WebSocket.Server({ noServer: true });





app.server = app.listen(4000, () => {
    console.log("Radiopoet server running on http://localhost:4000");
});

// Перехватываем upgrade для WebSocket
app.server.on("upgrade", (req, socket, head) => {
    if (req.url === "/live") {
        wss.handleUpgrade(req, socket, head, ws => {
            wss.emit("connection", ws, req);
        });
    }
});

// Когда админ подключается к /live
wss.on("connection", (ws) => {
    console.log("LIVE: WebSocket connected");

    // Стартуем FFmpeg-процесс для генерации HLS
    ffmpegLive = spawn("ffmpeg", [
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "1",
        "-i", "pipe:0",
        "-c:a", "aac",
        "-b:a", "128k",
        "-f", "hls",
        "-hls_time", "1",
        "-hls_list_size", "5",
        "-hls_flags", "delete_segments",
        path.join(LIVE_DIR, "stream.m3u8")
    ]);

    liveActive = true;

    ffmpegLive.stderr.on("data", d =>
        console.log("FFmpeg LIVE:", d.toString())
    );

    ws.on("message", (msg) => {
        if (ffmpegLive && ffmpegLive.stdin.writable) {
            ffmpegLive.stdin.write(msg);
        }
    });

    ws.on("close", () => {
        console.log("LIVE: WebSocket closed");

        liveActive = false;
        if (ffmpegLive) {
            try { ffmpegLive.stdin.end(); } catch {}
            ffmpegLive.kill("SIGKILL");
            ffmpegLive = null;
        }
    });
});



// ------------------------------
//        ПАПКИ ПРОЕКТА
// ------------------------------
const AUDIO_DIR = path.join(__dirname, "audio");
const PUBLIC_DIR = path.join(__dirname, "public");
const PLAYLIST_DIR = path.join(__dirname, "playlist");
const PLAYLIST_JSON = path.join(__dirname, "playlist.json");

if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR);
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR);
if (!fs.existsSync(PLAYLIST_DIR)) fs.mkdirSync(PLAYLIST_DIR);

if (!fs.existsSync(PLAYLIST_JSON)) {
    fs.writeFileSync(PLAYLIST_JSON, JSON.stringify({ order: [] }, null, 2));
}

// ------------------------------
//     QR & COOKIE AUTH CONFIG
// ------------------------------
const QR_SECRET = process.env.QR_SECRET || "MY_SUPER_SECRET_CODE_2025";
const QR_EXPIRES_SECONDS = 300; // 5 минут
const DOMAIN = "https://radiopoet.ru"; // твой домен


// Мидлварь защиты
function requireAdmin(req, res, next) {
    const token = req.cookies.admin_session;
    if (!token) return res.status(403).send("Access denied");
    next();
}


// ------------------------------
//       АВТОРИЗАЦИЯ ЧЕРЕЗ QR
// ------------------------------
app.get("/auth", (req, res) => {
    try {
        const base = req.query.data;
        if (!base) return res.status(400).send("Bad request");

        const decoded = JSON.parse(Buffer.from(base, "base64").toString("utf8"));

        const { uid, ts, exp, sign } = decoded;

        if (!uid || !ts || !exp || !sign) {
            return res.status(400).send("Invalid token");
        }

        // 1) проверяем срок жизни QR
        if (Date.now() > exp) {
            return res.status(401).send("QR expired");
        }

        // 2) проверяем подпись токена
        const checkSign = crypto.createHmac("sha256", QR_SECRET)
            .update(JSON.stringify({ uid, ts, exp }))
            .digest("hex");

        if (checkSign !== sign) {
            return res.status(403).send("Invalid signature");
        }

        // 3) создаём сессию
        res.cookie("admin_session", sign, {
            httpOnly: true,
            secure: true,      // работает только в HTTPS!
            sameSite: "strict",
            maxAge: 1000 * 60 * 60 * 24 // 24 часа
        });

        res.redirect("/playlist.html");

    } catch (err) {
        res.status(400).send("Bad token");
    }
});


// ------------------------------
//     ГЕНЕРАЦИЯ НОВЫХ QR (для уже авторизованных)
// ------------------------------
app.get("/admin/qr", async (req, res) => {
    const payload = {
        uid: "admin",
        ts: Date.now(),
        exp: Date.now() + QR_EXPIRES_SECONDS * 1000
    };

    // подпись токена
    const sign = crypto.createHmac("sha256", QR_SECRET)
        .update(JSON.stringify(payload))
        .digest("hex");

    const tokenObject = { ...payload, sign };
    const base = Buffer.from(JSON.stringify(tokenObject)).toString("base64");

    // ссылка, которую откроет ТЕЛЕФОН
    const url = `${DOMAIN}/auth?data=${base}`;

    const qr = await QRCode.toDataURL(url);

    res.send(`
        <h1>Admin QR Login</h1>
        <p>Отсканируй телефоном для входа</p>
        <img src="${qr}" style="width:300px">
        <p>QR действует 5 минут</p>
    `);
});


// ------------------------------
//      PLAYLIST FUNCTIONS
// ------------------------------
function loadPlaylistOrder() {
    return JSON.parse(fs.readFileSync(PLAYLIST_JSON, "utf8")).order;
}

function savePlaylistOrder(order) {
    fs.writeFileSync(PLAYLIST_JSON, JSON.stringify({ order }, null, 2));
}

// ------------------------------
//            STATIC
// ------------------------------
app.use("/audio", express.static(AUDIO_DIR));
app.use("/playlist", express.static(PLAYLIST_DIR));
app.use("/", express.static(PUBLIC_DIR));

// ------------------------------
//         PLAYLIST API
// ------------------------------
app.get("/playlist/list", requireAdmin, (req, res) => {
    const order = loadPlaylistOrder();
    const files = fs.readdirSync(PLAYLIST_DIR).filter(f => f.endsWith(".mp3"));
    const filtered = order.filter(f => files.includes(f));
    if (filtered.length !== order.length) savePlaylistOrder(filtered);
    res.json(filtered.map(name => ({ name, url: "/playlist/" + name })));
});

const upload = multer({
    storage: multer.diskStorage({
        destination: PLAYLIST_DIR,
        filename: (req, f, cb) => cb(null, Date.now() + "_" + f.originalname)
    })
});

app.post("/playlist/upload", requireAdmin, upload.single("file"), (req, res) => {
    const order = loadPlaylistOrder();
    order.push(req.file.filename);
    savePlaylistOrder(order);
    res.json({ status: "ok" });
});


// MOVE UP
app.post("/playlist/move-up", requireAdmin, (req, res) => {
    const { filename } = req.body;
    let order = loadPlaylistOrder();
    const i = order.indexOf(filename);
    if (i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
    savePlaylistOrder(order);
    res.json({ status: "ok" });
});

// MOVE DOWN
app.post("/playlist/move-down", requireAdmin, (req, res) => {
    const { filename } = req.body;
    let order = loadPlaylistOrder();
    const i = order.indexOf(filename);
    if (i >= 0 && i < order.length - 1)
        [order[i + 1], order[i]] = [order[i], order[i + 1]];
    savePlaylistOrder(order);
    res.json({ status: "ok" });
});

// DELETE
app.post("/playlist/delete", requireAdmin, (req, res) => {
    const { filename } = req.body;
    let order = loadPlaylistOrder().filter(f => f !== filename);
    savePlaylistOrder(order);
    const fp = path.join(PLAYLIST_DIR, filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ status: "deleted" });
});

// ------------------------------
//        TEXT → MP3
// ------------------------------
app.post("/render", requireAdmin, (req, res) => {
    const text = req.body.text;
    if (!text) return res.status(400).json({ error: "no text" });

    const file = `poem_${Date.now()}.mp3`;
    const fp = path.join(AUDIO_DIR, file);

    const tts = new gTTS(text, "ru");
    tts.save(fp, e => {
        if (e) return res.status(500).json({ error: e.toString() });
        res.json({ status: "ok", file, url: "/audio/" + file });
    });
});

// ------------------------------
