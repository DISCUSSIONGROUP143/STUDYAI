const textEncoder = new TextEncoder();

function bytesToHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sha256Bytes(input) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(input)));
}

async function verifyTelegramLoginHash(auth, botToken) {
  if (!auth || !auth.id || !auth.auth_date || !auth.hash) return false;

  const authAge = Math.floor(Date.now() / 1000) - Number(auth.auth_date);
  if (!Number.isFinite(authAge) || authAge < -300 || authAge > 86400) return false;

  const dataCheckString = Object.keys(auth)
    .filter(key => key !== 'hash' && auth[key] !== undefined && auth[key] !== null)
    .sort()
    .map(key => `${key}=${auth[key]}`)
    .join('\n');

  const secretKey = await sha256Bytes(botToken);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    secretKey,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    textEncoder.encode(dataCheckString)
  ));

  return constantTimeEqual(bytesToHex(signature), String(auth.hash).toLowerCase());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = String(process.env.TELEGRAM_GATE_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_GATE_CHAT_ID || '').trim();

  if (!token || !chatId) {
    return res.status(500).json({
      ok: false,
      member: false,
      error: 'TELEGRAM_GATE_BOT_TOKEN or TELEGRAM_GATE_CHAT_ID is not configured.'
    });
  }

  try {
    const auth = req.body && typeof req.body === 'object' ? req.body : {};

    const validLogin = await verifyTelegramLoginHash(auth, token);
    if (!validLogin) {
      return res.status(401).json({
        ok: false,
        member: false,
        error: 'Telegram login verification invalid or expired.'
      });
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(String(auth.id))}`;
    const tg = await fetch(url);
    const data = await tg.json().catch(() => ({}));

    if (!tg.ok || data.ok !== true) {
      return res.status(502).json({
        ok: false,
        member: false,
        error: data.description || 'Telegram membership check failed.'
      });
    }

    const member = data.result || {};
    const joined =
      member.status === 'creator' ||
      member.status === 'administrator' ||
      member.status === 'member' ||
      (member.status === 'restricted' && member.is_member === true);

    if (!joined) {
      return res.status(403).json({
        ok: true,
        member: false,
        status: member.status || 'left',
        error: 'Telegram channel join नहीं मिला। पहले channel join करें, फिर Verify करें।'
      });
    }

    return res.status(200).json({
      ok: true,
      member: true,
      status: member.status
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      member: false,
      error: error?.message || 'Telegram verification failed.'
    });
  }
}
