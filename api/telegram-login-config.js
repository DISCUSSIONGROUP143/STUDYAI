function randomBase64Url(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  let binary = '';
  for (const b of data) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = String(process.env.TELEGRAM_GATE_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_GATE_CHAT_ID || '').trim();
  const clientId = String(process.env.TELEGRAM_LOGIN_CLIENT_ID || '').trim();

  if (!token || !chatId || !clientId) {
    return res.status(500).json({
      ok: false,
      error: 'TELEGRAM_GATE_BOT_TOKEN, TELEGRAM_GATE_CHAT_ID or TELEGRAM_LOGIN_CLIENT_ID is not configured.'
    });
  }

  try {
    const tg = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`);
    const data = await tg.json().catch(() => ({}));

    if (!tg.ok || data.ok !== true || !data.result?.username) {
      return res.status(502).json({
        ok: false,
        error: data.description || 'Gate bot token is invalid or Telegram is unavailable.'
      });
    }

    let joinUrl = '';
    if (/^https?:\/\/t\.me\//i.test(chatId)) {
      joinUrl = chatId;
    } else if (/^@[A-Za-z0-9_]{5,}$/.test(chatId)) {
      joinUrl = `https://t.me/${chatId.slice(1)}`;
    }

    return res.status(200).json({
      ok: true,
      username: data.result.username,
      joinUrl,
      clientId,
      nonce: randomBase64Url()
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || 'Telegram gate config failed.'
    });
  }
}
