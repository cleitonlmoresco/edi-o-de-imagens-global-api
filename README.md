# Media Studio App

App Expo (React Native) que remove o fundo de fotos usando um proxy Node/Express.
As chaves dos provedores ficam **somente no servidor** — o app nunca as recebe.

```
media-studio-app/
├── App.js                  # tela principal (escolher foto / remover fundo)
├── src/services/api.js     # chamada ao proxy (timeout de 60 s)
└── server/
    ├── index.js            # proxy com fallback entre provedores
    ├── .env.example        # modelo de configuração
    └── test/api.test.js    # testes do servidor
```

## Requisitos

- Node.js 20+ (testado com 24)
- Conta/chave em pelo menos um dos provedores: Photoroom, remove.bg ou Clipdrop
- Para rodar no celular: Expo Go compatível com o SDK 58

## 1. Configurar e subir o servidor

```bash
cd server
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Edite `server/.env`:

- `APP_TOKEN`: obrigatório. Gere com
  `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`
- Preencha a chave de pelo menos um provedor (`PHOTOROOM_API_KEY`,
  `REMOVEBG_API_KEY` ou `CLIPDROP_API_KEY`)

```bash
npm start
```

O servidor sobe em `http://localhost:3000`. Teste:

```bash
curl http://localhost:3000/healthz
curl -H "x-app-token: SEU_TOKEN" http://localhost:3000/health
```

`/health` mostra quais provedores estão configurados, o tamanho do cache e o
limite de imagem.

Variáveis de ambiente do servidor:

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3000` | Porta do proxy. |
| `APP_TOKEN` | — | Token compartilhado com o app. Sem ele o servidor não inicia. |
| `RATE_LIMIT_PER_HOUR` | `30` | Requisições por IP por hora. |
| `PROVIDER_ORDER` | `photoroom,removebg,clipdrop` | Ordem de tentativa/fallback. |
| `MAX_IMAGE_MB` | `10` | Tamanho máximo da imagem. |
| `CACHE_LIMIT` | `200` | Máximo de entradas no cache. |
| `CACHE_MAX_MB` | `64` | Orçamento de memória do cache. |
| `PROVIDER_TIMEOUT_MS` | `45000` | Timeout de cada provedor. |
| `TRUST_PROXY` | desligado | Habilite só atrás de proxy reverso conhecido. |

## 2. Configurar o app

Na raiz do projeto, crie `.env`:

```bash
EXPO_PUBLIC_API_URL=http://192.168.0.10:3000
EXPO_PUBLIC_APP_TOKEN=o-mesmo-token-do-servidor
```

> No celular físico, `localhost` aponta para o próprio celular. Use o IP da
> máquina na rede local (ex.: `http://192.168.0.10:3000`) e libere a porta 3000
> no firewall. No emulador Android, use `http://10.0.2.2:3000`.

```bash
npm install
npx expo start
```

## Testes

```bash
cd server
npm test
```

Os testes sobem o Express em uma porta aleatória e cobrem autenticação por
token, validação de base64, detecção de formato por magic bytes e rejeição de
conteúdo que não é imagem. Não precisam de chaves reais.

## Segurança

- Nunca coloque chaves de provedor em variáveis `EXPO_PUBLIC_*` — elas vão para
  o bundle do app. Só `EXPO_PUBLIC_API_URL` e `EXPO_PUBLIC_APP_TOKEN` são usadas
  no cliente.
- O token do app é uma barreira simples contra uso casual; para produção,
  coloque o proxy atrás de HTTPS e de um proxy reverso.
- `.env` e `server/.env` são ignorados pelo Git.
