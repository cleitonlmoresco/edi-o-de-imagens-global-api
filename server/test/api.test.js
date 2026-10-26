// Testes de fumaça da API. Rodam sem chaves de provedor: cobrem auth, validação
// de payload e detecção de formato — justamente as partes que já quebraram.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.APP_TOKEN = 'test-token';
process.env.RATE_LIMIT_PER_HOUR = '1000';

const { app, detectImageMime } = require('../index');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const WEBP_HEADER = Buffer.concat([
  Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 '),
]);

let server;
let base;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => new Promise((resolve) => server.close(resolve)));

test('detectImageMime reconhece PNG, JPEG, WebP e rejeita lixo', () => {
  assert.equal(detectImageMime(PNG_1X1), 'image/png');
  assert.equal(detectImageMime(JPEG_HEADER), 'image/jpeg');
  assert.equal(detectImageMime(WEBP_HEADER), 'image/webp');
  assert.equal(detectImageMime(Buffer.from('not an image')), null);
});

test('GET /healthz é público', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('GET /health exige token', async () => {
  const semToken = await fetch(`${base}/health`);
  assert.equal(semToken.status, 401);

  const comToken = await fetch(`${base}/health`, {
    headers: { 'x-app-token': 'test-token' },
  });
  assert.equal(comToken.status, 200);
  const body = await comToken.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.providers));
});

test('POST /api/remove-background exige token', async () => {
  const res = await fetch(`${base}/api/remove-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: PNG_1X1.toString('base64') }),
  });
  assert.equal(res.status, 401);
});

test('POST rejeita base64 inválido', async () => {
  const res = await fetch(`${base}/api/remove-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': 'test-token' },
    body: JSON.stringify({ imageBase64: 'não é base64 !!!' }),
  });
  assert.equal(res.status, 400);
});

test('POST rejeita conteúdo que não é imagem', async () => {
  const res = await fetch(`${base}/api/remove-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': 'test-token' },
    body: JSON.stringify({ imageBase64: Buffer.from('hello world').toString('base64') }),
  });
  assert.equal(res.status, 415);
});

test('POST rejeita corpo sem imageBase64', async () => {
  const res = await fetch(`${base}/api/remove-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-app-token': 'test-token' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});
