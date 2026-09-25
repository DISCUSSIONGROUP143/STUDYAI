const crypto = require('crypto');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(body));
}

function validTelegramAuth(data, botToken) {
  if (!data || !data.hash || !data.auth_date) return false;
  const maxAge = Number(process.env.TELEGRAM_AUTH_MAX_AGE || 86400);
  const authDate = Number(data.auth_date);
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > maxAge) return false;

  const checkString = Object.keys(data)
    .filter(k => k !== 'hash' && data[k] !== undefined && data[k] !== null)
    .sort()
    .map(k => `${k}=${data[k]}`)
    .join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(String(data.hash), 'hex'));
  } catch (_) {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_REQUIRED_CHAT_ID || '@MOCK_TEST18';
  if (!botToken) return send(res, 500, { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured on Vercel.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  const auth = body?.auth;
  if (!validTelegramAuth(auth, botToken)) return send(res, 401, { ok: false, error: 'Telegram authentication could not be verified.' });

  const telegramUrl = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getChatMember`;
  const tgRes = await fetch(telegramUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, user_id: Number(auth.id) })
  });
  const tg = await tgRes.json().catch(() => ({}));
  if (!tgRes.ok || !tg.ok) return send(res, 502, { ok: false, error: tg.description || 'Telegram membership check failed.' });

  const member = tg.result || {};
  const joined = ['creator', 'administrator', 'member'].includes(member.status) ||
    (member.status === 'restricted' && member.is_member === true);

  return send(res, 200, {
    ok: true,
    joined,
    user: { id: Number(auth.id), first_name: auth.first_name || '', username: auth.username || '' },
    required_chat: chatId
  });
};
