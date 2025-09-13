// ==UserScript==
// @name         Preply Messages — TM Guard
// @version      2.9.2
// @description  Keep [TM] in tab title; persist sidebar scroll; restore last thread; copy FULL thread with separators.
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

  // ---------- Title guard ----------
  const PREFIX='[TM] ';
  const ensureTitle=()=>{ try{ const t=document.title||''; if(!t.startsWith(PREFIX)){ document.title=PREFIX+t.replace(/^\[TM\]\s*/,''); log('title patched →',document.title);} }catch{} };
  const wireTitle=()=>{ let titleEl=document.querySelector('head > title'); if(!titleEl){ titleEl=document.createElement('title'); document.head.appendChild(titleEl); }
    const tn=titleEl.firstChild||titleEl.appendChild(document.createTextNode(document.title||'')); new MutationObserver(ensureTitle).observe(tn,{characterData:true});
    new MutationObserver(ensureTitle).observe(document.head,{childList:true,subtree:true});
    ['pushState','replaceState'].forEach(fn=>{ const orig=history[fn]; history[fn]=function(...args){ const r=orig.apply(this,args); queueMicrotask(()=>dispatchEvent(new Event('tm:route'))); queueMicrotask(ensureTitle); return r; };});
    addEventListener('popstate',()=>{ ensureTitle(); dispatchEvent(new Event('tm:route')); });
    addEventListener('visibilitychange',ensureTitle);
    ensureTitle();
  };

  // ---------- UI ----------
  addStyle(`#tm-guard-badge{position:fixed;left:8px;bottom:8px;padding:2px 6px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;pointer-events:none}
  #tm-toast{position:fixed;right:12px;bottom:12px;max-width:70ch;background:rgba(0,0,0,.85);color:#fff;padding:.5rem .6rem;border-radius:10px;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.3)}
  #tm-copy-btn{position:fixed;top:72px;right:12px;padding:.35rem .55rem;border-radius:10px;background:rgba(0,0,0,.6);color:#fff;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;z-index:2147483647;border:0;cursor:pointer}
  #tm-copy-btn:hover{background:rgba(0,0,0,.75)}`);
  const mountBadge=()=>{ if(!document.getElementById('tm-guard-badge')){ const b=document.createElement('div'); b.id='tm-guard-badge'; b.textContent='TM: Guard ON'; (document.documentElement||document.body).appendChild(b);} };
  const toast=(txt,ms=2200)=>{ try{ let n=document.getElementById('tm-toast'); if(!n){ n=document.createElement('div'); n.id='tm-toast'; document.body.appendChild(n); } n.textContent=txt; n.style.display='block'; clearTimeout(n._t); n._t=setTimeout(()=>{ n.style.display='none'; },ms);}catch{} };
  const mountCopyButton=()=>{ if(!document.getElementById('tm-copy-btn')){ const btn=document.createElement('button'); btn.id='tm-copy-btn'; btn.type='button'; btn.title='Copy full thread (auto-load older messages)'; btn.textContent='Copy Thread'; btn.addEventListener('click',()=>copyThread({deep:true})); document.body.appendChild(btn);} };
  new MutationObserver(()=>{ mountBadge(); mountCopyButton(); }).observe(document.documentElement,{childList:true,subtree:true});

  // ---------- Sidebar scroll (hardened) ----------
  const KEY='tm_preply_scroll';
  const LAST='tm_preply_lasthref';

  const isScrollable=(el)=>!!el && el.scrollHeight>el.clientHeight && /auto|scroll/i.test(getComputedStyle(el).overflowY||'');
  const ancestors=(el)=>{ const a=[]; for(let n=el; n && n!==document.documentElement; n=n.parentElement) a.push(n); return a; };

  // Find the sidebar: prefer known qa-id; otherwise choose the scrollable ancestor with the most /messages/* links (robust to DOM changes/locales)
  const findIndexContainer=()=>{
    let el=document.querySelector('[data-qa-id="omni-hub"]');
    if(el) return el;
    const links=[...document.querySelectorAll('a[href^="/en/messages/"],a[href^="/messages/"]')];
    if(!links.length) return null;
    const counts=new Map();
    for(const a of links){
      const sc=ancestors(a).find(isScrollable);
      if(!sc) continue;
      counts.set(sc,(counts.get(sc)||0)+1);
    }
    let best=null, bestCount=0;
    for(const [sc,c] of counts.entries()){ if(c>bestCount){ best=sc; bestCount=c; } }
    return best;
  };

  const qIndex=()=>findIndexContainer();

  const saveScroll=(src)=>{ const el=qIndex(); if(!el) return; const st=el.scrollTop|0; localStorage.setItem(KEY,String(st)); log('saved scrollTop',st,`(${src})`); };
  const saveLastFromEvent=(e)=>{ const a=e.target && e.target.closest && e.target.closest('a[href^="/en/messages/"],a[href^="/messages/"]'); if(a){ localStorage.setItem(LAST,a.getAttribute('href')); queueMicrotask(()=>saveScroll('click')); } };

  const stickyRestore=(el,target,{ms=2500}={})=>{
    const t0=performance.now();
    (function tick(){
      if(performance.now()-t0>ms) return;
      if(Math.abs(el.scrollTop-target)>1) el.scrollTop=target;
      requestAnimationFrame(tick);
    })();
  };

  const doRestore=()=>{
    const el=qIndex(); if(!el){ log('restore: index container not found'); return false; }
    const v=parseInt(localStorage.getItem(KEY)||'0',10)||0;
    const href=localStorage.getItem(LAST)||'';
    let did=false;
    if(href){
      const a=document.querySelector(`a[href="${href}"]`);
      if(a && a.scrollIntoView){ a.scrollIntoView({block:'center'}); a.style.outline='2px solid currentColor'; setTimeout(()=>{ a.style.outline=''; },700); log('focus restored →', href); did=true; }
    }
    if(v){ stickyRestore(el, v); log('restore attempt →', v); did=true; }
    return did;
  };

  const armIndexObserver=()=>{
    const el=qIndex(); if(!el || el._tmObserved) return;
    el._tmObserved=true;
    const mo=new MutationObserver(()=>{ doRestore(); });
    mo.observe(el,{childList:true,subtree:true});
    el.addEventListener('scroll',()=>{ clearTimeout(el._tm_t); el._tm_t=setTimeout(()=>saveScroll('scroll'),120); },{passive:true});
    log('index observer armed');
  };

  // After a route/reload, keep retrying restore until it sticks or we time out
  const navRestoreLoop=(label)=>{
    log('navRestore start:', label);
    const t0=performance.now();
    let tries=0, applied=false;
    const iv=setInterval(()=>{
      tries++;
      const el=qIndex();
      if(el){
        armIndexObserver();
        const did=doRestore();
        applied = applied || did;
        // Stop when we’ve applied and the list isn’t at the very top anymore
        if(did && el.scrollTop>0){
          clearInterval(iv);
          log('navRestore done in', Math.round(performance.now()-t0),'ms; tries=',tries,'scrollTop=',el.scrollTop);
        }
      }
      if(performance.now()-t0>12000){
        clearInterval(iv);
        log('navRestore timeout after', tries, 'tries');
      }
    },150);
  };

  // Fire the loop at all the likely times
  addEventListener('pageshow', ()=> navRestoreLoop('pageshow'));
  addEventListener('tm:route', ()=> navRestoreLoop('tm:route'));
  addEventListener('popstate', ()=> navRestoreLoop('popstate'));
  addEventListener('DOMContentLoaded', ()=> setTimeout(()=>navRestoreLoop('domcontentloaded'), 100));

  // Aggressive save to survive hard reloads
  addEventListener('beforeunload',()=>saveScroll('beforeunload'));
  addEventListener('pagehide',()=>saveScroll('pagehide'));
  document.addEventListener('click', saveLastFromEvent, true);

  // ---------- Thread copy (with separators & deep load) ----------
  const SEPARATOR = '\n\n────────────────────────────────\n\n';
  const findThreadContainer=()=> {
    const sel = [
      '[data-qa-id*="thread" i]','[data-qa-id*="chat" i]','[data-qa-id*="conversation" i]',
      '[data-testid*="message" i]','[class*="thread" i]','[class*="conversation" i]','[class*="messages" i]',
      'main [role="region"]'
    ];
    const cands = sel.map(s=>[...document.querySelectorAll(s)]).flat();
    const sidebar=qIndex(); const notInSidebar=(el)=> !sidebar || !sidebar.contains(el);
    const scrollables = cands.filter(notInSidebar).map(el=>ancestors(el).find(isScrollable)||el).filter(isScrollable);
    let best=null, bestArea=0;
    for(const el of scrollables){ const r=el.getBoundingClientRect(); const area=Math.round(r.width*r.height); if(area>bestArea){ bestArea=area; best=el; } }
    if(!best){ const all=[...document.querySelectorAll('*')].filter(isScrollable).filter(notInSidebar);
      for(const el of all){ const r=el.getBoundingClientRect(); const area=Math.round(r.width*r.height); if(area>bestArea){ bestArea=area; best=el; } }
    }
    if(best) log('thread container:',best);
    return best;
  };
  const waitForThread=async(ms=8000)=>{ const t0=performance.now(); let el=findThreadContainer();
    while(!el && (performance.now()-t0)<ms){ await sleep(200); el=findThreadContainer(); }
    return el;
  };
  const loadAllAbove=async(el,opts={maxMs:12000,maxPasses:80})=>{
    const t0=performance.now(); let lastHeight=-1; let passes=0;
    el.scrollTop=0; await sleep(200);
    while((performance.now()-t0)<opts.maxMs && passes<opts.maxPasses){
      passes++; const h=el.scrollHeight; if(h===lastHeight) break;
      lastHeight=h; el.scrollTop=0; await sleep(250);
    }
    log('auto-load passes:',passes,'duration(ms):',Math.round(performance.now()-t0));
  };
  const collectMessageNodes=(container)=>{
    const sel = [
      '[data-qa-id*="message" i]','[data-qa*="message" i]','[data-testid*="message" i]',
      '[role="listitem"]','[class*="message" i]','[class*="bubble" i]','[class*="msg" i]','article,[role="article"]'
    ].join(',');
    const raw = [...container.querySelectorAll(sel)];
    if(!raw.length) return [container];
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
  const escapeRe = (s)=> s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const segmentByHeuristics=(s, sep=SEPARATOR)=>{
    if(!s) return s;
    s = s.replace(/([A-Za-z.])(\d{1,2}:\d{2})(?!\d)/g, '$1 $2'); // “Mark S.03:10” → “Mark S. 03:10”
    s = s.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Za-z]{3}\b/g, '\n$&\n');
    const boundary = new RegExp(`(?<!^)\\s*(?=(?:Preply|Sent|Seen by|[A-Z]{2,5}|[A-Z][A-Za-z]+(?:\\s[A-Z][A-Za-z.]+)*)\\s?\\d{1,2}:\\d{2}\\b)`, 'g');
    s = s.replace(boundary, sep);
    const dateHead = /(?<!^)\s*(?=(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\d{1,2}\s+[A-Za-z]{3}\b)/g;
    s = s.replace(dateHead, sep);
    s = s.replace(new RegExp(`${escapeRe(sep)}{2,}`, 'g'), sep);
    s = s.replace(/\n{3,}/g, '\n\n').trim();
    return s;
  };
  const extractThreadText=(container,{separator=SEPARATOR}={})=>{
    const msgs = collectMessageNodes(container).map(cleanNodeText).filter(Boolean);
    if(msgs.length >= 3) return msgs.join(separator);
    const whole = (container.innerText||'').trim();
    const segmented = segmentByHeuristics(whole, separator);
    return segmented || whole;
  };
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
      const count = text.split(SEPARATOR).length;
      const ok = await copyToClipboard(text);
      toast(ok ? `TM: Thread copied (${count} parts, ${text.length.toLocaleString()} chars).` : 'TM: Copy failed (clipboard blocked).');
      log('copied thread parts:', count, 'chars:', text.length);
    }catch(e){ log('copyThread error:',e); toast('TM: Error while copying thread (see console).'); }
  };
  addEventListener('keydown',(e)=>{ const mac=/Mac/i.test(navigator.platform); const meta=mac?e.metaKey:e.ctrlKey; if(meta && e.shiftKey && (e.key==='C'||e.key==='c')){ e.preventDefault(); copyThread({deep:true}); } },true);
  try{
    if(typeof GM_registerMenuCommand==='function'){
      GM_registerMenuCommand('Copy current thread (deep)',()=>copyThread({deep:true}));
      GM_registerMenuCommand('Copy current thread (visible only)',()=>copyThread({deep:false}));
    }
  }catch{}

  // ---------- Boot ----------
  const ready=(fn)=> (document.readyState==='loading') ? document.addEventListener('DOMContentLoaded',fn) : fn();
  log('userscript loaded', location.href);
  wireTitle(); mountBadge(); mountCopyButton();
  ready(()=>{ navRestoreLoop('ready'); });

  // Extra: log saves from clicks
  document.addEventListener('click', (e)=>{ /* already saving via saveLastFromEvent */ }, true);
  document.addEventListener('click', saveLastFromEvent, true);
  addEventListener('beforeunload',()=>saveScroll('beforeunload'));
})();
