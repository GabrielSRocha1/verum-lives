// Web App do Google Apps Script — recebe inscrições do site verum-lives e grava
// na aba "Inscritos" desta planilha (upsert por e-mail).
//
// Como instalar (na conta verumpalestras@gmail.com, dona da planilha "verum-lives"):
//   1. Abra a planilha → Extensões → Apps Script e cole este arquivo inteiro.
//   2. Troque o valor de SECRET abaixo por um segredo longo e aleatório.
//   3. Implantar → Nova implantação → tipo "App da Web":
//        - Executar como: Eu (verumpalestras@gmail.com)
//        - Quem pode acessar: Qualquer pessoa
//   4. Copie a URL que termina em /exec e configure no servidor (.env):
//        GOOGLE_SHEETS_WEBAPP_URL=<URL /exec>
//        GOOGLE_SHEETS_SECRET=<mesmo valor de SECRET>
//
// Importante: a cada alteração neste código é preciso criar uma NOVA implantação
// (ou atualizar a existente em Implantar → Gerenciar implantações).

const SECRET = 'TROQUE-POR-UM-SEGREDO-LONGO-E-ALEATORIO';

const HEADERS = [
  'id', 'nome', 'email', 'whatsapp', 'pais',
  'consentimento_email', 'consentimento_whatsapp',
  'origem', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'criado_em', 'atualizado_em'
];

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const body = JSON.parse(e.postData.contents);
    if (!body || body.secret !== SECRET) {
      return jsonResponse({ ok: false, error: 'não autorizado' });
    }
    const row = body.row || {};
    const sheet = ensureSheet();
    const values = [
      row.id || '', row.nome || '', row.email || '', row.whatsapp || '', row.pais || '',
      row.consentimento_email || '', row.consentimento_whatsapp || '',
      row.origem || '', row.utm_source || '', row.utm_medium || '', row.utm_campaign || '',
      row.utm_content || '', row.utm_term || '',
      row.criado_em || '', new Date().toISOString()
    ];

    const emailCol = HEADERS.indexOf('email') + 1;
    const existing = findRowByEmail(sheet, emailCol, row.email);
    if (existing > 0) {
      sheet.getRange(existing, 1, 1, HEADERS.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// Grava na primeira aba da planilha (ex.: "Página1"), seja qual for o nome dela.
function ensureSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function findRowByEmail(sheet, emailCol, email) {
  if (!email) return -1;
  const last = sheet.getLastRow();
  if (last < 2) return -1;
  const emails = sheet.getRange(2, emailCol, last - 1, 1).getValues();
  const target = String(email).trim().toLowerCase();
  for (let i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).trim().toLowerCase() === target) return i + 2;
  }
  return -1;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
