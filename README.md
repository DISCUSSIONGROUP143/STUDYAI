# StudyAI

## Final architecture

- **AI:** Gemini only.
- **Gemini API key:** entered manually; kept in page memory only; never stored in browser storage, KV, or backend.
- **Telegram Logs:** handled server-side by the Cloudflare Pages Function using `TELEGRAM_BOT_TOKEN` and `TELEGRAM_LOG_CHAT_ID`.
- **KV:** not used.
- **OpenAI/ChatGPT:** not used.

## Cloudflare secrets

Set these as Cloudflare environment secrets/variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_LOG_CHAT_ID`

Do not put secrets in the HTML or wrangler configuration.
