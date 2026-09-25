import crypto from 'crypto';

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function verifyTelegramLogin(data, botToken) {
  const receivedHash = String(data?.hash || '').trim().toLowerCase();
  if (!receivedHash) return {ok:false, error:'Telegram auth hash missing.'};

  const pairs = Object.entries(data)
    .filter(([key, value]) => key !== 'hash' && value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);

  const dataCheckString = pairs.join('\n');
  const secretKey = crypto.createHash('sha256').update(botToken).digest();
  const calculatedHash = hmacSha256(secretKey, dataCheckString).toString('hex');

  if (calculatedHash.length !== receivedHash.length) return {ok:false, error:'Telegram auth verification failed.'};
  if (!crypto.timingSafeEqual(Buffer.from(calculatedHash), Buffer.from(receivedHash))) {
    return {ok:false, error:'Telegram auth verification failed.'};
  }

  const authDate = Number(data?.auth_date || 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return {ok:false, error:'Telegram auth date missing.'};

  // Do not accept stale Telegram login payloads.
  const maxAge = 24 * 60 * 60;
  if (Math.floor(Date.now() / 1000) - authDate > maxAge) {
    return {ok:false, error:'Telegram login expired. Please Login again.'};
  }

  const userId = Number(data?.id || 0);
  if (!Number.isSafeInteger(userId) || userId <= 0) return {ok:false, error:'Invalid Telegram user ID.'};

  return {ok:true, userId};
}

async function telegramApi(method, token, body) {
  const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`, {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) {
    throw new Error(data.description || `Telegram ${method} failed.`);
  }
  return data.result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ok:false, error:'Method not allowed'});

  const botToken = String(process.env.TELEGRAM_GATE_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_GATE_CHAT_ID || '').trim();

  if (!botToken || !chatId) {
    return res.status(500).json({
      ok:false,
      error:'Telegram gate is not configured. Add TELEGRAM_GATE_BOT_TOKEN and TELEGRAM_GATE_CHAT_ID in Vercel.'
    });
  }

  try {
    const verification = verifyTelegramLogin(req.body || {}, botToken);
    if (!verification.ok) return res.status(401).json(verification);

    const member = await telegramApi('getChatMember', botToken, {
      chat_id: chatId,
      user_id: verification.userId
    });

    const status = String(member?.status || '');
    const isMember = status === 'creator' || status === 'administrator' || status === 'member' ||
      (status === 'restricted' && member?.is_member === true);

    if (!isMember) {
      return res.status(403).json({
        ok:false,
        member:false,
        error:'Aap is Telegram channel ke member nahi ho. Pehle channel Join karein, phir Telegram Login dobara karein.'
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ok:true, member:true, telegramUserId:verification.userId});
  } catch (error) {
    return res.status(502).json({
      ok:false,
      error:error?.message || 'Telegram membership check failed.'
    });
  }
}
