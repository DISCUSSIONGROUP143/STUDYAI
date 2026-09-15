/**
 * StudyNotesAI Cloudflare Worker
 * Secrets stay on Cloudflare; they are never sent to the browser.
 *
 * Secrets:
 * GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3 ... (as many as needed)
 * TELEGRAM_BOT_TOKEN
 * TELEGRAM_CHANNEL_ID
 *
 * Optional future GitHub automation:
 * GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};

const reply = (data, status=200) => new Response(JSON.stringify(data), {
  status,
  headers: {"Content-Type":"application/json; charset=utf-8", ...CORS}
});

function geminiKeys(env) {
  return Object.keys(env)
    .filter(k => /^GEMINI_API_KEY_\d+$/.test(k))
    .sort((a,b) => Number(a.split("_").pop()) - Number(b.split("_").pop()))
    .map(k => env[k]).filter(Boolean);
}

async function generate(env, body) {
  const keys = geminiKeys(env);
  if (!keys.length) return reply({ok:false,error:"No Gemini API keys configured."},500);

  const model = body.model || "gemini-2.5-flash";
  const contents = body.contents || [
    {role:"user", parts:[{text:String(body.prompt || "")}]}
  ];
  let last = null;

  for (let i=0; i<keys.length; i++) {
    try {
      const endpoint =
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(keys[i])}`;

      const r = await fetch(endpoint, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents, generationConfig:body.generationConfig || {}})
      });
      const text = await r.text();

      if (r.ok) {
        let data;
        try { data = JSON.parse(text); } catch { data = {raw:text}; }
        return reply({ok:true,keySlot:i+1,data});
      }

      last = {status:r.status, body:text.slice(0,1000)};
      if (![400,401,403,404,408,409,429,500,502,503,504].includes(r.status)) break;
    } catch (e) {
      last = {error:String(e)};
    }
  }

  return reply({ok:false,error:"All configured Gemini API keys failed.",detail:last},502);
}

async function telegram(env, body) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = body.chat_id || env.TELEGRAM_CHANNEL_ID;
  if (!token || !chatId)
    return reply({ok:false,error:"Telegram secrets are not configured."},500);

  const method = body.method || "sendMessage";
  if (!["sendMessage","sendDocument"].includes(method))
    return reply({ok:false,error:"Unsupported Telegram method."},400);

  const payload = {...body, chat_id:chatId};
  delete payload.method;

  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  const text = await r.text();
  try { return reply(JSON.parse(text),r.status); }
  catch { return reply({raw:text},r.status); }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null,{status:204,headers:CORS});

    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return reply({
        ok:true,
        worker:"studynotesai",
        geminiKeys:geminiKeys(env).length,
        telegramConfigured:Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHANNEL_ID),
        githubConfigured:Boolean(env.GITHUB_TOKEN)
      });
    }

    if (url.pathname === "/generate" && request.method === "POST") {
      try { return await generate(env,await request.json()); }
      catch { return reply({ok:false,error:"Invalid JSON."},400); }
    }

    if (url.pathname === "/telegram" && request.method === "POST") {
      try { return await telegram(env,await request.json()); }
      catch { return reply({ok:false,error:"Invalid JSON."},400); }
    }

    return reply({
      ok:true,
      service:"StudyNotesAI",
      routes:["GET /health","POST /generate","POST /telegram"]
    });
  }
};
