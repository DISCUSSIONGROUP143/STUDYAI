const enc=new TextEncoder();
async function sha256(input){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(input)));}
function hex(bytes){return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');}
async function validAuth(auth,token){
  if(!auth?.id||!auth?.auth_date||!auth?.hash)return false;
  const age=Math.floor(Date.now()/1000)-Number(auth.auth_date);
  if(!Number.isFinite(age)||age< -300||age>86400)return false;
  const check=Object.keys(auth).filter(k=>k!=='hash'&&auth[k]!==undefined&&auth[k]!==null).sort().map(k=>`${k}=${auth[k]}`).join('\n');
  const key=await sha256(token);
  const cryptoKey=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=new Uint8Array(await crypto.subtle.sign('HMAC',cryptoKey,enc.encode(check)));
  const a=hex(sig),b=String(auth.hash).toLowerCase();
  return a.length===b.length && [...a].every((c,i)=>c===b[i]);
}
async function member(token,chatId,userId){
  const r=await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(String(userId))}`);
  const d=await r.json().catch(()=>({})); if(!r.ok||d.ok!==true)return {ok:false,error:d.description||'Membership check failed'};
  const m=d.result||{}; const joined=m.status==='creator'||m.status==='administrator'||m.status==='member'||(m.status==='restricted'&&m.is_member===true);
  return {ok:true,member:joined,status:m.status};
}
async function signSession(value,token){const key=await sha256(token);const ck=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=new Uint8Array(await crypto.subtle.sign('HMAC',ck,enc.encode(value)));return hex(sig);}
export default async function handler(req,res){
  if(req.method!=='GET')return res.status(405).send('Method not allowed');
  const token=String(process.env.TELEGRAM_GATE_BOT_TOKEN||'').trim(),chatId=String(process.env.TELEGRAM_GATE_CHAT_ID||'').trim();
  if(!token||!chatId)return res.status(500).send('Telegram gate is not configured.');
  try{
    const auth=Object.fromEntries(new URL(req.url,`https://${req.headers.host}`).searchParams.entries());
    if(!(await validAuth(auth,token)))return res.status(401).send('Telegram verification expired or invalid.');
    const m=await member(token,chatId,auth.id); if(!m.ok)return res.status(502).send(m.error); if(!m.member)return res.status(403).send('Please join the Telegram channel first.');
    const exp=Math.floor(Date.now()/1000)+86400; const value=`${auth.id}.${exp}`; const sig=await signSession(value,token); const cookie=`studyai_tg_session=${value}.${sig}; Max-Age=86400; Path=/; HttpOnly; Secure; SameSite=Lax`;
    return res.status(302).setHeader('Set-Cookie',cookie).setHeader('Location','https://studyai-pearl.vercel.app/?telegram_verified=1').send('Verified');
  }catch(e){return res.status(500).send(e?.message||'Telegram verification failed.');}
}
