/**
 * PAVECON Paletten-Freistellungsportal – stabile Version
 * Backend: Express + SQLite3 + Nodemailer
 * Kompatibel mit Render.com, Node 18–22
 */

import express from "express";
import nodemailer from "nodemailer";
import sqlite3 from "sqlite3";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// --- CORS ---
const allowed = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim());
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.includes("*") || allowed.includes(origin))
        return cb(null, true);
      return cb(new Error("Not allowed by CORS: " + origin));
    },
  })
);

// --- SQLite Initialisierung (CommonJS-kompatibel) ---
const db = new sqlite3.Database("./paletten.db", (err) => {
  if (err) {
    console.error("❌ Fehler beim Öffnen der SQLite-Datenbank:", err.message);
  } else {
    console.log("✅ SQLite-Datenbank erfolgreich geöffnet.");
    db.run(`CREATE TABLE IF NOT EXISTS anfragen (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde TEXT,
      standort TEXT,
      plz TEXT,
      lieferant TEXT,
      lieferantenstandort TEXT,
      anzahl_gebrauchsf INTEGER,
      anzahl_defekt INTEGER,
      preis_gebrauchsf REAL,
      nachricht TEXT,
      erstellt_am TEXT
    )`);
  }
});

// --- Mailkonfiguration ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "465", 10),
  secure: (process.env.SMTP_SECURE || "true") === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function recipients() {
  const list = (process.env.MAIL_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : [process.env.SMTP_USER];
}

// --- Healthcheck ---
app.get("/api/health", (req, res) => {
  res.json({ ok: true, serverTime: new Date().toISOString() });
});

// --- Anfrage speichern + Mailversand ---
app.post("/api/anfrage", (req, res) => {
  const {
    kunde,
    standort,
    plz,
    lieferant,
    lieferantenstandort,
    anzahl_gebrauchsfähig,
    anzahl_defekt,
    preis_gebrauchsfähig,
    nachricht,
  } = req.body || {};

  if (!kunde || !standort || !plz || !lieferant || !lieferantenstandort) {
    return res
      .status(400)
      .json({ success: false, message: "Pflichtfelder fehlen." });
  }

  const stmt = db.prepare(
    `INSERT INTO anfragen 
     (kunde, standort, plz, lieferant, lieferantenstandort, 
      anzahl_gebrauchsf, anzahl_defekt, preis_gebrauchsf, nachricht, erstellt_am)
     VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`
  );

  stmt.run(
    kunde,
    standort,
    plz,
    lieferant,
    lieferantenstandort,
    parseInt(anzahl_gebrauchsfähig || 0, 10),
    parseInt(anzahl_defekt || 0, 10),
    parseFloat(preis_gebrauchsfähig || 0),
    nachricht || "",
    function (err) {
      if (err) {
        console.error("❌ DB-Fehler:", err.message);
        return res.status(500).json({ success: false, message: "DB-Fehler." });
      }

      const id = this.lastID;
      const mailText = `Neue Paletten-Freistellungsanfrage

Kunde: ${kunde}
Standort: ${standort}, ${plz}
Lieferant: ${lieferant} (${lieferantenstandort})

Mengen:
- gebrauchsfähig: ${anzahl_gebrauchsfähig}
- defekt: ${anzahl_defekt}

Preis pro gebrauchsfähiger Palette: ${preis_gebrauchsfähig} €
Nachricht: ${nachricht || "-"}

Anfragen-ID: ${id}
Gesendet am: ${new Date().toLocaleString("de-DE")}
`;

      transporter.sendMail(
        {
          from: `"PAVECON Freistellung" <${process.env.SMTP_USER}>`,
          to: recipients(),
          subject: `Neue Paletten-Freistellungsanfrage (#${id}) von ${kunde}`,
          text: mailText,
        },
        (mailErr) => {
          if (mailErr) console.error("Mail-Fehler:", mailErr.message);
          else console.log(`📩 Mail gesendet (#${id})`);
        }
      );

      res.json({
        success: true,
        id,
        message: "Anfrage gespeichert und E-Mail versendet.",
      });
    }
  );

  stmt.finalize();
});

// --- Admin-Endpunkt (Testzwecke) ---
app.get("/api/anfragen", (req, res) => {
  db.all("SELECT * FROM anfragen ORDER BY id DESC LIMIT 200", (err, rows) => {
    if (err) {
      console.error("DB-Fehler:", err.message);
      res.status(500).json({ success: false });
    } else {
      res.json(rows);
    }
  });
});

// --- Start ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`🚀 Server läuft auf Port ${PORT}`));
