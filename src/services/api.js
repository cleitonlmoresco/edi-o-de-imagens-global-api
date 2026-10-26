const API_URL = process.env.EXPO_PUBLIC_API_URL;
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN;
const TIMEOUT_MS = 60000;

export async function removeBackground(asset) {
  if (!API_URL || !APP_TOKEN) {
    throw new Error('EXPO_PUBLIC_API_URL ou EXPO_PUBLIC_APP_TOKEN não configurados no .env.');
  }

  if (!asset?.base64) {
    throw new Error('A foto escolhida não tem dados em base64.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_URL}/api/remove-background`, {
      method: 'POST',
      headers: {
        'x-app-token': APP_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageBase64: asset.base64 }),
      signal: controller.signal,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erro ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('O servidor demorou demais para responder. Tente novamente.');
    }
    if (err instanceof TypeError) {
      throw new Error('Não foi possível conectar ao servidor. Verifique EXPO_PUBLIC_API_URL.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
