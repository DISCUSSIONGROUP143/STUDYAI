export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok:false, error:'Method not allowed' });
  const token = String(process.env.TELEGRAM_GATE_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_GATE_CHAT_ID || '').trim();
  if (!token || !chatId) return res.status(500).json({ok:false,error:'TELEGRAM_GATE_BOT_TOKEN or TELEGRAM_GATE_CHAT_ID is not configured.'});
  try {
    const meRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`);
    const me = await meRes.json().catch(()=>({}));
    if (!meRes.ok || me.ok !== true || !me.result?.username) return res.status(502).json({ok:false,error:me.description || 'Gate bot token is invalid.'});
    let joinUrl='';
    if (/^https?:\/\/t\.me\//i.test(chatId)) joinUrl=chatId;
    else if (/^@[A-Za-z0-9_]{5,}$/.test(chatId)) joinUrl=`https://t.me/${chatId.slice(1)}`;

    const origin = 'https://studyai-pearl.vercel.app';
    const webhookUrl = `${origin}/api/telegram-bot-webhook`;
    const whRes = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/setWebhook`, {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({url:webhookUrl, allowed_updates:['message'], drop_pending_updates:false})
    });
    const wh = await whRes.json().catch(()=>({}));
    if (!whRes.ok || wh.ok !== true) return res.status(502).json({ok:false,error:wh.description || 'Telegram webhook setup failed.'});

    return res.status(200).json({ok:true, username:me.result.username, joinUrl, verifyUrl:`https://t.me/${me.result.username}?start=studyai_verify`});
  } catch (error) {
    return res.status(500).json({ok:false,error:error?.message || 'Telegram gate config failed.'});
  }
}
