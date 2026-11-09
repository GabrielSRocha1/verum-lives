// Contexto da próxima live e variáveis de template.
import { upcomingOccurrences, formatOccurrence, normalizeSchedule, daysLabel, timeLabel } from '../lib/schedule.js';
import { firstName } from '../lib/text.js';

export function createLiveService({ settings, signer, config, clock }) {
  function schedule() {
    return normalizeSchedule(settings.get('schedule'));
  }

  function links() {
    const l = settings.get('links');
    return {
      youtubeChannel: l.youtubeChannel,
      liveUrl: l.liveUrl,
      whatsappGroup: l.whatsappGroup,
      watch: l.liveUrl || l.youtubeChannel || '',
      channel: l.youtubeChannel || l.liveUrl || ''
    };
  }

  function unsubscribeUrl(sub) {
    return `${config.baseUrl}/descadastro?t=${encodeURIComponent(signer.issue('unsub', { s: sub.public_id }, 0))}`;
  }

  // Ocorrências futuras (ou em andamento) para a página e o contador.
  function upcoming(count = 6) {
    const s = schedule();
    const now = clock();
    return upcomingOccurrences(s, now, count, s.durationMinutes * 60000)
      .filter((start) => start + s.durationMinutes * 60000 > now)
      .map((start) => ({ start, end: start + s.durationMinutes * 60000, ...formatOccurrence(start, s.timezone) }));
  }

  function publicInfo() {
    const s = schedule();
    return {
      daysLabel: daysLabel(s.days),
      timeLabel: timeLabel(s.time),
      timezone: s.timezone,
      timezoneLabel: s.timezoneLabel,
      days: s.days,
      occurrences: upcoming(6).map((o) => ({ start: o.start, end: o.end, weekday: o.weekday, date: o.date, time: o.time })),
      links: links()
    };
  }

  function vars(sub, occurrenceMs) {
    const s = schedule();
    const occ = occurrenceMs ?? upcoming(1)[0]?.start ?? null;
    const f = occ ? formatOccurrence(occ, s.timezone) : null;
    const l = links();
    return {
      primeiro_nome: firstName(sub?.name),
      nome: sub?.name || '',
      dia_semana: f?.weekday || '',
      data_live: f?.date || '',
      hora_live: f?.time || timeLabel(s.time),
      fuso: s.timezoneLabel,
      link_live: l.watch || config.baseUrl,
      link_canal: l.channel || config.baseUrl,
      link_grupo: l.whatsappGroup || '(o link do grupo será enviado em breve)',
      link_descadastro: sub ? unsubscribeUrl(sub) : ''
    };
  }

  return { schedule, links, upcoming, publicInfo, vars, unsubscribeUrl };
}
