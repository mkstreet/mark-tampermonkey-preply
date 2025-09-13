// ==UserScript==
// @name         Preply Messages — TM Guard
// @namespace    https://github.com/<you>/<repo>
// @version      2.2.0
// @description  Keep [TM] in tab title; lock sidebar scroll; restore last thread.
// @match        https://preply.com/messages*
// @match        https://preply.com/*/messages*
// @run-at       document-start
// @grant        GM_addStyle
// @downloadURL  https://raw.githubusercontent.com/mkstreet/mark-tampermonkey-preply/main/preply-tm-guard.user.js
// @updateURL    https://raw.githubusercontent.com/mkstreet/mark-tampermonkey-preply/main/preply-tm-guard.user.js
// ==/UserScript==
(() => {
  'use strict';

  // -------- stable logging (sites sometimes override console.log) --------
  const _origLog = (console && console.log) ? console.log.bind(console) : function(){};
  const log = (...a) => _origLog('[TM Guard]', ...a);

  // -------- title guard --------
  const PREFIX = '[TM] ';
  const ensureTitle = () => {
    try {
      const t = document.title || '';
      if (!t.startsWith(PREFIX)) {
        document.title = PREFIX + t.replace(/^\[TM\]\s*/,'');
        log('title patched →', document.title);
      }
    } catch {}
  };
  const observeTitle = () => {
    let titleEl = document.querySelector('head > title');
    if (!titleEl) { titleEl = document.createElement('title'); document.head.appendChild(titleEl); }
    const tn = titleEl.firstChild || titleEl.appendChild(document.createTextNode(document.title || ''));
    new MutationObserver(ensureTitle).observe(tn, { characterData: true });
    new MutationObserver(ensureTitle).observe(document.head, { childList: true });
    ['pushState','replaceState'].forEach(fn => {
      const orig = history[fn];
      history[fn] = function(...args){ const r = orig.apply(this,args); queueMicrotask(ensureTitle); scheduleReapply('history.'+fn); return r; };
    });
    addEventListener('popstate', () => { ensureTitle(); scheduleReapply('popstate'); });
    document.addEventListener('visibilitychange', ensureTitle);
    ensureTitle();
    // lightweight keepalive
    const keep = setInterval(ensureTitle, 800);
    addEventListener('beforeunload', () => clearInterval(keep));
  };

  // -------- tiny badge --------
  try {
    GM_addStyle(`#tm-guard-badge{position:fixed;left:8px;bottom:8px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:12px/1.3 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;pointer-events:none}`);
    const b = document.createElement('div'); b.id = 'tm-guard-badge'; b.textContent = 'TM: Guard ON';
    (document.documentElement || document.body).appendChild(b);
  } catch {}

  // -------- keys & helpers --------
  const NS = (() => {
    const seg = (location.pathname.split('/')[1] || '').toLowerCase();
    const loc = ['en','ua','uk','es','fr','de','it','pt','pl','ru','tr','ja','ko','nl','ro','id','zh','tw','hk','sv','th','cs'].includes(seg) ? seg : 'en';
    return `tm_preply:${loc}`;
  })();
  const KEY_SCROLL = `${NS}:scroll`;
  const KEY_LAST_ID = `${NS}:lastThreadId`;
  const KEY_LAST_HREF = `${NS}:lastHref`;

  const ready = (fn) => (document.readyState === 'loading') ? document.addEventListener('DOMContentLoaded', fn, { once:true }) : fn();
  const afterPaint = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));

  // Best-effort: find the scrollable index list robustly
  const getIndexEl = () => {
    const cands = [
      '[data-qa-id="omni-hub"]',
      'aside [data-qa-id*="hub"]',
      '[class*="ThreadList"]',
      '[class*="conversation-list"]',
      'aside [role="navigation"]',
    ];
    for (const sel of cands) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const st = getComputedStyle(el);
      const scrollable = /(auto|scroll)/.test(st.overflowY) || el.scrollHeight > el.clientHeight + 16;
      if (scrollable) return el;
    }
    return null;
  };

  // -------- persist & restore scroll --------
  const saveScroll = (src) => {
    const el = getIndexEl(); if (!el) return;
    const st = el.scrollTop|0;
    localStorage.setItem(KEY_SCROLL, String(st));
    log('saved scrollTop', st, `(${src})`);
  };

  let userMoved = false;
  const flagUserMoved = () => { userMoved = true; clearTimeout(flagUserMoved._t); flagUserMoved._t = setTimeout(()=>{ userMoved=false; }, 1200); };
  ['wheel','touchstart','keydown','mousedown'].forEach(ev => addEventListener(ev, flagUserMoved, { capture:true, passive:true }));

  const stickyRestore = (why) => {
    const desired = parseInt(localStorage.getItem(KEY_SCROLL) || '0', 10) || 0;
    if (!desired) return;
    const el = getIndexEl(); if (!el) return;

    // nudge Chrome scroll anchoring out of the way during restore
    const prevOA = el.style.overflowAnchor; el.style.overflowAnchor = 'none';

    let i = 0, max = 24; // ~3s @125ms
    const tick = () => {
      if (userMoved) { el.style.overflowAnchor = prevOA; return; } // user's in control
      const was = el.scrollTop|0;
      if (Math.abs(was - desired) <= 2) { el.style.overflowAnchor = prevOA; return; }
      el.scrollTop = desired;
      if (++i < max) setTimeout(tick, 125); else { el.style.overflowAnchor = prevOA; }
    };
    afterPaint(tick);
    log('attempting restore to', desired, `(${why})`);
  };

  // -------- remember last clicked thread (by ID, not raw href) --------
  const parseThreadId = (href) => {
    if (!href) return null;
    const m = href.match(/\/messages\/(\d+)(?:\D|$)/) || href.match(/[?&#]thread(?:Id)?=(\d+)/i);
    return m ? m[1] : null;
  };
  const rememberClick = (e) => {
    const a = e.target && e.target.closest && e.target.closest('a[href*="/messages/"]');
    if (a) {
      const href = a.getAttribute('href') || '';
      const id = parseThreadId(href);
      if (id) localStorage.setItem(KEY_LAST_ID, id);
      localStorage.setItem(KEY_LAST_HREF, href);
      queueMicrotask(() => saveScroll('click'));
    }
  };

  const focusLast = () => {
    const id = localStorage.getItem(KEY_LAST_ID);
    const href = localStorage.getItem(KEY_LAST_HREF);
    let a = null;
    if (id) a = document.querySelector(`a[href*="/messages/${id}"]`);
    if (!a && href) a = document.querySelector(`a[href="${href}"]`);
    if (a) {
      const container = getIndexEl();
      const inView = (() => {
        if (!container) return false;
        const cr = container.getBoundingClientRect();
        const r = a.getBoundingClientRect();
        return r.top >= cr.top && r.bottom <= cr.bottom;
      })();
      if (!inView) a.scrollIntoView({ block:'center' });
      a.style.outline = '2px solid currentColor'; setTimeout(()=>{ a.style.outline=''; }, 900);
      log('restored focus to', id || href);
    }
  };

  // -------- binding & rebinding on remounts --------
  let boundEl = null;
  let unbind = () => {};

  const bindIndex = (el) => {
    if (!el || el === boundEl) return;
    if (boundEl) unbind();
    boundEl = el;

    const onScroll = () => { clearTimeout(el._tm_t); el._tm_t = setTimeout(() => saveScroll('scroll'), 140); };
    el.addEventListener('scroll', onScroll, { passive:true });
    document.addEventListener('click', rememberClick, true);
    addEventListener('beforeunload', () => saveScroll('beforeunload'));

    // add a marker class for our CSS if needed
    el.classList.add('tm-guard-index');

    // initial restore when (re)binding
    stickyRestore('bind');
    focusLast();

    unbind = () => {
      try { el.removeEventListener('scroll', onScroll, { passive:true }); } catch {}
      document.removeEventListener('click', rememberClick, true);
    };

    log('bound to index element');
  };

  // Observe DOM for index replacement/remount
  const mo = new MutationObserver(() => {
    const el = getIndexEl();
    if (el && el !== boundEl) {
      log('index replaced; re-binding');
      bindIndex(el);
    }
  });

  const scheduleReapply = (why) => {
    // multiple delayed tries to catch fresh mounts
    [0, 150, 400, 800, 1400].forEach((d) => setTimeout(() => { stickyRestore(why); focusLast(); }, d));
  };

  // also re-apply when tab becomes visible again (some SPAs rebuild then)
  addEventListener('visibilitychange', () => { if (!document.hidden) scheduleReapply('visible'); });
  addEventListener('focus', () => scheduleReapply('focus'));

  // -------- boot --------
  log('userscript loaded', location.href);
  observeTitle();

  // start observing after DOM is ready (but patch history earlier at document-start)
  ready(() => {
    try { mo.observe(document.body, { childList:true, subtree:true }); } catch {}

    let tries = 0;
    const iv = setInterval(() => {
      const el = getIndexEl();
      if (el) { clearInterval(iv); bindIndex(el); return; }
      if (++tries > 60) clearInterval(iv); // ~18s max
    }, 300);

    // first paint restore even if we bound via observer slightly later
    scheduleReapply('ready');
  });
})();
