// StudyNotesAI — Cloudflare Pages Function
// Purpose: Telegram Logs only. No Gemini API key is stored here.

const json = (data, status = 200, origin = '*') => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type'
  }
});

const corsOptions = (request, env) => {
  const origin = env.ALLOWED_ORIGIN || request.headers.get('Origin') || '*';
  return new Response(null, { status: 204, headers: {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'Content-Type',
    'access-control-max-age': '86400'
  }});
};

function getTelegramChatId(env) {
  return env.TELEGRAM_LOG_CHAT_ID || '';
}

function escapeHtml(s='') {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

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

async function publishToTelegram({request, env}) {
  if (request.method === 'OPTIONS') return corsOptions(request, env);
  const origin = env.ALLOWED_ORIGIN || '*';
  if (request.method !== 'POST') return json({ok:false,error:'Method Not Allowed'},405,origin);
  if (!env.TELEGRAM_BOT_TOKEN || !getTelegramChatId(env)) {
    return json({ok:false,error:'Telegram bot token या TELEGRAM_LOG_CHAT_ID configured नहीं है।'},503,origin);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ok:false,error:'Invalid JSON'},400,origin); }

  const chat_id = getTelegramChatId(env);
  const text = buildText(body);
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

  const send = await fetch(base + '/sendMessage', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({chat_id,text,disable_web_page_preview:true})
  });
  const result = await send.json().catch(()=>({}));
  if (!send.ok || !result.ok) {
    return json({ok:false,error:result?.description || `Telegram HTTP ${send.status}`},502,origin);
  }

  const safeName = String(body.topic || 'study_notes').replace(/[^a-zA-Z0-9_-]/g,'_') || 'study_notes';

  if (body.json) {
    const blob = new Blob([String(body.json)], {type:'application/json'});
    const form = new FormData();
    form.append('chat_id', chat_id);
    form.append('document', blob, `${safeName}.json`);
    const doc = await fetch(base + '/sendDocument', {method:'POST',body:form});
    const dr = await doc.json().catch(()=>({}));
    if (!doc.ok || !dr.ok) {
      return json({ok:false,error:dr?.description || `Telegram JSON HTTP ${doc.status}`},502,origin);
    }
  }

  if (body.html) {
    const blob = new Blob([String(body.html)], {type:'text/html'});
    const form = new FormData();
    form.append('chat_id', chat_id);
    form.append('document', blob, `${safeName}.html`);
    const doc = await fetch(base + '/sendDocument', {method:'POST',body:form});
    const dr = await doc.json().catch(()=>({}));
    if (!doc.ok || !dr.ok) {
      return json({ok:false,error:dr?.description || `Telegram HTML HTTP ${doc.status}`},502,origin);
    }
  }

  return json({ok:true},200,origin);
}

async function health({request, env}) {
  if (request.method === 'OPTIONS') return corsOptions(request, env);
  if (request.method !== 'GET') return json({ok:false,error:'Method Not Allowed'},405,env.ALLOWED_ORIGIN || '*');
  return json({
    ok:true,
    service:'StudyNotesAI',
    telegramConfigured:!!(env.TELEGRAM_BOT_TOKEN && getTelegramChatId(env))
  },200,env.ALLOWED_ORIGIN || '*');
}

export async function onRequest(context) {
  const {request, env} = context;
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') return corsOptions(request, env);
  if (url.pathname === '/health') return health({request, env});
  if (url.pathname === '/publish-owner') return publishToTelegram({request, env});

  // Pages catch-all: let Cloudflare serve index.html and other static assets.
  if (env.ASSETS && typeof env.ASSETS.fetch === 'function') return env.ASSETS.fetch(request);
  return json({ok:false,error:'Not Found'},404,env.ALLOWED_ORIGIN || '*');
}
