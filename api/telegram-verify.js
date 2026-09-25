const textEncoder = new TextEncoder();
const JWKS_URL = 'https://oauth.telegram.org/.well-known/jwks.json';
const TELEGRAM_ISSUER = 'https://oauth.telegram.org';
let jwksCache = null;
let jwksCacheAt = 0;

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64UrlBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

function decodePart(part) {
  return JSON.parse(base64UrlDecode(part));
}

async function getJwks() {
  const now = Date.now();
  if (jwksCache && now - jwksCacheAt < 10 * 60 * 1000) return jwksCache;
  const response = await fetch(JWKS_URL, { cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(data.keys)) throw new Error('Telegram signing keys unavailable.');
  jwksCache = data;
  jwksCacheAt = now;
  return data;
}

async function verifyTelegramIdToken(idToken, expectedNonce, clientId) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('Invalid Telegram ID token.');

  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== 'RS256' || !header.kid) throw new Error('Unsupported Telegram ID token.');
  if (claims.iss !== TELEGRAM_ISSUER) throw new Error('Telegram ID token issuer invalid.');

  const audOk = Array.isArray(claims.aud) ? claims.aud.map(String).includes(clientId) : String(claims.aud) === clientId;
  if (!audOk) throw new Error('Telegram ID token audience invalid.');

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) < now) throw new Error('Telegram ID token expired.');
  if (Number.isFinite(Number(claims.iat)) && Number(claims.iat) > now + 300) throw new Error('Telegram ID token time invalid.');
  if (expectedNonce && String(claims.nonce || '') !== String(expectedNonce)) throw new Error('Telegram login nonce invalid.');

  const jwks = await getJwks();
  const jwk = jwks.keys.find(key => key.kid === header.kid);
  if (!jwk) {
    jwksCache = null;
    const refreshed = await getJwks();
    const retryKey = refreshed.keys.find(key => key.kid === header.kid);
    if (!retryKey) throw new Error('Telegram signing key not found.');
    return verifySignature(retryKey, parts, claims);
  }
  return verifySignature(jwk, parts, claims);
}

async function verifySignature(jwk, parts, claims) {
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const signingInput = textEncoder.encode(`${parts[0]}.${parts[1]}`);
  const signature = base64UrlBytes(parts[2]);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signingInput);
  if (!valid) throw new Error('Telegram ID token signature invalid.');
  return claims;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const token = String(process.env.TELEGRAM_GATE_BOT_TOKEN || '').trim();
  const chatId = String(process.env.TELEGRAM_GATE_CHAT_ID || '').trim();
  const clientId = String(process.env.TELEGRAM_LOGIN_CLIENT_ID || '').trim();

  if (!token || !chatId || !clientId) {
    return res.status(500).json({
      ok: false,
      member: false,
      error: 'TELEGRAM_GATE_BOT_TOKEN, TELEGRAM_GATE_CHAT_ID or TELEGRAM_LOGIN_CLIENT_ID is not configured.'
    });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const idToken = String(body.id_token || '').trim();
    const nonce = String(body.nonce || '').trim();
    const claims = await verifyTelegramIdToken(idToken, nonce, clientId);

    const userId = String(claims.id || claims.sub || '').trim();
    if (!/^\d+$/.test(userId)) {
      return res.status(401).json({ ok:false, member:false, error:'Telegram user ID missing from verified token.' });
    }

    const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(userId)}`;
    const tg = await fetch(url);
    const data = await tg.json().catch(() => ({}));

    if (!tg.ok || data.ok !== true) {
      return res.status(502).json({
        ok: false,
        member: false,
        error: data.description || 'Telegram membership check failed.'
      });
    }

    const member = data.result || {};
    const joined =
      member.status === 'creator' ||
      member.status === 'administrator' ||
      member.status === 'member' ||
      (member.status === 'restricted' && member.is_member === true);

    if (!joined) {
      return res.status(403).json({
        ok: true,
        member: false,
        status: member.status || 'left',
        error: 'Telegram channel join नहीं मिला। पहले channel join करें, फिर Verify करें।'
      });
    }

    return res.status(200).json({
      ok: true,
      member: true,
      status: member.status,
      user: {
        id: userId,
        name: claims.name || '',
        username: claims.preferred_username || ''
      }
    });
  } catch (error) {
    return res.status(401).json({
      ok: false,
      member: false,
      error: error?.message || 'Telegram verification failed.'
    });
  }
}
