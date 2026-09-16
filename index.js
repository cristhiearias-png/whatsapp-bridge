const express = require("express");
const qrcode = require("qrcode");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");

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
    const connection = update.connection;
    const lastDisconnect = update.lastDisconnect;
    const qr = update.qr;

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
      const statusCode = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode
        : null;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log("Connection closed. Reconnecting:", shouldReconnect);
      if (shouldReconnect) {
        startSock();
      }
    }
  });
}

startSock();

app.get("/qr", async (req, res) => {
  if (connected) {
    res.send("<h2>Already connected to WhatsApp.</h2>");
    return;
  }
  if (!latestQR) {
    res.send("<h2>Waiting for QR code... refresh in a few seconds.</h2>");
    return;
  }
  const qrImage = await qrcode.toDataURL(latestQR);
  res.send("<h2>Scan this with WhatsApp (Linked Devices):</h2><img src='" + qrImage + "' />");
});

app.get("/health", (req, res) => {
  res.json({ connected: connected });
});

app.post("/send", async (req, res) => {
  const key = req.headers["x-api-key"];
  if (key !== SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  if (!connected) {
    res.status(503).json({ error: "whatsapp not connected yet" });
    return;
  }

  const to = req.body.to;
  const message = req.body.message;
  if (!to || !message) {
    res.status(400).json({ error: "to and message are required" });
    return;
  }

  try {
    const jid = to.indexOf("@") >= 0 ? to : to + "@s.whatsapp.net";
    await sock.sendMessage(jid, { text: message });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "failed to send" });
  }
});

app.listen(PORT, function () {
  console.log("Bridge server running on port " + PORT);
});
