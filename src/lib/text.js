// Utilitários de texto: escape HTML, templates {{variavel}} e CSV seguro.

export function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderTemplate(tpl, vars) {
  return String(tpl ?? '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m));
}

// Converte texto simples em HTML seguro: escapa, transforma URLs em links e quebras em <br>.
export function textToHtml(text) {
  const esc = escapeHtml(text);
  const linked = esc.replace(/(https:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:#D9A94B">${u}</a>`);
  return linked.split(/\n{2,}/).map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, '<br>')}</p>`).join('');
}

// CSV com ";" (padrão do Excel em pt-BR), BOM UTF-8 e proteção contra injeção de fórmulas.
export function toCsv(headers, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    if (/[";\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.map(cell).join(';'), ...rows.map((r) => r.map(cell).join(';'))];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export function firstName(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}
