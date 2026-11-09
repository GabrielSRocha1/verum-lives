# Deploy na Vercel

O site roda na Vercel através do adaptador `api/index.js` + `vercel.json`
(toda rota é atendida pela função; arquivos de `public/` são servidos como estáticos).

## Variáveis de ambiente necessárias (Settings → Environment Variables)

| Variável | Observação |
|---|---|
| `DATA_ENCRYPTION_KEY` | gere com `npm run keys:generate` |
| `INDEX_KEY` | idem |
| `APP_SECRET` | idem |
| `GOOGLE_SHEETS_WEBAPP_URL` | URL `/exec` do Web App do Apps Script |
| `GOOGLE_SHEETS_SECRET` | mesmo segredo configurado no script |
| `BASE_URL` | ex.: `https://verum-lives.vercel.app` (ou o domínio próprio) |
| `TRUST_PROXY` | `1` |

## Limitações do modo serverless

- **SQLite efêmero**: o banco vive em `/tmp` e é descartado quando a instância
  recicla. A fonte durável dos cadastros é a **planilha Google** (integração
  `google-sheets`). O painel admin e as estatísticas não são confiáveis aqui.
- **Sem lembretes**: o despachante fica desligado (`DISPATCHER_ENABLED=0`,
  padrão do adaptador) — não há processo contínuo em serverless.
- **Upload de foto do apresentador** não persiste.

Para o backend completo (admin, lembretes por e-mail/WhatsApp, banco durável),
use a implantação tradicional desta pasta (`Dockerfile`/`docker-compose.yml`
ou `verum-lives.service` + `Caddyfile`) num VPS.
