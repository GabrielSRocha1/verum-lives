// Validação e normalização dos dados do formulário (servidor é a fonte da verdade).

// Países mais comuns no público da Verum. dial = código do país; rule = validação do número nacional.
export const COUNTRIES = [
  { iso: 'BR', name: 'Brasil', dial: '55' },
  { iso: 'PY', name: 'Paraguai', dial: '595' },
  { iso: 'AR', name: 'Argentina', dial: '54' },
  { iso: 'UY', name: 'Uruguai', dial: '598' },
  { iso: 'BO', name: 'Bolívia', dial: '591' },
  { iso: 'CL', name: 'Chile', dial: '56' },
  { iso: 'PE', name: 'Peru', dial: '51' },
  { iso: 'CO', name: 'Colômbia', dial: '57' },
  { iso: 'VE', name: 'Venezuela', dial: '58' },
  { iso: 'EC', name: 'Equador', dial: '593' },
  { iso: 'MX', name: 'México', dial: '52' },
  { iso: 'US', name: 'Estados Unidos', dial: '1' },
  { iso: 'CA', name: 'Canadá', dial: '1' },
  { iso: 'PT', name: 'Portugal', dial: '351' },
  { iso: 'ES', name: 'Espanha', dial: '34' },
  { iso: 'IT', name: 'Itália', dial: '39' },
  { iso: 'FR', name: 'França', dial: '33' },
  { iso: 'DE', name: 'Alemanha', dial: '49' },
  { iso: 'GB', name: 'Reino Unido', dial: '44' },
  { iso: 'IE', name: 'Irlanda', dial: '353' },
  { iso: 'CH', name: 'Suíça', dial: '41' },
  { iso: 'NL', name: 'Países Baixos', dial: '31' },
  { iso: 'BE', name: 'Bélgica', dial: '32' },
  { iso: 'AO', name: 'Angola', dial: '244' },
  { iso: 'MZ', name: 'Moçambique', dial: '258' },
  { iso: 'JP', name: 'Japão', dial: '81' },
  { iso: 'AE', name: 'Emirados Árabes', dial: '971' },
  { iso: 'AU', name: 'Austrália', dial: '61' }
];

const BR_DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99
]);

