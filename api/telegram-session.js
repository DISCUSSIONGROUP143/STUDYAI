const enc=new TextEncoder();
async function sha256(input){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(input)));}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
async function sign(value,token){const key=await sha256(token);const ck=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=new Uint8Array(await crypto.subtle.sign('HMAC',ck,enc.encode(value)));return hex(sig);}
async function eq(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).json({ok:false,error:'Method not allowed'});
  const token=String(process.env.TELEGRAM_GATE_BOT_TOKEN||'').trim(),chatId=String(process.env.TELEGRAM_GATE_CHAT_ID||'').trim();
  if(!token||!chatId)return res.status(500).json({ok:false,member:false,error:'Telegram gate is not configured.'});
  try{
    const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('studyai_tg_session='))?.slice('studyai_tg_session='.length)||'';
    const parts=raw.split('.'); if(parts.length!==3)return res.status(401).json({ok:false,member:false});
    const value=`${parts[0]}.${parts[1]}`; const exp=Number(parts[1]); if(!Number.isFinite(exp)||exp<Math.floor(Date.now()/1000))return res.status(401).json({ok:false,member:false});
    const expected=await sign(value,token); if(!(await eq(expected,parts[2])))return res.status(401).json({ok:false,member:false});
    const r=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(parts[0])}`); const d=await r.json().catch(()=>({})); if(!r.ok||d.ok!==true)return res.status(502).json({ok:false,member:false,error:d.description||'Membership check failed'});
    const m=d.result||{}; const joined=m.status==='creator'||m.status==='administrator'||m.status==='member'||(m.status==='restricted'&&m.is_member===true);
    return res.status(200).json({ok:true,member:joined,status:m.status,user:{id:Number(parts[0])}});
  }catch(e){return res.status(500).json({ok:false,member:false,error:e?.message||'Session check failed'});}
}
