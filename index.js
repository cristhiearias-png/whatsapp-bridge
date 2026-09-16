const express = require("express");
const qrcode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom") || {};

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SECRET = process.env.BRIDGE_SECRET || "changeme";
const AUTH_FOLDER = process.env.AUTH_FOLDER || "./auth";

let sock;
let latestQR = null;
let connected = false;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
    }

    if (connection === "open") {
      connected = true;
      latestQR = null;
      console.log("WhatsApp connected!");
    }

    if (connection === "close") {
      connected = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed. Reconnecting:", shouldReconnect);
      if (shouldReconnect) {
        startSock();
      }
    }
  });
}

startSock();

// Visit this page in your browser to scan the QR code and log in
app.get("/qr", async (req, res) => {
  if (connected) {
    return res.send("<h2>Already connected to WhatsApp.</h2>");
  }
  if (!latestQR) {
    return res.send("<h2>Waiting for QR code... refresh in a few seconds.</h2>");
  }
  const qrImage = await qrcode.toDataURL(latestQR);
  res.send(`<h2>Scan this with WhatsApp (Linked Devices):</h2><img src="${qrImage}" />`);
});

app.get("/health", (req, res) => {
  res.json({ connected });
});

// Send a message: POST /send { "to": "50688888888", "message": "hello" }
app.post("/send", async (req, res) => {
  const key = req.headers["x-api-key"];
  if (key !== SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  if (!connected) {
    return res.status(503).json({ error: "whatsapp not connected yet" });
  }

  const { to, message } = req.body;
  if (!to || !message) {
    return res.status(400).json({ error: "to and message are required" });
  }

  try {
    const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
    await sock.sendMessage(jid, { text: message });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to
