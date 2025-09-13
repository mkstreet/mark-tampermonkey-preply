// ==UserScript==
// @name         Preply Messages — TM Guard
// @version      2.5.0
// @description  Keep [TM] in tab title; lock sidebar scroll; restore last thread; copy FULL thread.
// @namespace    https://github.com/mkstreet
// @match        https://preply.com/messages*
// @match        https://preply.com/*/messages*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @downloadURL  https://raw.githubusercontent.com/mkstreet/mark-tampermonkey-preply/main/preply-tm-guard.user.js
// @updateURL    https://raw.githubusercontent.com/mkstreet/mark-tampermonkey-preply/main/preply-tm-guard.user.js
// @homepageURL  https://github.com/mkstreet/mark-tampermonkey-preply
// @supportURL   https://github.com/mkstreet/mark-tampermonkey-preply/issues
// ==/UserScript==
(() => {
  'use strict';
  const log = (...a) => console.log('[TM Guard]', ...a);

  // ---- Title guard ----
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
      history[fn] = function(...args){ const r = orig.apply(this,args); queueMicrotask(ensureTitle); return r; };
    });
    addEventListener('popstate', ensureTitle);
    document.addEventListener('visibilitychange', ensureTitle);
    ensureTitle();
  };

  // ---- Badges / UI ----
  try {
    GM_addStyle(`
      #tm-guard-badge{position:fixed;left:8px;bottom:8px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;pointer-events:none;}
      #tm-copy-thread{position:fixed;right:8px;bottom:8px;padding:6px 9px;border-radius:8px;background:rgba(0,0,0,.68);color:#fff;font:12px/1.25 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;border:0;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)}
      #tm-copy-thread:hover{filter:brightness(1.08)}
      #tm-toast{position:fixed;right:8px;bottom:44px;padding:6px 10px;border-radius:8px;background:rgba(0,0,0,.82);color:#fff;font:12px system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .15s ease}
      #tm-toast.show{opacity:1}
    `);
    const b = document.createElement('div');
    b.id = 'tm-guard-badge';
    b.textContent = 'TM: Guard ON';
    document.body.appendChild(b);

    const btn = document.createElement('button');
    btn.id = 'tm-copy-thread';
    btn.type = 'button';
    btn.title = 'Copy FULL thread (auto-load older)\nHotkeys: Alt+Shift+C = full, Alt+C = visible';
    btn.textContent = 'Copy FULL thread';
    document.body.appendChild(btn);

    const toast = document.createElement('div');
    toast.id = 'tm-toast';
    document.body.appendChild(toast);

    const showToast = (msg) => {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(showToast._t);
      showToast._t = setTimeout(()=>toast.classList.remove('show'), 1400);
    };

    btn.addEventListener('click', async () => {
      const n = await copyThread({ full: true });
      if (n && n.copied > 0) showToast(`Copied ${n.copied} msg${n.copied>1?'s':''} (${n.chars} chars)`);
      else showToast('Nothing to copy');
    });

    // Hotkeys:
    // Alt+Shift+C -> FULL thread
    // Alt+C        -> Visible only
    addEventListener('keydown', async (e) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const full = !!e.shiftKey;
        const n = await copyThread({ full });
        if (n && n.copied > 0) showToast(`Copied ${n.copied} msg${n.copied>1?'s':''} (${n.chars} chars)`);
        else showToast('Nothing to copy');
      }
    });
  } catch {}

  // ---- Sidebar scroll persistence ----
  const KEY = 'tm_preply_scroll';
  const LAST = 'tm_preply_lasthref';
  const qIndex = () => document.querySelector('[data-qa-id="omni-hub"]');

  const saveScroll = (src) => {
    const el = qIndex(); if (!el) return;
    const st = el.scrollTop|0;
    localStorage.setItem(KEY, String(st));
    log('saved scrollTop', st, `(${src})`);
  };
  const restoreScroll = () => {
    const el = qIndex(); if (!el) return;
    const v = parseInt(localStorage.getItem(KEY) || '0', 10) || 0;
    el.scrollTop = v;
    log('restored scrollTop', v);
  };
  const rememberClick = (e) => {
    const a = e.target.closest('a[href^="/en/messages/"],a[href^="/messages/"]');
    if (a) {
      localStorage.setItem(LAST, a.getAttribute('href'));
      queueMicrotask(() => saveScroll('click'));
    }
  };
  const focusLast = () => {
    const href = localStorage.getItem(LAST);
    if (!href) return;
    const a = document.querySelector(`a[href="${href}"]`);
    if (a && a.scrollIntoView) {
      a.scrollIntoView({ block:'center' });
      log('restored focus to', href);
      a.style.outline = '2px solid currentColor';
      setTimeout(()=>{ a.style.outline = ''; }, 800);
    }
  };

  // ---- Copy Thread (FULL capture) ----
  const THREAD_CANDIDATES = [
    '[data-qa-id="message-list"]',
    '[data-qa-id="messages-thread"]',
    '[data-qa-id="omni-thread"]',
    '[data-testid="chat-thread"]',
    '[aria-label="Conversation"]',
    '[class*="thread"] [role="list"]',
    '[class*="Messages"] [role="list"]',
    '[data-qa-id="chat-panel"]',
  ];
  const MSG_ITEM_CANDIDATES = [
    '[data-qa-id="message-item"]',
    '[data-qa-id^="message-"]',
    '[data-testid="message-item"]',
    '[role="listitem"]',
    '[class*="messageItem"]',
    '[class*="MessageBubble"]',
    'article',
    'li',
  ];

  const ready = (fn) => (document.readyState === 'loading') ? document.addEventListener('DOMContentLoaded', fn) : fn();
  addEventListener('pageshow', () => setTimeout(() => { ensureTitle(); restoreScroll(); focusLast(); }, 0));

  function findThreadContainer() {
    for (const sel of THREAD_CANDIDATES) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.querySelector(MSG_ITEM_CANDIDATES.join(','))) return el;
    }
    // Fallback: middle column in 3-col layout
    const middle = document.querySelector('[data-qa-id="omni-hub"]')?.parentElement?.nextElementSibling;
    if (middle && middle.querySelector(MSG_ITEM_CANDIDATES.join(','))) return middle;
    // Final fallback: main scroll element
    return document.querySelector('[role="main"]') || document.body;
  }

  function isScrollable(el) {
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY || '') && el.scrollHeight > el.clientHeight + 3;
  }

  function pickScrollElement(start) {
    let el = start;
    while (el && !isScrollable(el)) el = el.parentElement;
    return el || document.scrollingElement || document.documentElement || document.body;
  }

  function findMessageItems(container) {
    const items = Array.from(container.querySelectorAll(MSG_ITEM_CANDIDATES.join(',')));
    return items.filter((el) => {
      const t = el.textContent?.trim() || '';
      if (!t) return false;
      if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/.test(t)) return false; // timestamp-only rows
      if (/^(Seen|Delivered|Edited)$/i.test(t)) return false;
      return true;
    });
  }

  function extractMessageText(el) {
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,svg,button,menu,[role="button"],time,[data-qa-id*="status"],[class*="status"]').forEach(n=>n.remove());
    let txt = (clone.textContent || '')
      .replace(/\u00a0/g,' ')
      .replace(/[ \t]{2,}/g,' ')
      .replace(/\n[ \t]+/g,'\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return txt;
  }

  function messageKey(el) {
    const id = el.getAttribute('data-id') || el.getAttribute('data-message-id') || el.id || '';
    const timeEl = el.querySelector('time');
    const ts = (timeEl?.getAttribute('datetime') || timeEl?.textContent || '').trim();
    const txt = (el.textContent || '').trim().slice(0, 120);
    return [id, ts, txt].filter(Boolean).join('#');
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function autoLoadAll(container, scroller) {
    // Try to reveal all older messages by reaching the very top repeatedly.
    let attempts = 0, stable = 0;
    let lastCount = 0, lastHeight = 0;
    const maxAttempts = 40;

    while (attempts++ < maxAttempts) {
      // Click any obvious "Load older" / "Show previous" buttons
      const moreBtn = container.querySelector('button, a');
      if (moreBtn) {
        const label = (moreBtn.innerText || moreBtn.textContent || '').trim().toLowerCase();
        if (/older|previous|earlier|load more|see more|show more/.test(label)) moreBtn.click();
      }
      scroller.scrollTop = 0;
      await sleep(250);

      const count = findMessageItems(container).length;
      const h = scroller.scrollHeight;

      if (count <= lastCount && h <= lastHeight + 2) {
        if (++stable >= 3) break; // no new items for a few cycles
      } else {
        stable = 0;
      }
      lastCount = count;
      lastHeight = h;
    }
  }

  async function sweepCollect(container, scroller) {
    // From top to bottom, collect messages even in virtualized lists.
    const saved = scroller.scrollTop;
    const seen = new Set();
    const ordered = [];

    scroller.scrollTop = 0;
    await sleep(80);

    let bottomStreak = 0;
    let guard = 0;

    while (guard++ < 200) {
      const items = findMessageItems(container);
      for (const el of items) {
        const key = messageKey(el);
        if (key && !seen.has(key)) {
          seen.add(key);
          const txt = extractMessageText(el);
          if (txt) ordered.push(txt);
        }
      }

      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
      if (atBottom) {
        if (++bottomStreak >= 2) break; // confirm
      } else {
        bottomStreak = 0;
      }

      const step = Math.max(80, Math.floor(scroller.clientHeight * 0.9));
      scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight);
      await sleep(60);
    }

    // Restore user position
    scroller.scrollTop = saved;
    return ordered;
  }

  async function copyToClipboard(text) {
    try {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, { type: 'text', mimetype: 'text/plain' });
        return true;
      }
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const ta = document.createElement('textarea');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      console.warn('[TM Guard] clipboard failed', e);
      return false;
    }
  }

  async function copyThread({ full }) {
    // If user selected some text, honor that (quick exact copy)
    const sel = getSelection && getSelection();
    if (!full && sel && !sel.isCollapsed) {
      const txt = sel.toString();
      const ok = await copyToClipboard(txt);
      log('copied selection', ok ? txt.length : 'fail');
      return { copied: ok ? 1 : 0, chars: txt.length|0, selection: true };
    }

    const container = findThreadContainer();
    if (!container) { log('thread container not found'); return { copied: 0, chars: 0 }; }
    const scroller = pickScrollElement(container);

    if (full) {
      await autoLoadAll(container, scroller);
      const msgs = await sweepCollect(container, scroller);
      const out = msgs.join('\n\n');
      const ok = await copyToClipboard(out);
      log('copied FULL thread', ok ? `${msgs.length} msgs, ${out.length} chars` : 'fail');
      return { copied: ok ? msgs.length : 0, chars: ok ? out.length : 0 };
    } else {
      // Visible-only
      const items = findMessageItems(container);
      const texts = items.map(extractMessageText).filter(Boolean);
      const joined = texts.join('\n\n');
      const ok = await copyToClipboard(joined);
      log('copied VISIBLE thread', ok ? `${texts.length} msgs, ${joined.length} chars` : 'fail');
      return { copied: ok ? texts.length : 0, chars: ok ? joined.length : 0 };
    }
  }

  // Boot
  log('userscript loaded', location.href);
  observeTitle();
  const readyFn = () => {
    const idx = qIndex();
    if (idx) {
      restoreScroll();
      idx.addEventListener('scroll', () => { clearTimeout(idx._tm_t); idx._tm_t = setTimeout(()=>saveScroll('scroll'), 120); }, { passive:true });
      document.addEventListener('click', rememberClick, true);
      addEventListener('beforeunload', () => saveScroll('beforeunload'));
    } else {
      log('index not found yet; will retry...');
      const iv = setInterval(() => {
        const el = qIndex();
        if (!el) return;
        clearInterval(iv);
        log('index found (retry)');
        restoreScroll();
        el.addEventListener('scroll', () => { clearTimeout(el._tm_t); el._tm_t = setTimeout(()=>saveScroll('scroll'), 120); }, { passive:true });
        document.addEventListener('click', rememberClick, true);
        addEventListener('beforeunload', () => saveScroll('beforeunload'));
      }, 300);
      setTimeout(()=>clearInterval(iv), 15000);
    }
  };
  (document.readyState === 'loading') ? document.addEventListener('DOMContentLoaded', readyFn) : readyFn();
})();
