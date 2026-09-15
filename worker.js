/*
 * STUDY NOTES — Gemini + OpenAI AI Router
 * Deploy this as a SEPARATE Cloudflare Worker, or merge the /ai route
 * into your existing Study Notes Worker.
 *
 * Required Worker secrets:
 *   GEMINI_API_KEYS       = Google AI Studio keys, one per line (or comma-separated)
 *   OPENAI_API_KEY        = OpenAI API key (API billing/access is separate from ChatGPT subscription)
 *   TELEGRAM_BOT_TOKEN    = permanent owner bot token (keep secret)
 *   TELEGRAM_LOG_CHAT_ID  = permanent owner Logs Channel ID (keep secret)
 *
 * Optional Worker vars:
 *   GEMINI_MODEL     = gemini-3.8-flash
 *   OPENAI_MODEL     = gpt-5.6
 *   ALLOWED_ORIGIN   = https://studyai-awn.pages.dev
 */

const JSON_HEADERS = {
  'content-type': 'application/json; charset=UTF-8',
  'cache-control': 'no-store'
};

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = env.ALLOWED_ORIGIN || '*';
  const allowOrigin = allowed === '*' || origin === allowed || origin === 'null' ? origin || '*' : allowed;
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function response(body, status, request, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {...JSON_HEADERS, ...corsHeaders(request, env)}
  });
}

function extractTextFromGemini(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map(p => p?.text || '').join('').trim();
}

function normalizePartsForGemini(parts) {
  return (Array.isArray(parts) ? parts : []).map(p => {
    if (p?.inlineData?.data && p?.inlineData?.mimeType) {
      return {inline_data: {mime_type: p.inlineData.mimeType, data: p.inlineData.data}};
    }
    if (p?.inline_data?.data && p?.inline_data?.mime_type) return p;
    return null;
  }).filter(Boolean);
}

function looksLikeStructuredJSON(text) {
  const raw = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  if (!raw) return false;
  const a = raw.indexOf('['), b = raw.lastIndexOf(']');
  if (a !== -1 && b > a) { try { JSON.parse(raw.slice(a, b + 1)); return true; } catch (e) {} }
  const c = raw.indexOf('{'), d = raw.lastIndexOf('}');
  if (c !== -1 && d > c) { try { JSON.parse(raw.slice(c, d + 1)); return true; } catch (e) {} }
  return false;
}

function normalizePartsForOpenAI(parts) {
  const out = [];
  for (const p of (Array.isArray(parts) ? parts : [])) {
    const mime = p?.inlineData?.mimeType || p?.inline_data?.mime_type || '';
    const data = p?.inlineData?.data || p?.inline_data?.data || '';
    if (!mime || !data) continue;
    const dataUrl = `data:${mime};base64,${data}`;
    if (mime.startsWith('image/')) {
      out.push({type: 'input_image', image_url: dataUrl});
    } else if (mime === 'application/pdf' || mime.startsWith('text/')) {
      out.push({type: 'input_file', filename: `study-notes.${mime === 'application/pdf' ? 'pdf' : 'txt'}`, file_data: dataUrl});
    }
  }
  return out;
}

async function getStoredConfig(env) {
  if (!env.KV) return {};
  return await env.KV.get('studyai_config', 'json').catch(() => ({})) || {};
}

async function getGeminiKeys(env) {
  const cfg = await getStoredConfig(env);
  const keyText = String(cfg.geminiKeys || env.GEMINI_API_KEYS || env.GEMINI_API_KEY || '');
  return keyText.split(/[\n,]+/).map(x => x.trim()).filter(Boolean);
}

async function callGemini(env, prompt, parts, requestedModel) {
  const keys = await getGeminiKeys(env);
  if (!keys.length) throw new Error('GEMINI_API_KEYS is not configured.');

  const model = requestedModel && requestedModel.startsWith('gemini-')
    ? requestedModel
    : (env.GEMINI_MODEL || 'gemini-3.8-flash');
  const contentsParts = [{text: prompt}, ...normalizePartsForGemini(parts)];
  let lastError = null;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({
          contents: [{parts: contentsParts}],
          generationConfig: {responseMimeType: 'application/json'}
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message || `Gemini HTTP ${res.status}`);
      const output_text = extractTextFromGemini(data);
      if (!output_text) throw new Error('Gemini returned empty output.');
      if (!looksLikeStructuredJSON(output_text)) throw new Error('Gemini returned invalid JSON output.');
      return {output_text, provider: 'gemini', model};
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(`All configured Gemini keys failed: ${lastError?.message || 'unknown error'}`);
}

async function callOpenAI(env, prompt, parts, requestedModel) {
  if (!env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');
  const model = requestedModel && requestedModel.startsWith('gpt-')
    ? requestedModel
    : (env.OPENAI_MODEL || 'gpt-5.6');
  const content = [{type: 'input_text', text: prompt}, ...normalizePartsForOpenAI(parts)];
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      input: [{role: 'user', content}],
      store: false
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI HTTP ${res.status}`);
  const output_text = String(data?.output_text || '').trim();
  if (!output_text) throw new Error('OpenAI returned empty output.');
  if (!looksLikeStructuredJSON(output_text)) throw new Error('OpenAI returned invalid JSON output.');
  return {output_text, provider: 'openai', model};
}


async function telegramOwnerSendMessage(env, text, reply_markup = null) {
  const cfg = await getStoredConfig(env);
  const botToken = String(cfg.telegramBotToken || env.TELEGRAM_BOT_TOKEN || '');
  const chatId = String(cfg.telegramLogChatId || env.TELEGRAM_LOG_CHAT_ID || '');
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  if (!chatId) throw new Error('TELEGRAM_LOG_CHAT_ID is not configured.');

  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
    {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        chat_id: chatId,
        text: String(text || ''),
        ...(reply_markup ? {reply_markup} : {})
      })
    }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram sendMessage HTTP ${res.status}`);
  }
  return data;
}

