STUDYAI FINAL SETUP

AI:
- Gemini only.
- The Gemini API key is entered by the user in the page.
- The key is kept only in page memory and is never saved to localStorage, sessionStorage, KV, or the backend.
- No OpenAI/ChatGPT backend or fallback is used.

TELEGRAM LOGS:
- TELEGRAM_BOT_TOKEN
- TELEGRAM_LOG_CHAT_ID
- /publish-owner sends generated test text and HTML to the configured Telegram Logs chat/channel.

CLOUDFLARE PAGES:
- functions/[[path]].js is used only for Telegram Logs and the health check.
- No KV binding is required.
- No Gemini API key is stored server-side.
- Do not put secrets into wrangler.jsonc.
