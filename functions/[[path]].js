// StudyNotesAI — single Cloudflare Worker backend
// All backend routes are kept in this one file.
// Frontend origin: https://studyai-awn.pages.dev

const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization'
  }
});

const corsOptions = (request, env) => {
  const origin = env.ALLOWED_ORIGIN || request.headers.get('Origin') || '*';
  return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-max-age': '86400'
  }});
};

async function readGeminiKeys(env) {
  const raw = await env.KV?.get('gemini:keys');
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim());
  } catch {}
  return [];
}

async function writeGeminiKeys(env, keys) {
  await env.KV.put('gemini:keys', JSON.stringify([...new Set(keys.filter(Boolean))]));
}

function ownerOK(request, body, env) {
  const expected = env.OWNER_ACCESS || 'GOLU';
  const supplied = body?.password || request.headers.get('X-Owner-Access') || '';
  return supplied === expected;
}

function getTelegramChatId(env) {
  return env.TELEGRAM_CHANNEL_ID || env.TELEGRAM_LOG_CHAT_ID || '';
}



async function callGemini(key, model, prompt, parts) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const contentParts = [{text:String(prompt || '')}, ...(Array.isArray(parts) ? parts : [])];
  const r = await fetch(endpoint, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({contents:[{parts:contentParts}], generationConfig:{temperature:0.25}})});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`Gemini HTTP ${r.status}${data?.error?.message ? ': '+data.error.message : ''}`);
  const text = data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('') || '';
  if (!text) throw new Error('Gemini ने कोई text output नहीं दिया।');
  return text;
}

async function callOpenAI(key, model, prompt) {
  const r = await fetch('https://api.openai.com/v1/responses', {method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${key}`}, body:JSON.stringify({model:model || 'gpt-4.1-mini', input:String(prompt || '')})});
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}${data?.error?.message ? ': '+data.error.message : ''}`);
  const text = data?.output_text || data?.output?.flatMap(x=>x.content||[]).map(x=>x.text||'').join('') || '';
  if (!text) throw new Error('OpenAI ने कोई text output नहीं दिया।');
  return text;
}

async function onRequestAIOriginal({request, env}) {
  if (request.method === 'OPTIONS') return corsOptions(request, env);
  const origin = env.ALLOWED_ORIGIN || '*';
  if (request.method !== 'POST') return json({ok:false,error:'Method Not Allowed'},405,origin);
  let body; try { body = await request.json(); } catch { return json({ok:false,error:'Invalid JSON'},400,origin); }
  const provider = body.provider || 'auto';
  const model = body.model || 'gemini-3.8-flash';
  const prompt = body.prompt || '';
  const parts = Array.isArray(body.parts) ? body.parts : [];
  let errors = [];

  if ((provider === 'openai' || provider === 'auto') && env.OPENAI_API_KEY) {
    try { return json({ok:true,provider:'openai',output_text:await callOpenAI(env.OPENAI_API_KEY, model, prompt)},200,origin); }
    catch(e) { errors.push(e.message); if (provider === 'openai') return json({ok:false,error:e.message},502,origin); }
  }

  const keys = await readGeminiKeys(env);
  if (!keys.length) return json({ok:false,error:'कोई Gemini API key backend में saved नहीं है।'+(errors.length?' '+errors.join(' | '):'')},503,origin);
  for (let i=0;i<keys.length;i++) {
    try {
      const output = await callGemini(keys[i], model, prompt, parts);
      return json({ok:true,provider:'gemini',keyIndex:i+1,output_text:output},200,origin);
    } catch(e) { errors.push(`Gemini key ${i+1}: ${e.message}`); }
  }
  return json({ok:false,error:'सभी saved Gemini keys fail हो गईं। '+errors.join(' | ')},502,origin);
}



async function onRequestHealthOriginal({request, env}) {
  if (request.method === 'OPTIONS') return corsOptions(request, env);
  if (request.method !== 'GET') return json({ok:false, error:'Method Not Allowed'}, 405, env.ALLOWED_ORIGIN || '*');
  const keys = await readGeminiKeys(env);
  return json({ok:true, service:'StudyNotesAI', geminiKeys:keys.length, telegramConfigured:!!(env.TELEGRAM_BOT_TOKEN && getTelegramChatId(env)), openaiConfigured:!!env.OPENAI_API_KEY, kvConfigured:!!env.KV}, 200, env.ALLOWED_ORIGIN || '*');
}



function escapeHtml(s='') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function buildText(body) {
  const topic = body.topic || 'Study Notes Test';
  const qs = Array.isArray(body.questions) ? body.questions : [];
  let out = `📚 ${topic}\n${body.sourceLabel || 'Study NotesAI'}\n\n`;
  qs.forEach((q,i)=>{
    out += `${i+1}. ${q.question || ''}\n`;
    (q.options || []).slice(0,4).forEach((o,j)=> out += `${String.fromCharCode(65+j)}) ${o}\n`);
    if (q.answer !== undefined) out += `Answer: ${q.answer}\n`;
    if (q.explanation) out += `Explanation: ${q.explanation}\n`;
    out += '\n';
  });
  return out;
}

async function onRequestPublishOriginal({request, env}) {
  if (request.method === 'OPTIONS') return corsOptions(request, env);
  const origin = env.ALLOWED_ORIGIN || '*';
  if (request.method !== 'POST') return json({ok:false,error:'Method Not Allowed'},405,origin);
  if (!env.TELEGRAM_BOT_TOKEN || !getTelegramChatId(env)) return json({ok:false,error:'Telegram bot token या channel ID configured नहीं है।'},503,origin);
  let body; try { body = await request.json(); } catch { return json({ok:false,error:'Invalid JSON'},400,origin); }
  const chat_id = getTelegramChatId(env);
  const text = buildText(body);
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const send = await fetch(base + '/sendMessage', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id,text,disable_web_page_preview:true})});
  const result = await send.json().catch(()=>({}));
  if (!send.ok || !result.ok) return json({ok:false,error:result?.description || `Telegram HTTP ${send.status}`},502,origin);
  // Send HTML as a document when provided, so both generated formats reach the log channel.
  if (body.html) {
    const blob = new Blob([String(body.html)], {type:'text/html'});
    const form = new FormData();
    form.append('chat_id', chat_id);
    form.append('document', blob, `${String(body.topic || 'study_notes').replace(/[^a-zA-Z0-9_-]/g,'_')}.html`);
    const doc = await fetch(base + '/sendDocument', {method:'POST',body:form});
    const dr = await doc.json().catch(()=>({}));
    if (!doc.ok || !dr.ok) return json({ok:false,error:dr?.description || `Telegram document HTTP ${doc.status}`},502,origin);
  }
  return json({ok:true},200,origin);
}



