require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_LIMIT = Number(process.env.CACHE_LIMIT) || 200;
const CACHE_MAX_BYTES = (Number(process.env.CACHE_MAX_MB) || 64) * 1024 * 1024;
const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB) || 10;
const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
const JSON_LIMIT = process.env.JSON_LIMIT || '14mb';
const PROVIDER_TIMEOUT_MS = Number(process.env.PROVIDER_TIMEOUT_MS) || 45000;
const APP_TOKEN = process.env.APP_TOKEN;

if (!APP_TOKEN) {
  console.error('APP_TOKEN não definido. Configure no server/.env antes de iniciar.');
  process.exit(1);
}

function tokenMatches(received) {
  const a = Buffer.from(received || '');
  const b = Buffer.from(APP_TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAppToken(req, res, next) {
  if (!tokenMatches(req.get('x-app-token'))) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
  next();
}

const limiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_PER_HOUR) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de requisições atingido. Tente mais tarde.' },
});

const cache = new Map();
let cacheBytes = 0;

// LRU real: ao acertar, a entrada vai para o fim. Além da quantidade,
// respeita um orçamento de bytes (imagens em base64 podem ter ~13 MB cada).
function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key, value) {
  const size = Buffer.byteLength(value.image);
  if (size > CACHE_MAX_BYTES) return;
  if (cache.has(key)) {
    cacheBytes -= Buffer.byteLength(cache.get(key).image);
    cache.delete(key);
  }
  while (cache.size > 0 && (cache.size >= CACHE_LIMIT || cacheBytes + size > CACHE_MAX_BYTES)) {
    const oldest = cache.keys().next().value;
    cacheBytes -= Buffer.byteLength(cache.get(oldest).image);
    cache.delete(oldest);
  }
  cache.set(key, value);
  cacheBytes += size;
}

class ProviderError extends Error {
  constructor(provider, status, detail) {
    super(`${provider} respondeu ${status}: ${detail}`);
    this.status = status;
  }
}

const providers = {
  photoroom: {
    enabled: () => Boolean(process.env.PHOTOROOM_API_KEY),
    async removeBackground(buffer, mime) {
      const key = process.env.PHOTOROOM_API_KEY;
      const isSandbox = process.env.PHOTOROOM_SANDBOX === 'true';
      const apiKey = isSandbox && !key.startsWith('sandbox_') ? `sandbox_${key}` : key;
      const form = new FormData();
      form.append('image_file', new Blob([buffer], { type: mime }), 'image');
      const res = await fetch('https://sdk.photoroom.com/v1/segment', {
        method: 'POST',
        headers: { 'x-api-key': apiKey },
        body: form,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      return res;
    },
  },
  removebg: {
    enabled: () => Boolean(process.env.REMOVEBG_API_KEY),
    async removeBackground(buffer, mime) {
      const form = new FormData();
      form.append('image_file', new Blob([buffer], { type: mime }), 'image');
      form.append('size', 'auto');
      const res = await fetch('https://api.remove.bg/v1.0/removebg', {
        method: 'POST',
        headers: { 'X-Api-Key': process.env.REMOVEBG_API_KEY },
        body: form,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      return res;
    },
  },
  clipdrop: {
    enabled: () => Boolean(process.env.CLIPDROP_API_KEY),
    async removeBackground(buffer, mime) {
      const form = new FormData();
      form.append('image_file', new Blob([buffer], { type: mime }), 'image');
      const res = await fetch('https://clipdrop-api.co/remove-background/v1', {
        method: 'POST',
        headers: { 'x-api-key': process.env.CLIPDROP_API_KEY, accept: 'image/png' },
        body: form,
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      });
      return res;
    },
  },
};

const ORDER = (process.env.PROVIDER_ORDER || 'photoroom,removebg,clipdrop')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const FALLBACK_STATUSES = new Set([401, 402, 403, 429, 500, 502, 503]);

async function removeBackgroundWithFallback(buffer, mime) {
  const errors = [];
  for (const name of ORDER) {
    const provider = providers[name];
    if (!provider || !provider.enabled()) continue;
    try {
      const res = await provider.removeBackground(buffer, mime);
      if (res.ok) {
        return { provider: name, image: Buffer.from(await res.arrayBuffer()) };
      }
      const detail = (await res.text()).slice(0, 200);
      const err = new ProviderError(name, res.status, detail);
      errors.push(err.message);
      if (!FALLBACK_STATUSES.has(res.status)) break;
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
    }
  }
  const msg = errors.length ? errors.join(' | ') : 'Nenhum provedor configurado';
  throw new Error(msg);
}

const app = express();
app.disable('x-powered-by');
// Só confie em X-Forwarded-For quando estiver atrás de um proxy conhecido;
// caso contrário, dá para burlar o rate limit falsificando o header.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}
app.use(express.json({ limit: JSON_LIMIT }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/health', requireAppToken, (_req, res) => {
  const configured = ORDER.filter((name) => providers[name] && providers[name].enabled());
  res.json({
    ok: true,
    providers: configured,
    cacheSize: cache.size,
    cacheBytes,
    maxImageMb: MAX_IMAGE_MB,
  });
});

function detectImageMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

app.post(
  '/api/remove-background',
  requireAppToken,
  limiter,
  async (req, res) => {
  const { imageBase64 } = req.body || {};
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    return res.status(400).json({ error: 'Envie a imagem em base64 no campo "imageBase64".' });
  }

  // Aceita data URI ("data:image/png;base64,...") além do base64 puro.
  const payload = imageBase64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '');
  if (!/^[A-Za-z0-9+/=\s]+$/.test(payload)) {
    return res.status(400).json({ error: 'Base64 inválido.' });
  }

  const input = Buffer.from(payload, 'base64');
  if (input.length === 0) {
    return res.status(400).json({ error: 'Imagem vazia.' });
  }
  if (input.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: `Imagem muito grande (máximo ${MAX_IMAGE_MB} MB).` });
  }

  const mime = detectImageMime(input);
  if (!mime) {
    return res.status(415).json({ error: 'Formato não suportado. Envie PNG, JPEG ou WebP.' });
  }

  const hash = crypto.createHash('sha256').update(input).digest('hex');
  const cached = cacheGet(hash);
  if (cached) {
    return res.json({ provider: cached.provider, cached: true, image: cached.image });
  }

  try {
    const { provider, image } = await removeBackgroundWithFallback(input, mime);
    const dataUri = `data:image/png;base64,${image.toString('base64')}`;
    cacheSet(hash, { provider, image: dataUri });
    return res.json({ provider, cached: false, image: dataUri });
  } catch (err) {
    console.error('[remove-background]', err.message);
    return res.status(503).json({
      error: 'Nenhum provedor conseguiu processar a imagem.',
      detalhe: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
});

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: `Imagem muito grande (máximo ${MAX_IMAGE_MB} MB).` });
  }
  if (err.expose && err.status) {
    return res.status(err.status).json({ error: 'Requisição inválida.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`Proxy rodando em http://localhost:${PORT}`);
  });
  const encerrar = () => server.close(() => process.exit(0));
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

module.exports = { app, detectImageMime };
