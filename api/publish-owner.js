// StudyNotesAI — Vercel Serverless Function
// Telegram Logs only. Gemini API key is never stored here.

function sendJson(res, data, status = 200, origin = '*') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildText(body) {
  const topic = body.topic || 'Study Notes Test';
  const qs = Array.isArray(body.questions) ? body.questions : [];
  let out = `📚 ${topic}\n${body.sourceLabel || 'Study NotesAI'}\n\n`;

  qs.forEach((q, i) => {
    out += `${i + 1}. ${q.question || ''}\n`;
    (q.options || []).slice(0, 4).forEach((o, j) => {
      out += `${String.fromCharCode(65 + j)}) ${o}\n`;
    });
    if (q.answer !== undefined) out += `Answer: ${q.answer}\n`;
    if (q.explanation) out += `Explanation: ${q.explanation}\n`;
    out += '\n';
  });

  return out;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;

  return await new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  const origin = process.env.ALLOWED_ORIGIN || '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, { ok: false, error: 'Method Not Allowed' }, 405, origin);
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const chatId = process.env.TELEGRAM_LOG_CHAT_ID || '';

  if (!botToken || !chatId) {
    return sendJson(
      res,
      { ok: false, error: 'Telegram bot token या TELEGRAM_LOG_CHAT_ID configured नहीं है।' },
      503,
      origin
    );
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, { ok: false, error: 'Invalid JSON' }, 400, origin);
  }

  const text = buildText(body);
  const base = `https://api.telegram.org/bot${botToken}`;

  try {
    const send = await fetch(base + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true
      })
    });

    const result = await send.json().catch(() => ({}));

    if (!send.ok || !result.ok) {
      return sendJson(
        res,
        { ok: false, error: result?.description || `Telegram HTTP ${send.status}` },
        502,
        origin
      );
    }

    const safeName =
      String(body.topic || 'study_notes')
        .replace(/[^a-zA-Z0-9_-]/g, '_') || 'study_notes';

    if (body.json) {
      const form = new FormData();
      form.append(
        'document',
        new Blob([String(body.json)], { type: 'application/json' }),
        `${safeName}.json`
      );
      form.append('chat_id', chatId);

      const doc = await fetch(base + '/sendDocument', {
        method: 'POST',
        body: form
      });
      const dr = await doc.json().catch(() => ({}));

      if (!doc.ok || !dr.ok) {
        return sendJson(
          res,
          { ok: false, error: dr?.description || `Telegram JSON HTTP ${doc.status}` },
          502,
          origin
        );
      }
    }

    if (body.html) {
      const form = new FormData();
      form.append(
        'document',
        new Blob([String(body.html)], { type: 'text/html' }),
        `${safeName}.html`
      );
      form.append('chat_id', chatId);

      const doc = await fetch(base + '/sendDocument', {
        method: 'POST',
        body: form
      });
      const dr = await doc.json().catch(() => ({}));

      if (!doc.ok || !dr.ok) {
        return sendJson(
          res,
          { ok: false, error: dr?.description || `Telegram HTML HTTP ${doc.status}` },
          502,
          origin
        );
      }
    }

    return sendJson(res, { ok: true }, 200, origin);
  } catch (err) {
    return sendJson(
      res,
      { ok: false, error: err?.message || 'Telegram publish failed' },
      500,
      origin
    );
  }
}
