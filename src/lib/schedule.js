// Cálculo da agenda das lives com fuso horário IANA, sem bibliotecas externas.

export const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_PLURAL = ['domingos', 'segundas-feiras', 'terças-feiras', 'quartas-feiras', 'quintas-feiras', 'sextas-feiras', 'sábados'];
export const WEEKDAYS_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const dtfCache = new Map();
function partsFormatter(tz) {
  if (!dtfCache.has(tz)) {
    dtfCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short'
    }));
  }
  return dtfCache.get(tz);
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return typeof tz === 'string' && tz.length > 0;
  } catch {
    return false;
  }
}

// Componentes de data/hora de um instante UTC no fuso informado.
export function zonedParts(ms, tz) {
  const p = {};
  for (const { type, value } of partsFormatter(tz).formatToParts(new Date(ms))) p[type] = value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: wd };
}

function offsetAt(ms, tz) {
  const z = zonedParts(ms, tz);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// Converte data/hora local de um fuso para instante UTC (ms). Trata horário de verão.
export function zonedToUtc(year, month, day, hour, minute, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = guess - offsetAt(guess, tz);
  const off2 = offsetAt(utc, tz);
  if (guess - off2 !== utc) utc = guess - off2;
  return utc;
}

export function parseTime(hhmm) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || ''));
  return m ? { hour: +m[1], minute: +m[2] } : null;
}

export function normalizeSchedule(s = {}) {
  const days = [...new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  return {
    days,
    time: parseTime(s.time) ? s.time : '19:00',
    timezone: isValidTimeZone(s.timezone) ? s.timezone : 'America/Sao_Paulo',
    timezoneLabel: String(s.timezoneLabel || 'horário de Brasília').slice(0, 60),
    durationMinutes: Math.min(Math.max(parseInt(s.durationMinutes, 10) || 90, 15), 600)
  };
}

// Próximas ocorrências (início em ms UTC) a partir de "fromMs" (inclui as que começaram há menos de lookbackMs).
export function upcomingOccurrences(schedule, fromMs, count = 6, lookbackMs = 0) {
  const s = normalizeSchedule(schedule);
  if (!s.days.length) return [];
  const { hour, minute } = parseTime(s.time);
  const today = zonedParts(fromMs, s.timezone);
  const out = [];
  for (let i = -1; i < 60 && out.length < count; i++) {
    const cal = new Date(Date.UTC(today.year, today.month - 1, today.day + i));
    if (!s.days.includes(cal.getUTCDay())) continue;
    const start = zonedToUtc(cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), hour, minute, s.timezone);
    if (start >= fromMs - lookbackMs) out.push(start);
  }
  return out;
}

export function nextOccurrence(schedule, fromMs) {
  return upcomingOccurrences(schedule, fromMs, 1)[0] ?? null;
}

// Rótulos para a página: "TERÇAS E QUINTAS-FEIRAS", "19H".
export function daysLabel(days) {
  const sorted = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  const short = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
  // Compacta "terças-feiras e quintas-feiras" → "terças e quintas-feiras"
  const allFeira = sorted.length > 1 && sorted.every((d) => d >= 1 && d <= 5);
  const parts = allFeira
    ? sorted.map((d, i) => (i < sorted.length - 1 ? short[d] : WEEKDAYS_PLURAL[d]))
    : sorted.map((d) => WEEKDAYS_PLURAL[d]);
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

export function timeLabel(hhmm) {
  const t = parseTime(hhmm);
  if (!t) return '';
  return t.minute ? `${t.hour}h${String(t.minute).padStart(2, '0')}` : `${t.hour}h`;
}

export function formatOccurrence(ms, tz) {
  const z = zonedParts(ms, tz);
  return {
    weekday: WEEKDAYS[z.weekday],
    weekdayShort: WEEKDAYS_SHORT[z.weekday],
    date: `${z.day} de ${MONTHS[z.month - 1]}`,
    dateShort: `${String(z.day).padStart(2, '0')}/${String(z.month).padStart(2, '0')}`,
    time: timeLabel(`${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`),
    ymd: `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`
  };
}

export function dayKey(ms, tz) {
  return formatOccurrence(ms, tz).ymd;
}
