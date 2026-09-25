export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ok:false, error:'Method not allowed'});

  const botUsername = String(process.env.TELEGRAM_GATE_BOT_USERNAME || '').trim().replace(/^@/, '');
  const channelUrl = String(process.env.TELEGRAM_GATE_CHANNEL_URL || '').trim();

  if (!botUsername || !channelUrl) {
    return res.status(500).json({
      ok:false,
      error:'Telegram gate is not configured. Add TELEGRAM_GATE_BOT_USERNAME and TELEGRAM_GATE_CHANNEL_URL in Vercel.'
    });
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ok:true, botUsername, channelUrl});
}
