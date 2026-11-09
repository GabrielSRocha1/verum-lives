# Verum Lives — BITCOIN: OURO DIGITAL!

Landing page de inscrição das transmissões ao vivo do **Canal Verum Cripto**, com backend próprio, lembretes automáticos (e-mail via Brevo e WhatsApp via API oficial), integração com n8n, rastreamento de campanhas e painel administrativo.

```
VÍDEO → LANDING PAGE → INSCRIÇÃO → CONFIRMAÇÃO → GRUPO WHATSAPP → LEMBRETES → LIVE
```

- **Zero dependências de produção**: Node.js 22 (`node:http`, `node:sqlite`, `node:crypto`, `fetch`). Nada de pacotes de terceiros no servidor.
- **Páginas autocontidas**: HTML + CSS + JS embutidos, sem CDN de layout (Google Fonts só como melhoria progressiva). Arte em SVG vetorial — sem imagens pesadas.
- **Testado**: 54 testes automatizados de API/unidade + 40 verificações de navegador (celular e desktop).

## Início rápido (desenvolvimento)

```bash
npm start                                   # http://localhost:3000  (chaves de dev geradas em data/.dev-keys.json)
ADMIN_PASSWORD='Sua-Senha-Forte-2026' npm run admin:create -- voce@email.com
# painel: http://localhost:3000/admin
npm test                                    # testes de unidade e API ponta a ponta
npm i -D playwright && npx playwright install chromium && npm run test:browser
```

## Produção (VPS Ubuntu + Caddy)

1. `git clone`/copiar para `/opt/verum-lives`, criar usuário `verum` e `/var/lib/verum-lives` (dono `verum`, modo 700).
2. `cp .env.example .env` e preencher. Gerar chaves: `npm run keys:generate` (**guarde-as fora do servidor também** — sem `DATA_ENCRYPTION_KEY` os dados pessoais ficam ilegíveis).
3. Criar o administrador: `npm run admin:create -- voce@email.com` (a senha é pedida sem eco).
4. `deploy/verum-lives.service` → `/etc/systemd/system/` e `systemctl enable --now verum-lives`.
5. `deploy/Caddyfile` → ajustar domínio. O Caddy emite o HTTPS automaticamente.
6. Backup diário: `deploy/backup.sh` no cron (cópia online e consistente do SQLite).

Alternativa: `docker compose -f deploy/docker-compose.yml up -d`.

Em produção, o app **não inicia** sem as três chaves (fail-closed) e confia em `X-Forwarded-For` apenas com `TRUST_PROXY=1` (atrás do Caddy).

## O que configurar no painel (`/admin`)

| Aba | O quê |
|---|---|
| Lives e links | Dias, horário, fuso, nome do fuso exibido, duração, **link do canal do YouTube**, link da transmissão, **convite do grupo do WhatsApp** |
| Lembretes | Seis etapas (imediato, 3 dias, 1 dia, 3 h, 30 min, início): liga/desliga, antecedência, canais, assunto/texto do e-mail, modelo do WhatsApp; botão de e-mail de teste |
| Marketing | Meta Pixel, GA4, GTM e aceite de cookies |
| Apresentador | Foto (recortada 4:5 e convertida em WebP no navegador antes do envio) |
| Inscritos | Busca, filtro por campanha, exportação CSV, exclusão LGPD |
| Integrações | Status de Brevo/WhatsApp/n8n/Turnstile, envios por canal, falhas, próximos disparos |
| Auditoria | Logins, exportações, exclusões e alterações |

Perfis: **admin** (tudo) e **viewer** (apenas indicadores agregados, sem dados pessoais): `npm run admin:create -- email viewer`.

## Integrações

### Brevo
- `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (remetente validado na Brevo), `BREVO_LIST_ID` (lista de inscritos).
- Webhook (descadastro, bounce, spam): `https://SEU_DOMINIO/api/webhooks/brevo/<BREVO_WEBHOOK_TOKEN>`.
- Todo e-mail sai com link de descadastro e cabeçalhos `List-Unsubscribe` + one-click (exigência Gmail/Yahoo).

### WhatsApp Business Cloud API (oficial)
- `WHATSAPP_TOKEN` (token permanente de usuário do sistema), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- Webhook no app da Meta: `https://SEU_DOMINIO/api/webhooks/whatsapp` (assinatura `X-Hub-Signature-256` verificada). Campos: `messages`.
- Responder **SAIR / PARAR / STOP** revoga o consentimento de WhatsApp (inclui números brasileiros com ou sem o 9º dígito).
- Mensagens iniciadas pela empresa **exigem modelos aprovados**. Sugestões para cadastrar na Meta (idioma `pt_BR`) — as variáveis já vêm configuradas nesta ordem no painel:

