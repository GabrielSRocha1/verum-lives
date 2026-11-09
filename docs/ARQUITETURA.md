# Arquitetura — Verum Lives

## Visão geral

```
Navegador (landing autocontida)
   │  GET /            → HTML com nonce de CSP, agenda calculada no servidor, token de formulário assinado
   │  POST /api/public/visit     (sendBeacon, visitante único/dia, sem dados pessoais)
   │  POST /api/public/register  (JSON + Idempotency-Key)
   ▼
Node 22 (processo único, sem dependências)
   ├─ routes/        public · admin · webhooks
   ├─ services/      registration · antispam · reminders (dispatcher) · live · stats · auth · events
   ├─ channels/      email-brevo · whatsapp-cloud          ← canais de envio (Open/Closed)
   ├─ integrations/  brevo-contacts · n8n                  ← assinantes do barramento de eventos (Open/Closed)
   ├─ settings/      padrões + validação das configurações do painel
   ├─ repositories/  subscribers (criptografia de campo)
   └─ db/            SQLite (node:sqlite, WAL) com migrações versionadas
          ▲
Caddy (HTTPS automático, compressão) → 127.0.0.1:3000
```

## Fluxo da inscrição

1. **Antispam**: limite por IP → honeypot (descarte silencioso) → token de formulário assinado (HMAC, finalidade `form`, idade mínima 2,5 s e máxima 6 h) → Turnstile (se configurado) → origem (`Origin`) permitida.
2. **Validação no servidor**: nome completo, e-mail (formato + DNS MX/A em produção), WhatsApp por país (regras para BR com DDD, PY, US/CA, PT; genérico E.164 nos demais).
3. **Gravação idempotente** em transação: a chave é o índice cego do e-mail. Reinscrição atualiza contato e consentimentos (vale a manifestação mais recente), preserva a origem original e não gera nova conversão.
4. **Confirmação**: a fila `deliveries` recebe a etapa `confirmation` por canal autorizado (única por canal).
5. **Eventos** `subscriber.created/updated` → Brevo (lista) e n8n, em segundo plano e isolados de falhas.
6. **Redirecionamento** para `/confirmacao?c=<token>` (assinado, 2 h). A página marca a conversão de forma atômica (`conversion_fired_at`) e só então injeta o disparo do CompleteRegistration.

## Lembretes

- A agenda (dias, hora, fuso IANA, duração) gera as ocorrências em tempo real — mudar a agenda no painel reprograma tudo sem migração.
- A cada 30 s o dispatcher **materializa** cada par (ocorrência × etapa) cujo horário chegou, uma única vez (`reminder_runs`), para inscritos com consentimento no canal e `created_at ≤ horário da etapa`.
- Janela de tolerância de 20 min: se o servidor ficou fora do ar, lembretes atrasados não são disparados.
- Envio com até 4 tentativas (backoff 1/5/15/30 min) para erros temporários (rede, 5xx, 429); 4xx não repete. Mensagens vencidas (ex.: aviso de 30 min após o início) são descartadas como `expirado`.
- Consentimento é revalidado no momento do envio. Descadastro por link, one-click (RFC 8058), resposta “SAIR” no WhatsApp ou webhook da Brevo.
- Padrão de canais por etapa (editável): e-mail em confirmação/3 dias/1 dia/3 h/30 min; WhatsApp em confirmação/1 dia/30 min/início. Com duas lives por semana, a sequência completa em todos os canais somaria 12 mensagens por semana por canal — o padrão reduz o volume no WhatsApp para proteger a qualidade do número na Meta.

## Modelo de dados (SQLite)

| Tabela | Conteúdo |
|---|---|
| `subscribers` | `name_enc`, `email_enc`, `phone_enc` (AES-256-GCM), `email_idx`/`phone_idx` (HMAC), consentimentos com data e versão do texto, hash do IP do consentimento, UTMs/clids, origem, datas, `conversion_fired_at`, `deleted_at` |
| `deliveries` | fila/histórico de envios: etapa, canal, ocorrência, status, tentativas, erro, id do provedor e status de entrega (WhatsApp) |
| `reminder_runs` | controle de “já materializado” por ocorrência/etapa |
| `visits` | visitante único por dia + campanha (para taxa de conversão) |
| `settings` | configurações do painel (JSON validado) |
| `admins`, `sessions` | usuários (scrypt, bloqueio), sessões (hash do token + CSRF) |
| `audit_log` | trilha de ações administrativas |

## Segurança

- **Dados pessoais criptografados em repouso** (AES-256-GCM com IV aleatório); buscas exatas por índice cego HMAC; IP nunca armazenado em claro.
- **Chaves só no servidor** (`.env`); nenhuma credencial chega ao navegador. Produção sem chaves não inicia.
- **CSP estrita** por requisição com nonce + `strict-dynamic`; domínios de terceiros liberados apenas quando a integração está configurada; `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP.
- **Painel**: cookie `__Host-` HttpOnly/Secure/SameSite=Strict, token CSRF por sessão, verificação de `Origin`, bloqueio de 15 min após 5 falhas, limite por IP, sessão de 12 h, papéis admin/viewer, auditoria de visualização, exportação e exclusão.
- **Uploads**: validação por assinatura de arquivo (WebP/JPEG/PNG), nome derivado do hash, 2 MB.
- **Webhooks**: assinatura HMAC (WhatsApp), token (Brevo), HMAC de saída (n8n).
- **CSV** com proteção contra injeção de fórmulas.
- Arquivos estáticos com bloqueio de path traversal e de arquivos ocultos.

## Pontos de extensão (Open/Closed)

- **Novo canal de envio** (ex.: Telegram, SMS): criar `src/channels/<canal>.js` com `{ name, label, consentField, status(), send() }` e registrá-lo em `src/app.js`. O dispatcher e o painel passam a usá-lo sem alteração.
- **Nova integração por evento** (ex.: CRM, planilha): criar `src/integrations/<nome>.js` que assina eventos do barramento e registrá-la em `src/app.js`.
- **Nova etapa de lembrete**: adicionar em `STEP_KEYS` e `DEFAULT_SETTINGS.reminders.steps`.

## Limites conhecidos

- Processo único (limitador de taxa e idempotência em memória; SQLite com um escritor). Suficiente para o volume de campanhas de uma VPS; para múltiplas instâncias, trocar o repositório por Postgres e o limitador por Redis.
- `node:sqlite` ainda é marcado como experimental no Node 22 (o aviso é suprimido no `npm start`); a camada de repositório isola essa escolha.
- A API de Conversões da Meta (servidor) não está ligada; o `eventID` já está pronto para deduplicação quando for adicionada.
