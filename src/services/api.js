const API_URL = process.env.EXPO_PUBLIC_API_URL;
const APP_TOKEN = process.env.EXPO_PUBLIC_APP_TOKEN;

export async function removeBackground(asset) {
  if (!API_URL || !APP_TOKEN) {
    throw new Error('EXPO_PUBLIC_API_URL ou EXPO_PUBLIC_APP_TOKEN não configurados no .env.');
  }

  if (!asset.base64) {
    throw new Error('A foto escolhida não tem dados em base64.');
  }

  const res = await fetch(`${API_URL}/api/remove-background`, {
    method: 'POST',
    headers: {
      'x-app-token': APP_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageBase64: asset.base64,
      mimeType: asset.mimeType || 'image/jpeg',
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Erro ${res.status}`);
  }
  return data;
}