| Etapa | Nome sugerido | Texto do modelo |
|---|---|---|
| Confirmação | `confirmacao_inscricao` | Olá, {{1}}! Sua inscrição nas lives BITCOIN: OURO DIGITAL! está confirmada. A próxima transmissão é em {{2}}, às {{3}}. Responda SAIR para não receber mais avisos. |
| 1 dia antes | `lembrete_live_d1` | {{1}}, é amanhã! Live BITCOIN: OURO DIGITAL! em {{2}}, às {{3}}. Responda SAIR para parar. |
| 30 min antes | `lembrete_live_30min` | {{1}}, faltam 30 minutos para a live! Assista aqui: {{2}} |
| Início | `live_ao_vivo` | {{1}}, estamos AO VIVO agora: {{2}} |

Enquanto um modelo não estiver preenchido, o envio daquela etapa é **registrado como ignorado** (visível em Integrações) — nada é simulado.

### n8n
Eventos `subscriber.created`, `subscriber.updated`, `subscriber.unsubscribed`, `subscriber.erased` via `POST N8N_WEBHOOK_URL`:

```json
{ "event": "subscriber.created", "sent_at": "ISO-8601",
  "data": { "id": "uuid", "name": "...", "email": "...", "whatsapp": "+55...", "country": "BR",
            "consents": { "email": true, "whatsapp": true, "version": "2026-11-v1" },
            "attribution": { "origin": "instagram", "utm_source": "...", "utm_campaign": "..." },
            "created_at": "ISO-8601" } }
```

Cabeçalhos: `X-Verum-Token` (use a autenticação **Header Auth** do nó Webhook), `X-Verum-Signature: sha256=HMAC(segredo, "<timestamp>.<corpo>")` e `X-Verum-Timestamp`. Os lembretes são enviados pelo próprio backend (com retentativa e controle de consentimento); o n8n recebe os eventos para CRM, planilhas ou fluxos próprios.

### Rastreamento
- **PageView** ao abrir a landing; **CompleteRegistration** (Meta), **sign_up** (GA4) e **complete_registration** (dataLayer/GTM) **somente** na página de confirmação de uma inscrição **nova**, uma única vez (recarregar não repete), com `eventID` = id do inscrito para deduplicação com a API de Conversões.
- Consent Mode v2 do Google; o Meta Pixel só carrega após “Aceitar” no aviso de cookies.
- UTMs, `fbclid`, `gclid` e `ttclid` capturados no primeiro toque (30 dias) e gravados na inscrição.

### Cloudflare Turnstile (opcional)
Preencha `TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` para somar um desafio invisível ao antispam (token de formulário assinado, tempo mínimo de preenchimento, honeypot e limite por IP já estão ativos).

## Testes

| Comando | Cobertura |
|---|---|
| `npm test` | 54 testes: validação, fuso/agenda (incl. horário de verão), criptografia, CSV, inscrição ponta a ponta com provedores simulados (Brevo, WhatsApp, n8n), deduplicação, antispam, conversão única, lembretes (horários, consentimento, retentativa, expiração, mudança de agenda), descadastro, webhooks, painel (sessão, CSRF, papéis, bloqueio, exportação, exclusão, upload) |
| `npm run test:browser` | 40 verificações no Chromium (iPhone 13 e desktop): CSP sem violações, sem erros JS, sem rolagem horizontal, alvos de toque ≥ 48 px, contador, máscara, sugestão de e-mail, inscrição real, redirecionamento, Pixel/GA4, conversão única, botão do grupo, envios, painel. Gera capturas em `docs/screenshots/` |

Arquitetura, modelo de dados e segurança: [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Pendências que dependem de você

1. **Link do canal do YouTube** e **convite do grupo do WhatsApp** — cadastrar no painel (sem o convite, a confirmação mostra um aviso em vez de um botão sem ação).
2. **Foto do apresentador em boa resolução** — no vídeo ela só aparece dentro do cartaz; até o upload, a página usa o monograma “AR”.
3. **Modelos do WhatsApp aprovados pela Meta** (sugestões acima).
4. Domínio, chaves da Brevo/Meta/n8n no `.env`.
5. Agenda configurada em **terça e quinta às 19h (horário de Brasília)**, conforme o vídeo. O horário 19h26 do cartaz inicial **não** foi usado.
