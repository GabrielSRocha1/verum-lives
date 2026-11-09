// Visitas (visitante único por dia, sem dados pessoais) e indicadores do painel.
import { dayKey } from '../lib/schedule.js';
import { sanitizeAttribution } from '../lib/validation.js';

const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|monitor/i;

export function createStatsService({ db, clock, live }) {
  const tz = () => live.schedule().timezone;

  function recordVisit({ visitorId, attribution, userAgent }) {
    if (!/^[a-zA-Z0-9-]{8,64}$/.test(String(visitorId || ''))) return false;
    if (BOT_RE.test(String(userAgent || ''))) return false;
    const a = sanitizeAttribution(attribution);
    const now = clock();
    return db.prepare(`INSERT OR IGNORE INTO visits (visitor_id, day, origin, utm_source, utm_medium, utm_campaign, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(visitorId, dayKey(now, tz()), a.origin, a.utm_source, a.utm_medium, a.utm_campaign, now).changes === 1;
  }

  function overview({ days = 30 } = {}) {
    const now = clock();
    const zone = tz();
    const since = now - days * 86400_000;
    const sinceDay = dayKey(since, zone);
    const today = dayKey(now, zone);

    const totals = db.prepare(`SELECT COUNT(*) total,
      SUM(consent_email) email_ok, SUM(consent_whatsapp) wa_ok,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) last7,
      SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) period
      FROM subscribers WHERE deleted_at IS NULL`).get(now - 7 * 86400_000, since);

    // Inscrições por dia (no fuso da live) dentro do período.
    const subsInPeriod = db.prepare('SELECT created_at, utm_campaign, origin FROM subscribers WHERE created_at >= ?').all(since);
    const perDay = new Map();
    let todayCount = 0;
    for (const r of subsInPeriod) {
      const d = dayKey(r.created_at, zone);
      perDay.set(d, (perDay.get(d) || 0) + 1);
      if (d === today) todayCount++;
    }
    const visitsPerDay = new Map(db.prepare('SELECT day, COUNT(*) c FROM visits WHERE day >= ? GROUP BY day').all(sinceDay).map((r) => [r.day, r.c]));
    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = dayKey(now - i * 86400_000, zone);
      if (series.length && series[series.length - 1].day === d) continue;
      series.push({ day: d, registrations: perDay.get(d) || 0, visitors: visitsPerDay.get(d) || 0 });
    }

    const visitorsPeriod = db.prepare('SELECT COUNT(DISTINCT visitor_id) c FROM visits WHERE day >= ?').get(sinceDay).c;

    const visitsByCampaign = new Map(db.prepare(`SELECT COALESCE(utm_campaign,'(sem campanha)') k, COUNT(DISTINCT visitor_id) c FROM visits WHERE day >= ? GROUP BY k`)
      .all(sinceDay).map((r) => [r.k, r.c]));
    const subsByCampaign = db.prepare(`SELECT COALESCE(utm_campaign,'(sem campanha)') k, COALESCE(utm_source, origin) src, COUNT(*) c FROM subscribers
      WHERE created_at >= ? GROUP BY k ORDER BY c DESC`).all(since);
    const campaigns = subsByCampaign.map((r) => {
      const visitors = visitsByCampaign.get(r.k) || 0;
      return { campaign: r.k, source: r.src, registrations: r.c, visitors, conversionRate: visitors ? r.c / visitors : null };
    });
    for (const [k, v] of visitsByCampaign) if (!campaigns.find((c) => c.campaign === k)) campaigns.push({ campaign: k, source: null, registrations: 0, visitors: v, conversionRate: 0 });

    const origins = db.prepare('SELECT origin, COUNT(*) c FROM subscribers WHERE deleted_at IS NULL GROUP BY origin ORDER BY c DESC LIMIT 12').all();

    return {
      generatedAt: now,
      periodDays: days,
      totals: {
        subscribers: totals.total || 0,
        today: todayCount,
        last7: totals.last7 || 0,
        period: totals.period || 0,
        consentEmail: totals.email_ok || 0,
        consentWhatsapp: totals.wa_ok || 0,
        visitors: visitorsPeriod,
        conversionRate: visitorsPeriod ? (totals.period || 0) / visitorsPeriod : null
      },
      series,
      campaigns,
      origins
    };
  }

  return { recordVisit, overview };
}
