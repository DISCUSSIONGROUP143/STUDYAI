STUDYAI FINAL SETUP

Files:
- STUDY-QUIZ-modes-both-fixed-v2-CLOUDFLARE-FINAL.html
- study-notes-ai-router-worker-permanent-logs-open-html.js
- wrangler.jsonc

Fixed:
1) Old studynotesai.sandeepsheoran.workers.dev URL removed from the HTML; backend URL uses the current site origin.
2) Gemini supports multiple backend-stored keys in KV and tries them sequentially when a key fails.
3) Owner Access can add Gemini keys from the page. Password: GOLU. Keys are stored in KV under gemini:keys and are not placed in HTML/localStorage.

KV:
Binding: KV
Namespace ID: 1d13906a6c374943833c79fec08bbf79

Worker secrets (Telegram/OpenAI):
TELEGRAM_BOT_TOKEN
TELEGRAM_LOG_CHAT_ID
OPENAI_API_KEY (optional)

Deploy the Worker/Pages backend according to your Cloudflare project setup. Do not put API keys into wrangler.jsonc.
