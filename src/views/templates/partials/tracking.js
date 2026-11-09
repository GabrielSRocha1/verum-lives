/* Rastreamento: Consent Mode v2 (Google) + Meta Pixel carregado só após consentimento.
   PageView ao carregar; CompleteRegistration SOMENTE via VerumTrack.conversion() na página de confirmação. */
(function () {
  var B = window.__BOOT || {};
  var T = B.tracking || {};
  var KEY = 'verum_consent_v1';
  var hasGoogle = !!(T.gtmId || T.ga4Id);
  var hasMeta = !!T.metaPixelId;
  var pendingConversion = null;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function store(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* modo privado */ } }
  function load(src) { var s = document.createElement('script'); s.async = true; s.src = src; document.head.appendChild(s); }

  var consent = T.requireConsent ? stored() : 'granted';

  if (hasGoogle) {
    gtag('consent', 'default', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', wait_for_update: 500 });
    if (consent === 'granted') grantGoogle();
    if (T.gtmId) { window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' }); load('https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(T.gtmId)); }
    if (T.ga4Id) { load('https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(T.ga4Id)); gtag('js', new Date()); gtag('config', T.ga4Id); }
  }
  function grantGoogle() {
    gtag('consent', 'update', { ad_storage: 'granted', analytics_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' });
  }
  function loadPixel() {
    if (!hasMeta || window.fbq) return;
    var n = window.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!window._fbq) window._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0'; n.queue = [];
    load('https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', T.metaPixelId);
    window.fbq('track', 'PageView');
  }
  if (consent === 'granted') loadPixel();

  function fireMeta(eventId) {
    if (window.fbq) window.fbq('track', 'CompleteRegistration', { content_name: 'Lives Bitcoin Ouro Digital', status: true }, { eventID: eventId });
  }

  window.VerumTrack = {
    conversion: function (eventId) {
      if (hasGoogle) {
        window.dataLayer.push({ event: 'complete_registration', event_id: eventId });
        if (T.ga4Id) gtag('event', 'sign_up', { method: 'landing_lives', event_id: eventId });
      }
      if (window.fbq) fireMeta(eventId); else if (hasMeta) pendingConversion = eventId;
    }
  };

  function setupBanner() {
    var el = document.getElementById('cookie-banner');
    if (!el || !(hasGoogle || hasMeta) || !T.requireConsent || stored()) return;
    el.hidden = false;
    document.body.classList.add('consent-open');
    el.addEventListener('click', function (e) {
      var v = e.target && e.target.getAttribute('data-consent');
      if (!v) return;
      store(v);
      el.hidden = true;
      document.body.classList.remove('consent-open');
      if (v === 'granted') {
        if (hasGoogle) grantGoogle();
        loadPixel();
        if (pendingConversion) { fireMeta(pendingConversion); pendingConversion = null; }
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupBanner); else setupBanner();
})();
