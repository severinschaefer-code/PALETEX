/**
 * PAVECON Paletten-Freistellungsportal
 * Backend-API (Express + SQLite3 + Nodemailer)
 * Entwickelt für Deployment auf Render.com / VPS / lokaler Server
 */

import express from "express";
import nodemailer from "nodemailer";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// --- CORS (erlaubte Domains) ---
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

// --- SQLite initialisieren ---
let db;
async function initDb() {
  db = await open({
    filename: "./paletten.db",
    driver: sqlite3.Database,
  });

  await db.exec(`CREATE TABLE IF NOT EXISTS anfragen (
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
await initDb();

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
  res.json({ ok: true, time: new Date().toISOString() });
});

// --- Anfrage speichern + Mail senden ---
app.post("/api/anfrage", async (req, res) => {
  try {
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

    // Validierung
    const required = {
      kunde,
      standort,
      plz,
      lieferant,
      lieferantenstandort,
      anzahl_gebrauchsfähig,
      anzahl_defekt,
      preis_gebrauchsfähig,
    };
    for (const [k, v] of Object.entries(required)) {
      if (v === undefined || v === null || v === "") {
        return res
          .status(400)
          .json({ success: false, message: `Feld "${k}" fehlt.` });
      }
    }
    if (!/^\d{5}$/.test(String(plz))) {
      return res
        .status(400)
        .json({ success: false, message: "PLZ muss 5-stellig sein." });
    }

    // In DB speichern
    const stmt = await db.run(
      `INSERT INTO anfragen 
        (kunde, standort, plz, lieferant, lieferantenstandort, 
         anzahl_gebrauchsf, anzahl_defekt, preis_gebrauchsf, nachricht, erstellt_am)
       VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))`,
      [
        String(kunde),
        String(standort),
        String(plz),
        String(lieferant),
        String(lieferantenstandort),
        parseInt(anzahl_gebrauchsfähig, 10),
        parseInt(anzahl_defekt, 10),
        parseFloat(preis_gebrauchsfähig),
        nachricht ? String(nachricht) : null,
      ]
    );

    // Mail-Inhalt
    const mailText = `Neue Anfrage zur Palettenschuld-Freistellung

Kunde: ${kunde}
Standort: ${standort}, ${plz}
Lieferant: ${lieferant} (${lieferantenstandort})

Mengen:
- gebrauchsfähig: ${anzahl_gebrauchsfähig}
- defekt: ${anzahl_defekt}

Preis pro gebrauchsfähiger Palette: ${preis_gebrauchsfähig} €
Nachricht: ${nachricht || "-"}

Anfragen-ID: ${stmt.lastID}
Zeitpunkt: ${new Date().toLocaleString("de-DE")}
`;

    await transporter.sendMail({
      from: `"PAVECON Freistellung" <${process.env.SMTP_USER}>`,
      to: recipients(),
      subject: `Neue Paletten-Freistellungsanfrage (#${stmt.lastID}) von ${kunde}`,
      text: mailText,
    });

    res.json({
      success: true,
      id: stmt.lastID,
      message: "Anfrage gespeichert und E-Mail versendet.",
    });
  } catch (err) {
    console.error("Fehler bei Anfrage:", err);
    res.status(500).json({ success: false, message: "Interner Fehler." });
  }
});

// --- Admin-Endpunkt (Testzwecke, später absichern) ---
app.get("/api/anfragen", async (req, res) => {
  const rows = await db.all(
    "SELECT * FROM anfragen ORDER BY id DESC LIMIT 200"
  );
  res.json(rows);
});

// --- Start ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () =>
  console.log(`✅ Server läuft auf Port ${PORT} (${new Date().toLocaleString()})`)
);
