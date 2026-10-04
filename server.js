require("dotenv").config();

const express = require("express");
const path = require("path");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const PDFDocument = require("pdfkit");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "change-me";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

const dataDir = path.join(__dirname, "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "ali-assistente.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nova conversa',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  image_data TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

function sign(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "AUTH_REQUIRED" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "INVALID_SESSION" });
  }
}

function cleanText(v, max = 20000) {
  return String(v ?? "").trim().slice(0, max);
}

app.post("/api/auth/register", async (req, res) => {
  const name = cleanText(req.body.name, 80);
  const email = cleanText(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || "");

  if (!name || !email || password.length < 6)
    return res.status(400).json({ error: "Dados inválidos. Use nome, e-mail e senha com pelo menos 6 caracteres." });

  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return res.status(409).json({ error: "Este e-mail já está registado." });

  const hash = await bcrypt.hash(password, 12);
  const result = db.prepare("INSERT INTO users (email,password_hash,name) VALUES (?,?,?)").run(email, hash, name);
  const user = { id: result.lastInsertRowid, email, name };

  res.json({ token: sign(user), user });
});

app.post("/api/auth/login", async (req, res) => {
  const email = cleanText(req.body.email, 180).toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: "E-mail ou senha incorretos." });

  res.json({
    token: sign(user),
    user: { id: user.id, email: user.email, name: user.name }
  });
});

app.get("/api/me", auth, (req, res) => {
  const user = db.prepare("SELECT id,email,name,created_at FROM users WHERE id=?").get(req.user.id);
  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
  res.json({ user });
});

app.get("/api/chats", auth, (req, res) => {
  const chats = db.prepare(`
    SELECT id,title,created_at,updated_at
    FROM chats WHERE user_id=? ORDER BY updated_at DESC
  `).all(req.user.id);
  res.json({ chats });
});

app.post("/api/chats", auth, (req, res) => {
  const title = cleanText(req.body.title, 120) || "Nova conversa";
  const result = db.prepare("INSERT INTO chats (user_id,title) VALUES (?,?)").run(req.user.id, title);
  res.json({ id: result.lastInsertRowid, title });
});

app.get("/api/chats/:id", auth, (req, res) => {
  const chat = db.prepare("SELECT * FROM chats WHERE id=? AND user_id=?").get(req.params.id, req.user.id);
  if (!chat) return res.status(404).json({ error: "CHAT_NOT_FOUND" });

  const messages = db.prepare(`
    SELECT id,role,content,image_data,created_at
    FROM messages WHERE chat_id=? ORDER BY id ASC
  `).all(chat.id);

  res.json({ chat, messages });
});

app.delete("/api/chats/:id", auth, (req, res) => {
  const result = db.prepare("DELETE FROM chats WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: "CHAT_NOT_FOUND" });
  res.json({ ok: true });
});

app.get("/api/memories", auth, (req, res) => {
  res.json({ memories: db.prepare("SELECT id,content,created_at FROM memories WHERE user_id=? ORDER BY id DESC").all(req.user.id) });
});

app.post("/api/memories", auth, (req, res) => {
  const content = cleanText(req.body.content, 1000);
  if (!content) return res.status(400).json({ error: "MEMORY_EMPTY" });
  const result = db.prepare("INSERT INTO memories (user_id,content) VALUES (?,?)").run(req.user.id, content);
  res.json({ id: result.lastInsertRowid, content });
});

app.delete("/api/memories/:id", auth, (req, res) => {
  db.prepare("DELETE FROM memories WHERE id=? AND user_id=?").run(req.params.id, req.user.id);
  res.json({ ok: true });
});

function buildSystem(memories) {
  return `Você é o Ali Assistente, um assistente de inteligência artificial multiplataforma.
Responda na língua do usuário. Em português, use português claro de Portugal/África.
Se o usuário perguntar quem criou você, responda que o criador oficial é Ali Momade Rajabo.
Não invente capacidades que não estejam disponíveis.
Memórias autorizadas do usuário:
${memories.map(m => "- " + m.content).join("\n") || "(nenhuma)"}`;
}

app.post("/api/chat", auth, async (req, res) => {
  const chatId = Number(req.body.chatId);
  const content = cleanText(req.body.content, 12000);
  const image = req.body.image ? String(req.body.image) : null;

  const chat = db.prepare("SELECT * FROM chats WHERE id=? AND user_id=?").get(chatId, req.user.id);
  if (!chat) return res.status(404).json({ error: "CHAT_NOT_FOUND" });
  if (!content && !image) return res.status(400).json({ error: "EMPTY_MESSAGE" });
  if (!ANTHROPIC_API_KEY) return res.status(503).json({ error: "AI_NOT_CONFIGURED", message: "Configure ANTHROPIC_API_KEY no servidor." });

  const history = db.prepare(`
    SELECT role,content,image_data FROM messages
    WHERE chat_id=? ORDER BY id DESC LIMIT 20
  `).all(chatId).reverse();

  const memories = db.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY id DESC LIMIT 30").all(req.user.id);

  const messages = history.map(m => {
    if (m.image_data) {
      return {
        role: m.role,
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: m.image_data.split(",").pop() } },
          ...(m.content ? [{ type: "text", text: m.content }] : [])
        ]
      };
    }
    return { role: m.role, content: m.content };
  });

  if (content || image) {
    const current = image ? {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.split(",").pop() } },
        ...(content ? [{ type: "text", text: content }] : [])
      ]
    } : { role: "user", content };
    messages.push(current);
  }

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1500,
        system: buildSystem(memories),
        messages
      })
    });

    const data = await r.json();
    if (!r.ok) {
      const code = r.status === 429 ? "RATE_LIMIT" : (r.status === 401 || r.status === 403 ? "AUTH_ERROR" : "AI_ERROR");
      return res.status(r.status).json({ error: code, detail: data?.error?.message || "Erro da IA." });
    }

    const answer = (data.content || []).filter(x => x.type === "text").map(x => x.text).join("\n").trim();
    db.prepare("INSERT INTO messages (chat_id,role,content,image_data) VALUES (?,?,?,?)").run(chatId, "user", content, image);
    db.prepare("INSERT INTO messages (chat_id,role,content) VALUES (?,?,?)").run(chatId, "assistant", answer);
    db.prepare("UPDATE chats SET updated_at=CURRENT_TIMESTAMP WHERE id=?").run(chatId);

    res.json({ text: answer });
  } catch (err) {
    res.status(500).json({ error: "SERVER_ERROR", detail: err.message });
  }
});

app.post("/api/pdf", auth, (req, res) => {
  const title = cleanText(req.body.title, 200) || "Documento";
  const content = cleanText(req.body.content, 50000);
  if (!content) return res.status(400).json({ error: "PDF_EMPTY" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="ali-assistente.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);
  doc.fontSize(20).text(title, { align: "center" });
  doc.moveDown();
  doc.fontSize(11).text(content, { align: "left", lineGap: 5 });
  doc.end();
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Ali Assistente V1 em http://localhost:${PORT}`);
});
