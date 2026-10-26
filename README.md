# Media Studio App

App Expo (React Native) que remove o fundo de fotos usando um proxy Node/Express.
As chaves dos provedores ficam **somente no servidor** — o app nunca as recebe.

```
media-studio-app/
├── App.js                  # tela principal (escolher foto / remover fundo)
├── src/services/api.js     # chamada ao proxy (timeout de 60 s)
├── .github/workflows/ci.yml # workflow de CI (testes, lint e expo-doctor)
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
# Na raiz: roda os testes do servidor
npm test

# Direto no servidor
cd server
npm test

# Auditoria das dependências de produção
npm run audit

# Lint do app (JavaScript/React Native)
npm run lint

# Diagnóstico de dependências/configuração do Expo
npx expo-doctor
```

Os testes sobem o Express em uma porta aleatória e cobrem autenticação por
token, cabeçalhos de segurança do `helmet`, validação de base64, detecção de
formato por magic bytes, rejeição de conteúdo que não é imagem e resposta 404
em JSON. Não precisam de chaves reais.

## Qualidade e CI

O workflow está em `.github/workflows/ci.yml`. Ele roda os testes do servidor em
Node 20, 22 e 24, a auditoria de dependências, o lint do app e o `expo-doctor`.

## Segurança

- Nunca coloque chaves de provedor em variáveis `EXPO_PUBLIC_*` — elas vão para
  o bundle do app. Só `EXPO_PUBLIC_API_URL` e `EXPO_PUBLIC_APP_TOKEN` são usadas
  no cliente.
- O token do app é comparado em tempo constante e é uma barreira simples contra
  uso casual; para produção, coloque o proxy atrás de HTTPS e de um proxy
  reverso.
- O `helmet` envia `X-Content-Type-Options`, `X-Frame-Options`, CSP, HSTS (sob
  HTTPS) e remove o `X-Powered-By`.
- `/healthz` responde sem cache e sem exigir token; `/health` exige o token.
- `.env` e `server/.env` são ignorados pelo Git.

## Limitações conhecidas

- `npm audit` na raiz reporta avisos altos em dependências transitivas do
  **Expo CLI** (`zod` e `node-forge`). Elas fazem parte do ferramental de build,
  não do proxy, e serão corrigidas quando o Expo atualizar. **Não rode
  `npm audit fix --force`**: ele sugere um downgrade para o Expo 44 e quebra o
  projeto. O servidor tem 0 vulnerabilidades conhecidas (`npm run audit`).
- O `expo-doctor` pode pedir atualização de pacotes quando sair uma versão nova
  do SDK. Rode `npx expo install --fix` e valide novamente.
