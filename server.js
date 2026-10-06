// Ali Assistente - servidor simples, sem dependências.
// Esconde a chave do Gemini e limita o uso por pessoa.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const BASE = process.env.GEMINI_BASE || 'https://generativelanguage.googleapis.com';
const PER_HOUR = parseInt(process.env.LIMIT_PER_HOUR || '40', 10);
const PER_DAY = parseInt(process.env.LIMIT_PER_DAY || '1000', 10);

// Só estes ficheiros são públicos (o server.js nunca é enviado).
const FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icon-192.png': ['icon-192.png', 'image/png'],
  '/icon-512.png': ['icon-512.png', 'image/png']
};

const hits = new Map();
let day = new Date().toISOString().slice(0, 10), dayCount = 0;
function allowed(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; dayCount = 0; }
  if (dayCount >= PER_DAY) return 'O Ali atingiu o limite de hoje. Tenta amanhã.';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (arr.length >= PER_HOUR) return 'Fizeste muitas mensagens numa hora. Espera um pouco e tenta outra vez.';
  arr.push(now); hits.set(ip, arr); dayCount++;
  return '';
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600000)) hits.delete(k); }, 600000).unref();

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, max) {
  return new Promise((ok, fail) => {
    let size = 0; const parts = [];
    req.on('data', c => { size += c.length; if (size > max) { fail(new Error('grande')); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}
// Aceita só o que a página precisa; o resto é ignorado.
function clean(b) {
  if (!b || !Array.isArray(b.contents) || !b.contents.length || b.contents.length > 40) return null;
  let images = 0;
  const contents = [];
  for (const c of b.contents) {
    if (!c || !['user', 'model'].includes(c.role) || !Array.isArray(c.parts)) return null;
    const parts = [];
    for (const p of c.parts) {
      if (p && typeof p.text === 'string') parts.push({ text: p.text.slice(0, 30000) });
      else if (p && p.inlineData && /^image\/(jpeg|png|webp)$/.test(p.inlineData.mimeType) && typeof p.inlineData.data === 'string') {
        if (++images > 8) return null;
        parts.push({ inlineData: { mimeType: p.inlineData.mimeType, data: p.inlineData.data } });
      }
    }
    if (!parts.length) return null;
    contents.push({ role: c.role, parts });
  }
  const out = { contents };
  const si = b.systemInstruction && b.systemInstruction.parts && b.systemInstruction.parts[0];
  if (si && typeof si.text === 'string') out.systemInstruction = { parts: [{ text: si.text.slice(0, 12000) }] };
  const g = b.generationConfig || {};
  out.generationConfig = { maxOutputTokens: Math.min(Math.max(parseInt(g.maxOutputTokens, 10) || 2048, 1), 8192) };
  if (typeof g.temperature === 'number') out.generationConfig.temperature = Math.min(Math.max(g.temperature, 0), 1);
  if (g.thinkingConfig && typeof g.thinkingConfig === 'object') {
    const t = {};
    if (Number.isInteger(g.thinkingConfig.thinkingBudget)) t.thinkingBudget = g.thinkingConfig.thinkingBudget;
    if (['minimal', 'low', 'medium', 'high'].includes(g.thinkingConfig.thinkingLevel)) t.thinkingLevel = g.thinkingConfig.thinkingLevel;
    if (Object.keys(t).length) out.generationConfig.thinkingConfig = t;
  }
  if (Array.isArray(b.tools) && b.tools.length === 1 && b.tools[0] && b.tools[0].google_search) out.tools = [{ google_search: {} }];
  return out;
}

async function chat(req, res) {
  if (!KEY) return json(res, 503, { error: { message: 'O servidor ainda não tem a chave configurada.' } });
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const why = allowed(ip);
  if (why) return json(res, 429, { error: { message: why } });
  let body;
  try { body = clean(JSON.parse(await readBody(req, 12 * 1024 * 1024))); } catch (e) { body = null; }
  if (!body) return json(res, 400, { error: { message: 'Pedido inválido.' } });
  const ctl = new AbortController();
  res.on('close', () => ctl.abort());
  const timer = setTimeout(() => ctl.abort(), 120000);
  try {
    const up = await fetch(BASE + '/v1beta/models/' + encodeURIComponent(MODEL) + ':streamGenerateContent?alt=sse', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY },
      body: JSON.stringify(body)
    });
    if (!up.ok) {
      const txt = await up.text();
      res.writeHead(up.status, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(txt);
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
    for await (const chunk of up.body) res.write(chunk);
    res.end();
  } catch (e) {
    if (!res.headersSent) json(res, 502, { error: { message: 'Não consegui falar com o Gemini. Tenta outra vez.' } });
    else res.end();
  } finally { clearTimeout(timer); }
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (url === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, hasKey: !!KEY });
  if (url === '/api/chat' && req.method === 'POST') return chat(req, res);
  const f = FILES[url];
  if (req.method === 'GET' && f) {
    fs.readFile(path.join(__dirname, f[0]), (err, data) => {
      if (err) { res.writeHead(404); return res.end('Não encontrado'); }
      res.writeHead(200, { 'Content-Type': f[1], 'Cache-Control': f[1].startsWith('image') ? 'public, max-age=86400' : 'no-cache' });
      res.end(data);
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Não encontrado');
});
server.listen(PORT, '0.0.0.0', () => console.log('Ali Assistente a correr na porta ' + PORT));