const NAME_RE = /^[\p{L}][\p{L}\p{M}'’.\- ]*[\p{L}.]$/u;

export function normalizeName(raw) {
  return String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

export function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) return { error: 'Informe seu nome completo.' };
  if (name.length < 5 || name.length > 100) return { error: 'O nome deve ter entre 5 e 100 caracteres.' };
  if (!NAME_RE.test(name)) return { error: 'Use apenas letras no nome.' };
  const parts = name.split(' ').filter((p) => p.replace(/[.'’-]/g, '').length >= 1);
  if (parts.length < 2) return { error: 'Informe nome e sobrenome.' };
  return { value: name };
}

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/;

export function normalizeEmail(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function validateEmail(raw) {
  const email = normalizeEmail(raw);
  if (!email) return { error: 'Informe seu e-mail.' };
  if (email.length > 254) return { error: 'E-mail muito longo.' };
  const [local] = email.split('@');
  if (!EMAIL_RE.test(email) || local.length > 64 || email.includes('..') || local.startsWith('.') || local.endsWith('.')) {
    return { error: 'Informe um e-mail válido.' };
  }
  return { value: email };
}

// Retorna { value: E.164 sem '+', display: '+55 11 98765-4321' } ou { error }.
export function validatePhone(countryIso, rawNumber) {
  const country = COUNTRIES.find((c) => c.iso === String(countryIso || '').toUpperCase());
  if (!country) return { error: 'Selecione o país do seu WhatsApp.' };
  let digits = String(rawNumber ?? '').replace(/\D/g, '');
  if (!digits) return { error: 'Informe seu WhatsApp com DDD.' };
  // Aceita número colado já com o código do país.
  if (String(rawNumber).trim().startsWith('+') && digits.startsWith(country.dial)) digits = digits.slice(country.dial.length);
  else if (digits.startsWith('00' + country.dial)) digits = digits.slice(2 + country.dial.length);

  const fail = (msg) => ({ error: msg || 'Informe um número de WhatsApp válido.' });

  switch (country.iso) {
    case 'BR': {
      if (digits.length === 13 && digits.startsWith('55')) digits = digits.slice(2);
      if (digits.length === 12 && digits.startsWith('0')) digits = digits.slice(1);
      if (digits.length === 11 && digits.startsWith('0')) return fail('Informe o DDD sem o zero inicial.');
      if (digits.length !== 10 && digits.length !== 11) return fail('Informe DDD + número (ex.: 11 98765-4321).');
      if (!BR_DDD.has(+digits.slice(0, 2))) return fail('DDD inválido.');
      if (digits.length === 11 && digits[2] !== '9') return fail('Celular deve começar com 9 após o DDD.');
      if (/^(\d)\1+$/.test(digits.slice(2))) return fail();
      break;
    }
    case 'PY': {
      if (digits.startsWith('0')) digits = digits.slice(1);
      if (!/^9\d{8}$/.test(digits)) return fail('Informe o celular paraguaio (ex.: 981 123 456).');
      break;
    }
    case 'US':
    case 'CA': {
      if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
      if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return fail('Informe o número com código de área (10 dígitos).');
      break;
    }
    case 'PT': {
      if (!/^9\d{8}$/.test(digits)) return fail('Informe o telemóvel português (9 dígitos, começa com 9).');
      break;
    }
    default: {
      if (digits.startsWith('0')) digits = digits.slice(1);
      if (digits.length < 6 || digits.length + country.dial.length > 15) return fail();
    }
  }
  const e164 = country.dial + digits;
  if (e164.length > 15) return fail();
  return { value: e164, country: country.iso, display: formatPhone(e164) };
}

export function formatPhone(e164) {
  const d = String(e164 || '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) {
    const n = d.slice(4);
    return `+55 ${d.slice(2, 4)} ${n.slice(0, n.length - 4)}-${n.slice(-4)}`;
  }
  const c = COUNTRIES.slice().sort((a, b) => b.dial.length - a.dial.length).find((x) => d.startsWith(x.dial));
  return c ? `+${c.dial} ${d.slice(c.dial.length)}` : `+${d}`;
}

// Variações para casar o wa_id do WhatsApp (que no Brasil pode vir sem o 9º dígito).
export function phoneVariants(e164) {
  const d = String(e164 || '').replace(/\D/g, '');
  const out = new Set([d]);
  if (d.startsWith('55')) {
    if (d.length === 13 && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5));
    if (d.length === 12 && /[6-9]/.test(d[4])) out.add(d.slice(0, 4) + '9' + d.slice(4));
  }
  return [...out];
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'ttclid'];

export function sanitizeText(v, max = 200) {
  if (v === null || v === undefined) return null;
  const s = String(v).normalize('NFC').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  return s || null;
}

export function sanitizeAttribution(input = {}) {
  const src = typeof input === 'object' && input ? input : {};
  const out = {};
  for (const k of UTM_KEYS) out[k] = sanitizeText(src[k], k.endsWith('clid') ? 500 : 150);
  out.landing_url = sanitizeText(src.landing_url, 500);
  let refHost = null;
  try {
    if (src.referrer) refHost = new URL(String(src.referrer)).hostname.slice(0, 120);
  } catch { /* referrer inválido */ }
  out.referrer_host = refHost;
  out.origin = deriveOrigin(out);
  return out;
}

export function deriveOrigin(a) {
  if (a.utm_source) return a.utm_source.toLowerCase();
  if (a.fbclid) return 'facebook';
  if (a.gclid) return 'google';
  if (a.ttclid) return 'tiktok';
  const h = (a.referrer_host || '').toLowerCase();
  if (!h) return 'direto';
  if (h.includes('instagram')) return 'instagram';
  if (h.includes('facebook') || h === 'l.facebook.com' || h === 'lm.facebook.com') return 'facebook';
  if (h.includes('tiktok')) return 'tiktok';
  if (h.includes('youtube') || h.includes('youtu.be')) return 'youtube';
  if (h.includes('google')) return 'google';
  if (h.includes('whatsapp')) return 'whatsapp';
  return h;
}

export function parseConsent(v) {
  return v === true || v === 'true' || v === 'on' || v === '1' || v === 1;
}

export function validateRegistration(body) {
  const errors = {};
  const name = validateName(body.name);
  if (name.error) errors.name = name.error;
  const email = validateEmail(body.email);
  if (email.error) errors.email = email.error;
  const phone = validatePhone(body.country, body.phone);
  if (phone.error) errors.phone = phone.error;
  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      name: name.value,
      email: email.value,
      phone: phone.value,
      country: phone.country,
      consentEmail: parseConsent(body.consent_email),
      consentWhatsapp: parseConsent(body.consent_whatsapp),
      attribution: sanitizeAttribution(body.attribution),
      visitorId: /^[a-zA-Z0-9-]{8,64}$/.test(String(body.visitor_id || '')) ? String(body.visitor_id) : null
    }
  };
}