async function telegramOwnerSendDocument(env, filename, content, caption) {
  const cfg = await getStoredConfig(env);
  const botToken = String(cfg.telegramBotToken || env.TELEGRAM_BOT_TOKEN || '');
  const chatId = String(cfg.telegramLogChatId || env.TELEGRAM_LOG_CHAT_ID || '');
  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured.');
  if (!chatId) throw new Error('TELEGRAM_LOG_CHAT_ID is not configured.');

  const form = new FormData();
  form.append('chat_id', chatId);
  form.append(
    'document',
    new Blob([content], {type: 'application/octet-stream'}),
    filename
  );
  if (caption) form.append('caption', String(caption).slice(0, 1024));

  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendDocument`,
    {method: 'POST', body: form}
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram sendDocument HTTP ${res.status}`);
  }
  return data;
}

async function publishOwnerMaterial(env, body) {
  const html = String(body?.html || '');
  const rawQuestions = Array.isArray(body?.json)
    ? body.json
    : (Array.isArray(body?.questions) ? body.questions : []);

  if (!html) throw new Error('HTML is missing.');
  if (!rawQuestions.length) throw new Error('Valid JSON questions are missing.');

  const topic = String(body?.topic || 'Study Quiz').trim();
  const sourceLabel = String(body?.sourceLabel || 'AI Generation').trim();

  const safe = topic
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80) || 'study-quiz';

  const jsonText = JSON.stringify(rawQuestions, null, 2);

  await telegramOwnerSendMessage(
    env,
    `📚 STUDY NOTES — PERMANENT SITE LOG\n\n` +
    `Source: ${sourceLabel}\n` +
    `Topic: ${topic}\n` +
    `Questions: ${rawQuestions.length}\n` +
    `Status: JSON + HTML`
  );

  const htmlResult = await telegramOwnerSendDocument(
    env,
    `${safe}.html`,
    html,
    `🌐 ${topic}\nHTML • Permanent Site Log`
  );

  const htmlFileId = htmlResult?.result?.document?.file_id;
  if (htmlFileId && body?.__workerOrigin) {
    const viewUrl = `${String(body.__workerOrigin).replace(/\/$/, '')}/view?file_id=${encodeURIComponent(htmlFileId)}`;
    await telegramOwnerSendMessage(env, `🌐 ${topic}\nHTML browser में खोलने के लिए नीचे button दबाएँ।`, {inline_keyboard:[[
      {text:'🌐 OPEN HTML', url:viewUrl}
    ]]});
  }

  await telegramOwnerSendDocument(
    env,
    `${safe}.json`,
    jsonText,
    `📦 ${topic}\nJSON • Permanent Site Log`
  );

  return {ok: true, sent: ['message', 'html', 'json'], topic};
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, {status: 204, headers: corsHeaders(request, env)});
    }
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      const cfg = await getStoredConfig(env);
      const geminiKeys = (await getGeminiKeys(env)).length;
      return response({
        ok: true,
        service: 'StudyNotesAI',
        geminiKeys,
        openaiConfigured: !!env.OPENAI_API_KEY,
        telegramConfigured: !!(cfg.telegramBotToken || env.TELEGRAM_BOT_TOKEN) && !!(cfg.telegramLogChatId || env.TELEGRAM_LOG_CHAT_ID),
        githubConfigured: false,
        keyStore: !!env.KV
      }, 200, request, env);
    }

    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/admin/config') {
      const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
      const auth = String(request.headers.get('X-StudyAI-Admin') || body.adminToken || '');
      const ownerToken = String(env.TELEGRAM_BOT_TOKEN || '');
      if (!ownerToken || auth !== ownerToken) return response({ok:false,error:'Owner authorization failed.'}, 401, request, env);
      const cfg = await getStoredConfig(env);
      if (request.method === 'GET') {
        return response({ok:true, geminiKeys:(await getGeminiKeys(env)).length, telegramConfigured:!!(cfg.telegramBotToken || env.TELEGRAM_BOT_TOKEN) && !!(cfg.telegramLogChatId || env.TELEGRAM_LOG_CHAT_ID)}, 200, request, env);
      }
      if (!env.KV) return response({ok:false,error:'KV binding is required for page-managed settings.'}, 500, request, env);
      const geminiKey = String(body.geminiKey || '').trim();
      const removeIndex = Number.isInteger(body.removeIndex) ? body.removeIndex : null;
      let keys = await getGeminiKeys(env);
      if (geminiKey) {
        if (!keys.includes(geminiKey)) keys.push(geminiKey);
      }
      if (removeIndex !== null && removeIndex >= 0 && removeIndex < keys.length) keys.splice(removeIndex, 1);
      const next = {...cfg, geminiKeys: keys.join('\n')};
      if (body.telegramBotToken !== undefined) next.telegramBotToken = String(body.telegramBotToken || '').trim();
      if (body.telegramLogChatId !== undefined) next.telegramLogChatId = String(body.telegramLogChatId || '').trim();
      await env.KV.put('studyai_config', JSON.stringify(next));
      return response({ok:true, geminiKeys:keys.length, telegramConfigured:!!(next.telegramBotToken || env.TELEGRAM_BOT_TOKEN) && !!(next.telegramLogChatId || env.TELEGRAM_LOG_CHAT_ID)}, 200, request, env);
    }

    if (request.method === 'GET' && url.pathname === '/view') {
      const fileId = url.searchParams.get('file_id');
      if (!fileId) return new Response('Missing file_id', {status:400});
      const cfg = await getStoredConfig(env);
      const botToken = String(cfg.telegramBotToken || env.TELEGRAM_BOT_TOKEN || '');
      if (!botToken) return new Response('Telegram is not configured', {status:500});
      const gf = await fetch(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/getFile?file_id=${encodeURIComponent(fileId)}`);
      const gj = await gf.json().catch(() => ({}));
      if (!gf.ok || gj.ok === false || !gj.result?.file_path) return new Response('Telegram file lookup failed', {status:502});
      const fr = await fetch(`https://api.telegram.org/file/bot${encodeURIComponent(botToken)}/${gj.result.file_path}`);
      if (!fr.ok) return new Response('Telegram file download failed', {status:502});
      return new Response(fr.body, {
        status:200,
        headers:{'content-type':'text/html; charset=UTF-8','content-disposition':'inline','cache-control':'no-store, max-age=0'}
      });
    }

    if (request.method !== 'POST') {
      return response({
        ok: true,
        service: 'STUDY NOTES AI Router + Permanent Telegram Logs',
        endpoints: ['/health', '/ai', '/publish-owner', '/telegram-owner-test', '/view?file_id=...']
      }, 200, request, env);
    }

    try {
      const body = await request.json();

      // Existing AI endpoint — unchanged behavior.
      if (url.pathname === '/ai') {
        const prompt = String(body?.prompt || '').trim();
        const parts = Array.isArray(body?.parts) ? body.parts : [];
        const provider = ['auto', 'gemini', 'openai'].includes(body?.provider)
          ? body.provider
          : 'auto';
        const model = String(body?.model || '').trim();

        if (!prompt) {
          return response({ok:false, error:'prompt is required'}, 400, request, env);
        }

        let result;
        if (provider === 'gemini') {
          result = await callGemini(env, prompt, parts, model);
        } else if (provider === 'openai') {
          result = await callOpenAI(env, prompt, parts, model);
        } else {
          // Auto mode: run both providers in parallel and return the first
          // successful response.
          const jobs = [
            callGemini(env, prompt, parts, model),
            callOpenAI(env, prompt, parts, model)
          ];
          const wrapped = jobs.map(p =>
            Promise.resolve(p).then(
              v => ({ok:true, v}),
              e => ({ok:false, e})
            )
          );

          while (wrapped.length) {
            const winner = await Promise.race(wrapped);
            const index = wrapped.indexOf(winner);
            if (index >= 0) wrapped.splice(index, 1);
            if (winner.ok) {
              result = winner.v;
              break;
            }
          }

          if (!result) {
            throw new Error(
              'Both Gemini and OpenAI failed. Check Worker secrets, API access, model names and quota.'
            );
          }
        }

        return response({ok:true, ...result}, 200, request, env);
      }

      // Permanent owner logging: the site's users do NOT supply a Bot Token
      // or Channel ID. Those remain private Worker secrets.
      if (url.pathname === '/publish-owner') {
        const result = await publishOwnerMaterial(env, {...body, __workerOrigin: url.origin});
        return response(result, 200, request, env);
      }

      // Optional backend health/test endpoint. It sends only a small test
      // message to the fixed owner channel; no credentials are exposed.
      if (url.pathname === '/telegram-owner-test') {
        await telegramOwnerSendMessage(
          env,
          '✅ STUDY NOTES permanent Telegram backend test successful.'
        );
        return response({
          ok: true,
          sent: 'test-message'
        }, 200, request, env);
      }

      return response({ok:false, error:'Unknown endpoint.'}, 404, request, env);
    } catch (error) {
      return response(
        {ok:false, error: error?.message || 'Worker error'},
        500,
        request,
        env
      );
    }
  }
};
