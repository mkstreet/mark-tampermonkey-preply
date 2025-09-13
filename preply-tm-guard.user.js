// ==UserScript==
// @name         Preply Messages — TM Guard
// @version      2.7.0
// @description  Keep [TM] in tab title; persist sidebar scroll; restore last thread; copy FULL thread with per-message separators.
// @namespace    https://github.com/mkstreet
// @match        https://preply.com/messages*
// @match        https://preply.com/*/messages*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/mkstreet/mark-tampermonkey-preply/main/preply-tm-guard.user.js
// @updateURL    https://raw.githubusercontent.com/mkstreet/mark-tampermonkey-preply/main/preply-tm-guard.user.js
// ==/UserScript==
(() => {
  'use strict';
  const log = (...a) => console.log('[TM Guard]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const addStyle = (css) => { try { (typeof GM_addStyle==='function') ? GM_addStyle(css) : (()=>{ const s=document.createElement('style'); s.textContent=css; document.head.appendChild(s); })(); } catch{} };

  // --- CONFIG: tweak your divider here ---
  const SEPARATOR = '\n\n────────────────────────────────\n\n'; // change to '\n\n***\n\n' or '\n\n-----\n\n' if you prefer

  // ---------- Title guard ----------
  const PREFIX='[TM] ';
  const ensureTitle=()=>{ try{ const t=document.title||''; if(!t.startsWith(PREFIX)){ document.title=PREFIX+t.replace(/^\[TM\]\s*/,''); log('title patched →',document.title);} }catch{} };
  const observeTitle=()=>{ let titleEl=document.querySelector('head > title'); if(!titleEl){ titleEl=document.createElement('title'); document.head.appendChild(titleEl); }
    const tn=titleEl.firstChild||titleEl.appendChild(document.createTextNode(document.title||'')); new MutationObserver(ensureTitle).observe(tn,{characterData:true});
    new MutationObserver(ensureTitle).observe(document.head,{childList:true,subtree:true});
    ['pushState','replaceState'].forEach(fn=>{ const orig=history[fn]; history[fn]=function(...args){ const r=orig.apply(this,args); queueMicrotask(ensureTitle); return r; };});
    addEventListener('popstate',ensureTitle); addEventListener('visibilitychange',ensureTitle); ensureTitle(); };

  // ---------- UI: badge + toast + copy button ----------
  addStyle(`#tm-guard-badge{position:fixed;left:8px;bottom:8px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;pointer-events:none}
  #tm-toast{position:fixed;right:12px;bottom:12px;max-width:70ch;background:rgba(0,0,0,.85);color:#fff;padding:.5rem .6rem;border-radius:10px;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.3)}
  #tm-copy-btn{position:fixed;top:72px;right:12px;padding:.35rem .55rem;border-radius:10px;background:rgba(0,0,0,.6);color:#fff;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;border:0;cursor:pointer}
  #tm-copy-btn:hover{background:rgba(0,0,0,.75)}`);
  const mountBadge=()=>{ if(!document.getElementById('tm-guard-badge')){ const b=document.createElement('div'); b.id='tm-guard-badge'; b.textContent='TM: Guard ON'; (document.documentElement||document.body).appendChild(b);} };
  const toast=(txt,ms=2200)=>{ try{ let n=document.getElementById('tm-toast'); if(!n){ n=document.createElement('div'); n.id='tm-toast'; document.body.appendChild(n); } n.textContent=txt; n.style.display='block'; clearTimeout(n._t); n._t=setTimeout(()=>{ n.style.display='none'; },ms);}catch{} };
  const mountCopyButton=()=>{ if(!document.getElementById('tm-copy-btn')){ const btn=document.createElement('button'); btn.id='tm-copy-btn'; btn.type='button'; btn.title='Copy full thread (auto-load older messages)'; btn.textContent='Copy Thread'; btn.addEventListener('click',()=>copyThread({deep:true})); document.body.appendChild(btn);} };
  new MutationObserver(()=>{ mountBadge(); mountCopyButton(); }).observe(document.documentElement,{childList:true,subtree:true});

  // ---------- Sidebar scroll + last selection ----------
  const KEY='tm_preply_scroll'; const LAST='tm_preply_lasthref'; const qIndex=()=>document.querySelector('[data-qa-id="omni-hub"]');
  const saveScroll=(src)=>{ const el=qIndex(); if(!el) return; const st=el.scrollTop|0; localStorage.setItem(KEY,String(st)); log('saved scrollTop',st,`(${src})`); };
  const restoreScroll=()=>{ const el=qIndex(); if(!el) return; const v=parseInt(localStorage.getItem(KEY)||'0',10)||0; el.scrollTop=v; log('restored scrollTop',v); };
  const rememberClick=(e)=>{ const a=e.target && e.target.closest && e.target.closest('a[href^="/en/messages/"],a[href^="/messages/"]'); if(a){ localStorage.setItem(LAST,a.getAttribute('href')); queueMicrotask(()=>saveScroll('click')); } };
  const focusLast=()=>{ const href=localStorage.getItem(LAST); if(!href) return; const a=document.querySelector(`a[href="${href}"]`); if(a&&a.scrollIntoView){ a.scrollIntoView({block:'center'}); log('restored focus to',href); a.style.outline='2px solid currentColor'; setTimeout(()=>{ a.style.outline=''; },800);} };

  // ---------- Thread detection ----------
  const isScrollable=(el)=>!!el && el.scrollHeight>el.clientHeight && getComputedStyle(el).overflowY.match(/auto|scroll/);
  const ancestors=(el)=>{ const a=[]; for(let n=el; n && n!==document.documentElement; n=n.parentElement) a.push(n); return a; };

  const findThreadContainer=()=> {
    const candSel = [
      '[data-qa-id*="thread" i]','[data-qa-id*="chat" i]','[class*="thread" i]','[class*="conversation" i]','[class*="messages" i]','main [role="region"]'
    ];
    const candidates = candSel.map(s=>[...document.querySelectorAll(s)]).flat();
    const sidebar = qIndex();
    const notInSidebar = (el)=> !sidebar || !sidebar.contains(el);
    const scrollables = candidates.filter(notInSidebar).map(el=>ancestors(el).find(isScrollable)||el).filter(isScrollable);
    let best=null, bestArea=0;
    for(const el of scrollables){ const r=el.getBoundingClientRect(); const area=Math.round(r.width*r.height); if(area>bestArea){ bestArea=area; best=el; } }
    if(!best){
      const all=[...document.querySelectorAll('*')].filter(isScrollable).filter(notInSidebar);
      for(const el of all){ const r=el.getBoundingClientRect(); const area=Math.round(r.width*r.height); if(area>bestArea){ bestArea=area; best=el; } }
    }
    if(best) log('thread container detected:',best);
    return best;
  };

  const waitForThread=async(ms=8000)=>{ const t0=performance.now(); let el=findThreadContainer();
    while(!el && (performance.now()-t0)<ms){ await sleep(200); el=findThreadContainer(); }
    return el;
  };

  // Auto-load older messages by scrolling to the very top repeatedly
  const loadAllAbove=async(el,opts={maxMs:12000,maxPasses:80})=>{
    const t0=performance.now(); let lastHeight=-1; let passes=0;
    el.scrollTop=0; await sleep(200);
    while((performance.now()-t0)<opts.maxMs && passes<opts.maxPasses){
      passes++; const h=el.scrollHeight; if(h===lastHeight) break;
      lastHeight=h; el.scrollTop=0; await sleep(250);
    }
    log('auto-load passes:',passes,'duration(ms):',Math.round(performance.now()-t0));
  };

  // ---------- NEW: per-message extraction with separators ----------
  const collectMessageNodes=(container)=>{
    const sel = [
      '[data-qa-id*="message" i]',
      '[data-qa*="message" i]',
      '[data-testid*="message" i]',
      '[class*="message" i]',
      '[class*="bubble" i]',
      '[class*="msg" i]',
      'article',
      '[role="article"]',
    ].join(',');
    const raw = [...container.querySelectorAll(sel)];
    if(!raw.length) return [container]; // fallback: whole container
    const set = new Set(raw);
    const nodes = [...set].filter(n => ![...set].some(m => m!==n && m.contains(n)));
    nodes.sort((a,b)=> (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    return nodes;
  };

  const cleanNodeText=(n)=>{
    const c = n.cloneNode(true);
    c.querySelectorAll('textarea,input,button,svg,style,script,video,audio,[contenteditable],[role="button"],[data-qa-id*="composer" i],[data-qa-id*="input" i]').forEach(x=>x.remove());
    let t = (c.innerText||'').trim();
    t = t.replace(/\n{3,}/g,'\n\n');
    return t;
  };

  const extractThreadText=(container, {separator=SEPARATOR}={})=>{
    const msgs = collectMessageNodes(container).map(cleanNodeText).filter(Boolean);
    if(!msgs.length){ return (container.innerText||'').trim(); }
    return msgs.join(separator);
  };

  // ---------- Clipboard ----------
  const copyToClipboard=async(text)=>{
    try{ if(typeof GM_setClipboard==='function'){ GM_setClipboard(text,{type:'text',mimetype:'text/plain'}); return true; } }catch{}
    try{ if(navigator.clipboard && window.isSecureContext){ await navigator.clipboard.writeText(text); return true; } }catch{}
    try{ const ta=document.createElement('textarea'); ta.value=text; ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; }catch{}
    return false;
  };

  const copyThread=async({deep=false}={})=>{
    try{
      const container = await waitForThread(12000);
      if(!container){ toast('TM: Could not find the message thread.'); log('copyThread: no container'); return; }
      if(deep) await loadAllAbove(container);
      const text = extractThreadText(container,{separator:SEPARATOR});
      if(!text){ toast('TM: Thread is empty or not detected.'); log('copyThread: empty'); return; }
      const ok = await copyToClipboard(text);
      toast(ok ? `TM: Thread copied (${text.length.toLocaleString()} chars).` : 'TM: Copy failed (clipboard blocked).');
      log('copied thread chars:', text.length);
    }catch(e){ log('copyThread error:',e); toast('TM: Error while copying thread (see console).'); }
  };

  // Shortcut: Ctrl/Cmd + Shift + C
  addEventListener('keydown',(e)=>{ const mac=/Mac/i.test(navigator.platform); const meta=mac?e.metaKey:e.ctrlKey; if(meta && e.shiftKey && (e.key==='C'||e.key==='c')){ e.preventDefault(); copyThread({deep:true}); } },true);

  // TM menu
  try{
    if(typeof GM_registerMenuCommand==='function'){
      GM_registerMenuCommand('Copy current thread (deep)',()=>copyThread({deep:true}));
      GM_registerMenuCommand('Copy current thread (visible only)',()=>copyThread({deep:false}));
    }
  }catch{}

  // ---------- Boot ----------
  const ready=(fn)=> (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded',fn) : fn();

  log('userscript loaded', location.href);
  observeTitle(); mountBadge(); mountCopyButton();

  addEventListener('pageshow',()=>setTimeout(()=>{ ensureTitle(); restoreScroll(); focusLast(); },0));
  ready(()=>{ const idx=qIndex();
    if(idx){
      restoreScroll();
      idx.addEventListener('scroll',()=>{ clearTimeout(idx._tm_t); idx._tm_t=setTimeout(()=>saveScroll('scroll'),120); },{passive:true});
      document.addEventListener('click',rememberClick,true);
      addEventListener('beforeunload',()=>saveScroll('beforeunload'));
    } else {
      log('index not found yet; will retry...');
      const iv=setInterval(()=>{ const el=qIndex(); if(!el) return; clearInterval(iv); log('index found (retry)'); restoreScroll();
        el.addEventListener('scroll',()=>{ clearTimeout(el._tm_t); el._tm_t=setTimeout(()=>saveScroll('scroll'),120); },{passive:true});
        document.addEventListener('click',rememberClick,true);
        addEventListener('beforeunload',()=>saveScroll('beforeunload'));
      },300);
      setTimeout(()=>clearInterval(iv),15000);
    }
  });
})();
