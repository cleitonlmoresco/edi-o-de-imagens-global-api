require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

const PORT = Number(process.env.PORT) || 3000;
const CACHE_LIMIT = 200;
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

function cacheGet(key) {
  return cache.get(key) || null;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, value);
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
app.set('trust proxy', 1);
app.use(express.json({ limit: '15mb' }));

app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

app.get('/health', requireAppToken, (_req, res) => {
  const configured = ORDER.filter((name) => providers[name] && providers[name].enabled());
  res.json({ ok: true, providers: configured, cacheSize: cache.size });
});

app.post(
  '/api/remove-background',
  requireAppToken,
  limiter,
  async (req, res) => {
  const { imageBase64, mimeType } = req.body || {};
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    return res.status(400).json({ error: 'Envie a imagem em base64 no campo "imageBase64".' });
  }

  const input = Buffer.from(imageBase64, 'base64');
  const hash = crypto.createHash('sha256').update(input).digest('hex');
  const cached = cacheGet(hash);
  if (cached) {
    return res.json({ provider: cached.provider, cached: true, image: cached.image });
  }

  try {
    const { provider, image } = await removeBackgroundWithFallback(
      input,
      typeof mimeType === 'string' ? mimeType : 'image/jpeg'
    );
    const dataUri = `data:image/png;base64,${image.toString('base64')}`;
    cacheSet(hash, { provider, image: dataUri });
    return res.json({ provider, cached: false, image: dataUri });
  } catch (err) {
    return res.status(503).json({ error: err.message });
  }
});

app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Imagem muito grande (máximo 10 MB).' });
  }
  if (err.expose && err.status) {
    return res.status(err.status).json({ error: 'Requisição inválida.' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Erro interno.' });
});

app.listen(PORT, () => {
  console.log(`Proxy rodando em http://localhost:${PORT}`);
});
