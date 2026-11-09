// Repositório e validação das configurações administráveis.
import { DEFAULT_SETTINGS, STEP_KEYS, TEMPLATE_VARS } from './defaults.js';
import { normalizeSchedule, isValidTimeZone, parseTime } from '../lib/schedule.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

function isHttpsUrl(v) {
  if (!v) return true;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && v.length <= 400;
  } catch {
    return false;
  }
}

export const validators = {
  schedule(input) {
    const errors = [];
    const days = Array.isArray(input?.days) ? input.days.map(Number) : [];
    if (!days.length || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) errors.push('Selecione ao menos um dia válido.');
    if (!parseTime(input?.time)) errors.push('Horário inválido (use HH:MM).');
    if (!isValidTimeZone(input?.timezone)) errors.push('Fuso horário inválido.');
    const dur = parseInt(input?.durationMinutes, 10);
    if (!(dur >= 15 && dur <= 600)) errors.push('Duração deve estar entre 15 e 600 minutos.');
    return { errors, value: errors.length ? null : normalizeSchedule(input) };
  },
  links(input) {
    const errors = [];
    const value = {
      youtubeChannel: String(input?.youtubeChannel || '').trim(),
      liveUrl: String(input?.liveUrl || '').trim(),
      whatsappGroup: String(input?.whatsappGroup || '').trim()
    };
    if (!isHttpsUrl(value.youtubeChannel)) errors.push('Link do canal deve começar com https://');
    if (!isHttpsUrl(value.liveUrl)) errors.push('Link da transmissão deve começar com https://');
    if (!isHttpsUrl(value.whatsappGroup)) errors.push('Link do grupo deve começar com https://');
    else if (value.whatsappGroup && !/^https:\/\/(chat\.whatsapp\.com|wa\.me|whatsapp\.com\/channel)\//.test(value.whatsappGroup)) {
      errors.push('Use o link oficial de convite (https://chat.whatsapp.com/...).');
    }
    return { errors, value };
  },
  tracking(input) {
    const errors = [];
    const value = {
      metaPixelId: String(input?.metaPixelId || '').trim(),
      ga4Id: String(input?.ga4Id || '').trim().toUpperCase(),
      gtmId: String(input?.gtmId || '').trim().toUpperCase(),
      requireConsent: input?.requireConsent !== false
    };
    if (value.metaPixelId && !/^\d{8,20}$/.test(value.metaPixelId)) errors.push('ID do Meta Pixel deve ter apenas números.');
    if (value.ga4Id && !/^G-[A-Z0-9]{4,15}$/.test(value.ga4Id)) errors.push('ID do GA4 deve ser no formato G-XXXXXXX.');
    if (value.gtmId && !/^GTM-[A-Z0-9]{4,10}$/.test(value.gtmId)) errors.push('ID do GTM deve ser no formato GTM-XXXXXX.');
    return { errors, value };
  },
  presenter(input) {
    const photo = String(input?.photo || '');
    const ok = !photo || /^\/uploads\/presenter-[a-f0-9]{16}\.(webp|jpg|png)$/.test(photo);
    return { errors: ok ? [] : ['Foto inválida.'], value: { photo } };
  },
  reminders(input) {
    const errors = [];
    const steps = Array.isArray(input?.steps) ? input.steps : [];
    const keys = steps.map((s) => s?.key);
    if (steps.length !== STEP_KEYS.length || STEP_KEYS.some((k) => !keys.includes(k))) {
      return { errors: ['Sequência de lembretes incompleta.'], value: null };
    }
    const value = {
      steps: STEP_KEYS.map((key) => {
        const s = steps.find((x) => x.key === key);
        const isConf = key === 'confirmation';
        const offset = isConf ? null : parseInt(s.offsetMinutes, 10);
        if (!isConf && !(offset <= 0 && offset >= -20160)) errors.push(`${key}: antecedência deve ser entre 0 e 14 dias.`);
        const subject = String(s.email?.subject || '').slice(0, 200);
        const body = String(s.email?.body || '').slice(0, 5000);
        if (s.enabled && s.channels?.email && (!subject.trim() || !body.trim())) errors.push(`${key}: assunto e texto do e-mail são obrigatórios.`);
        const template = String(s.whatsapp?.template || '').trim();
        if (template && !/^[a-z0-9_]{1,512}$/.test(template)) errors.push(`${key}: nome do modelo do WhatsApp inválido (minúsculas, números e _).`);
        const language = String(s.whatsapp?.language || 'pt_BR').trim();
        if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(language)) errors.push(`${key}: idioma do modelo inválido (ex.: pt_BR).`);
        const params = (Array.isArray(s.whatsapp?.params) ? s.whatsapp.params : []).filter((p) => TEMPLATE_VARS.includes(p)).slice(0, 10);
        return {
          key,
          label: String(s.label || key).slice(0, 80),
          offsetMinutes: offset,
          enabled: !!s.enabled,
          channels: { email: !!s.channels?.email, whatsapp: !!s.channels?.whatsapp },
          email: { subject, body },
          whatsapp: { template, language, params }
        };
      })
    };
    return { errors, value: errors.length ? null : value };
  }
};

export function createSettingsRepo(db, clock) {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
  const setStmt = db.prepare(
    'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by'
  );
  let cache = null;

  function load() {
    const out = clone(DEFAULT_SETTINGS);
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const row = getStmt.get(key);
      if (row) {
        try {
          out[key] = { ...out[key], ...JSON.parse(row.value) };
        } catch { /* mantém padrão */ }
      }
    }
    return out;
  }

  return {
    all() {
      if (!cache) cache = load();
      return clone(cache);
    },
    get(section) {
      return this.all()[section];
    },
    update(section, input, actor) {
      if (!validators[section]) return { errors: ['Seção desconhecida.'] };
      const { errors, value } = validators[section](input);
      if (errors.length) return { errors };
      setStmt.run(section, JSON.stringify(value), clock(), actor || null);
      cache = null;
      return { value };
    }
  };
}
