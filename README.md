# StudyNotesAI — Worker-only package

Files:
- index.html — frontend
- worker.js — single backend Worker (AI, health, Telegram publish, admin key storage)
- wrangler.jsonc — Worker config + existing KV namespace

Cloudflare Worker secrets:
- OWNER_ACCESS (optional; defaults to GOLU)
- TELEGRAM_BOT_TOKEN
- TELEGRAM_CHANNEL_ID
- OPENAI_API_KEY (optional)

Gemini keys are added from the page through /admin/config and stored in KV under gemini:keys.

Do not put real API keys or bot tokens in GitHub.
