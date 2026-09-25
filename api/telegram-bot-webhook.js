function telegramApiUrl(token, method){ return `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`; }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ok:false,error:'Method not allowed'});
  const token=String(process.env.TELEGRAM_GATE_BOT_TOKEN||'').trim();
  if(!token) return res.status(500).json({ok:false,error:'TELEGRAM_GATE_BOT_TOKEN is not configured.'});
  try {
    const update=req.body && typeof req.body==='object' ? req.body : {};
    const msg=update.message;
    if(!msg?.chat?.id) return res.status(200).json({ok:true,ignored:true});
    const text=String(msg.text||'');
    if(!/^\/start(?:\s+studyai_verify)?/i.test(text)) return res.status(200).json({ok:true,ignored:true});
    const loginUrl='https://studyai-pearl.vercel.app/api/telegram-login-callback';
    const payload={chat_id:msg.chat.id,text:'🔐 Study Notes verification\n\nNeeche button dabakar Telegram account verify karein. Verification ke baad app automatically unlock ho jayega.',reply_markup:{inline_keyboard:[[{text:'🔐 VERIFY WITH TELEGRAM',login_url:{url:loginUrl,request_write_access:false}}]]}};
    const tg=await fetch(telegramApiUrl(token,'sendMessage'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
    const data=await tg.json().catch(()=>({}));
    if(!tg.ok||data.ok!==true) return res.status(502).json({ok:false,error:data.description||'Telegram sendMessage failed.'});
    return res.status(200).json({ok:true});
  } catch(e){ return res.status(500).json({ok:false,error:e?.message||'Webhook failed.'}); }
}