async function onRequestConfigOriginal({request, env}) {
  if (request.method === 'OPTIONS') return corsOptions(request, env);
  const origin = env.ALLOWED_ORIGIN || '*';
  if (request.method !== 'POST') return json({ok:false,error:'Method Not Allowed'},405,origin);
  let body; try { body = await request.json(); } catch { return json({ok:false,error:'Invalid JSON'},400,origin); }
  if (!ownerOK(request, body, env)) return json({ok:false,error:'Owner Access गलत है।'},401,origin);
  const action = body.action || 'add';
  const keys = await readGeminiKeys(env);
  if (action === 'add') {
    const key = String(body.key || '').trim();
    if (!key) return json({ok:false,error:'Gemini API key खाली है।'},400,origin);
    if (!keys.includes(key)) keys.push(key);
    await writeGeminiKeys(env, keys);
    return json({ok:true,count:keys.length},200,origin);
  }
  if (action === 'remove') {
    const key = String(body.key || '').trim();
    const next = keys.filter(k => k !== key);
    await writeGeminiKeys(env,next);
    return json({ok:true,count:next.length},200,origin);
  }
  if (action === 'list') return json({ok:true,count:keys.length},200,origin);
  return json({ok:false,error:'Unknown action'},400,origin);
}


// Single Worker router

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return corsOptions(request, env);
  if (url.pathname === '/health') return onRequestHealthOriginal({request, env});
  if (url.pathname === '/ai') return onRequestAIOriginal({request, env});
  if (url.pathname === '/publish-owner') return onRequestPublishOriginal({request, env});
  if (url.pathname === '/admin/config') return onRequestConfigOriginal({request, env});
  // Preserve original worker routes that are implemented by the publish handler.
  if (request.method !== 'POST') return json({ok:false,error:'Not Found'},404,env.ALLOWED_ORIGIN || '*');
  return json({ok:false,error:'Unknown endpoint.'},404,env.ALLOWED_ORIGIN || '*');
}
