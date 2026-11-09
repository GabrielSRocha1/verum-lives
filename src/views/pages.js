// Renderização das páginas HTML (modelos autocontidos com placeholders %%CHAVE%%).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendHtml, redirect, newNonce, buildCsp } from '../lib/http.js';
import { escapeHtml, firstName } from '../lib/text.js';
import { COUNTRIES } from '../lib/validation.js';
import { WEEKDAYS_SHORT, formatOccurrence } from '../lib/schedule.js';
import { CONSENT_TEXTS } from '../settings/defaults.js';
import { HONEYPOT_FIELD } from '../services/antispam.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const FULL_DAY = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
const RRULE_DAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// JSON seguro para <script>.
const scriptJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

export function createPages({ config, settings, live, antispam, signer, subscribers, clock }) {
  const cache = new Map();
  function tpl(name) {
    if (config.production && cache.has(name)) return cache.get(name);
    const t = fs.readFileSync(path.join(DIR, 'templates', name), 'utf8');
    cache.set(name, t);
    return t;
  }
  const render = (t, map) => t.replace(/%%([A-Z0-9_]+)%%/g, (m, k) => (k in map ? String(map[k]) : m));

  function common(nonce, extra = {}) {
    return {
      NONCE: nonce,
      BASE_URL: escapeHtml(config.baseUrl),
      YEAR: new Date().getFullYear(),
      LOGO: tpl('partials/logo.svg'),
      SHARED_CSS: tpl('partials/shared.css'),
      TRACKING_JS: render(tpl('partials/tracking.js'), {}),
      CONSENT_BANNER: tpl('partials/consent-banner.html'),
      FOOTER: render(tpl('partials/footer.html'), { YEAR: new Date().getFullYear() }),
      ...extra
    };
  }

  function send(res, status, html, nonce, { admin = false } = {}) {
    const tracking = admin ? {} : settings.get('tracking');
    const csp = buildCsp(nonce, { tracking, turnstile: !admin && antispam.turnstileEnabled(), admin });
    res.setHeader('Content-Security-Policy', csp);
    sendHtml(res, status, html);
  }

  function trackingBoot() {
    const t = settings.get('tracking');
    return { metaPixelId: t.metaPixelId, ga4Id: t.ga4Id, gtmId: t.gtmId, requireConsent: t.requireConsent };
  }

  function presenterHtml() {
    const photo = settings.get('presenter').photo;
    if (photo) {
      return `<img class="presenter-photo" src="${escapeHtml(photo)}" alt="Adilson Rocha, apresentador das transmissões" width="320" height="400" loading="lazy" decoding="async">`;
    }
    return `<img class="presenter-photo presenter-full" src="/presenter.jpg" alt="Adilson Rocha, apresentador das transmissões" width="687" height="1222" loading="lazy" decoding="async">`;
  }

  function dayCards(days) {
    const order = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
    const time = live.publicInfo().timeLabel.toUpperCase();
    return order.map((d) => `<li class="day-card"><span class="day-top">TODA</span><strong>${FULL_DAY[d]}</strong><span class="day-time">ÀS ${escapeHtml(time)}</span></li>`).join('');
  }

  function calendarLinks(info) {
    const occ = info.occurrences[0];
    if (!occ) return { google: '', ics: '' };
    const fmt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const s = live.schedule();
    const byday = s.days.map((d) => RRULE_DAY[d]).join(',');
    const details = `Transmissão ao vivo gratuita — Canal Verum Cripto.${info.links.channel ? `\n${info.links.channel}` : ''}`;
    const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
      action: 'TEMPLATE',
      text: 'Live BITCOIN: OURO DIGITAL! — Canal Verum Cripto',
      dates: `${fmt(occ.start)}/${fmt(occ.end)}`,
      details,
      ctz: s.timezone,
      recur: `RRULE:FREQ=WEEKLY;BYDAY=${byday}`
    }).toString();
    return { google, ics: '/agenda.ics' };
  }

  return {
    landing(req, res) {
      const nonce = newNonce();
      const info = live.publicInfo();
      const next = info.occurrences[0];
      const t = settings.get('tracking');
      const boot = {
        page: 'landing',
        occurrences: info.occurrences,
        timezone: info.timezone,
        timezoneLabel: info.timezoneLabel,
        links: { channel: info.links.channel, watch: info.links.watch },
        tracking: trackingBoot(),
        turnstileSiteKey: antispam.turnstileEnabled() ? config.turnstile.siteKey : '',
        honeypot: HONEYPOT_FIELD
      };
      const nextText = next ? `${next.weekday}, ${next.date}, às ${next.time} (${info.timezoneLabel})` : 'Agenda em atualização';
      const schemaEvent = next ? scriptJson({
        '@context': 'https://schema.org',
        '@type': 'Event',
        name: 'BITCOIN: OURO DIGITAL! — Transmissão ao vivo',
        description: 'Transmissão gratuita sobre Bitcoin como reserva de valor, escassez programada, autocustódia, blockchain e dolarização patrimonial.',
        startDate: new Date(next.start).toISOString(),
        endDate: new Date(next.end).toISOString(),
        eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
        eventStatus: 'https://schema.org/EventScheduled',
        isAccessibleForFree: true,
        location: { '@type': 'VirtualLocation', url: info.links.channel || config.baseUrl },
        organizer: { '@type': 'Organization', name: 'Verum', url: config.baseUrl },
        performer: { '@type': 'Person', name: 'Adilson Rocha' },
        image: `${config.baseUrl}/og.jpg`,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL', availability: 'https://schema.org/InStock', url: config.baseUrl }
      }) : '{}';
      const countryOptions = COUNTRIES.map((c) => `<option value="${c.iso}" title="${escapeHtml(c.name)}"${c.iso === 'BR' ? ' selected' : ''}>+${c.dial} ${c.iso}</option>`).join('');
      const html = render(tpl('landing.html'), common(nonce, {
        BOOT: scriptJson(boot),
        SCHEMA_EVENT: schemaEvent,
        DAYS_UPPER: escapeHtml(info.daysLabel.toUpperCase()),
        TIME_UPPER: escapeHtml(info.timeLabel.toUpperCase()),
        DAY_CARDS: dayCards(info.days),
        NEXT_LIVE_TEXT: escapeHtml(nextText),
        TZ_LABEL: escapeHtml(info.timezoneLabel),
        CHANNEL_LINK: info.links.channel
          ? `<a class="btn btn-ghost" href="${escapeHtml(info.links.channel)}" target="_blank" rel="noopener">Abrir o Canal Verum Cripto <span aria-hidden="true">↗</span></a>`
          : '',
        PRESENTER: presenterHtml(),
        COUNTRY_OPTIONS: countryOptions,
        FORM_TOKEN: escapeHtml(antispam.issueFormToken()),
        HONEYPOT: HONEYPOT_FIELD,
        CONSENT_EMAIL: escapeHtml(CONSENT_TEXTS.email),
        CONSENT_WHATSAPP: escapeHtml(CONSENT_TEXTS.whatsapp),
        TURNSTILE: boot.turnstileSiteKey ? '<div class="turnstile" id="turnstile"></div>' : ''
      }));
      send(res, 200, html, nonce);
    },

    confirmation(req, res, token) {
      const data = signer.verify('confirm', token, clock());
      if (!data) return redirect(res, '/#inscricao');
      const sub = subscribers.findByPublicId(data.s);
      if (!sub) return redirect(res, '/#inscricao');
      // CompleteRegistration só para inscrição nova e uma única vez (recarregar a página não duplica a conversão).
      const conversion = data.n === 1 && subscribers.claimConversion(sub.id, clock());
      const nonce = newNonce();
      const info = live.publicInfo();
      const next = info.occurrences[0];
      const group = info.links.whatsappGroup;
      const cal = calendarLinks(info);
      const boot = {
        page: 'confirmation',
        occurrences: info.occurrences,
        timezone: info.timezone,
        timezoneLabel: info.timezoneLabel,
        links: { channel: info.links.channel, watch: info.links.watch },
        tracking: trackingBoot(),
        conversion: conversion ? { eventId: sub.public_id } : null
      };
      const channels = [sub.consent_email ? 'e-mail' : null, sub.consent_whatsapp ? 'WhatsApp' : null].filter(Boolean);
      const html = render(tpl('confirmation.html'), common(nonce, {
        BOOT: scriptJson(boot),
        FIRST_NAME: escapeHtml(firstName(sub.name)),
        NEXT_LIVE_TEXT: escapeHtml(next ? `${next.weekday}, ${next.date}, às ${next.time} (${info.timezoneLabel})` : 'Agenda em atualização'),
        GROUP_BLOCK: group
          ? `<a class="btn btn-whatsapp btn-xl" href="${escapeHtml(group)}" target="_blank" rel="noopener" id="group-link">${tpl('partials/whatsapp.svg')}<span>ENTRAR NO GRUPO EXCLUSIVO DO WHATSAPP</span></a>`
          : '<p class="notice">O convite para o grupo exclusivo do WhatsApp será disponibilizado em breve. Você receberá as novidades pelos canais que autorizou.</p>',
        CHANNELS_TEXT: channels.length
          ? `Os lembretes também chegarão pelo ${channels.join(' e ')}, conforme você autorizou.`
          : 'Você não autorizou lembretes por e-mail ou WhatsApp — por isso, o grupo é a melhor forma de acompanhar os avisos.',
        GOOGLE_CAL: escapeHtml(cal.google),
        CHANNEL_LINK: info.links.channel
          ? `<a class="btn btn-ghost" href="${escapeHtml(info.links.channel)}" target="_blank" rel="noopener">Ativar lembrete no canal <span aria-hidden="true">↗</span></a>`
          : ''
      }));
      send(res, 200, html, nonce);
    },

    unsubscribe(req, res, token) {
      const data = signer.verify('unsub', token);
      const nonce = newNonce();
      const html = render(tpl('unsubscribe.html'), common(nonce, {
        TOKEN_JSON: scriptJson(data ? token : null),
        VALID_CLASS: data ? '' : 'invalid'
      }));
      send(res, 200, html, nonce);
    },

    privacy(req, res) {
      const nonce = newNonce();
      const contact = config.privacyEmail
        ? `pelo e-mail <a href="mailto:${escapeHtml(config.privacyEmail)}">${escapeHtml(config.privacyEmail)}</a>`
        : 'pelo link “Cancelar o recebimento” presente em cada mensagem';
      send(res, 200, render(tpl('privacy.html'), common(nonce, { CONTACT: contact, CONSENT_EMAIL: escapeHtml(CONSENT_TEXTS.email), CONSENT_WHATSAPP: escapeHtml(CONSENT_TEXTS.whatsapp) })), nonce);
    },

    admin(req, res) {
      const nonce = newNonce();
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      send(res, 200, render(tpl('admin.html'), { NONCE: nonce, LOGO: tpl('partials/logo.svg') }), nonce, { admin: true });
    },

    notFound(req, res) {
      const nonce = newNonce();
      send(res, 404, render(tpl('404.html'), common(nonce)), nonce);
    },

    ics(req, res) {
      const info = live.publicInfo();
      const s = live.schedule();
      const occ = info.occurrences[0];
      if (!occ) return this.notFound(req, res);
      const fmt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
      const esc = (v) => String(v).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
      const body = [
        'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Verum//Lives Bitcoin Ouro Digital//PT', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:lives-verum-${s.days.join('')}-${s.time.replace(':', '')}@${new URL(config.baseUrl).hostname}`,
        `DTSTAMP:${fmt(Date.now())}`,
        `DTSTART:${fmt(occ.start)}`,
        `DTEND:${fmt(occ.end)}`,
        `RRULE:FREQ=WEEKLY;BYDAY=${s.days.map((d) => RRULE_DAY[d]).join(',')}`,
        `SUMMARY:${esc('Live BITCOIN: OURO DIGITAL! — Canal Verum Cripto')}`,
        `DESCRIPTION:${esc('Transmissão ao vivo gratuita sobre Bitcoin, Blockchain, autocustódia e dolarização patrimonial.' + (info.links.channel ? '\n' + info.links.channel : ''))}`,
        info.links.channel ? `URL:${info.links.channel}` : null,
        'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', `DESCRIPTION:${esc('A live começa em 30 minutos')}`, 'END:VALARM',
        'END:VEVENT', 'END:VCALENDAR', ''
      ].filter((l) => l !== null).join('\r\n');
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="lives-verum.ics"', 'Cache-Control': 'no-store' });
      res.end(body);
    },

    weekdayShort: WEEKDAYS_SHORT,
    formatOccurrence
  };
}
