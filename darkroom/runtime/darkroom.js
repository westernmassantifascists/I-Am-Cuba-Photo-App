/* Darkroom VN runtime — plays a story compiled by `darkroom build`.
 * No dependencies. Works in Safari (iOS/macOS), Chrome, Firefox, and inside an itch.io iframe.
 */
(() => {
  'use strict';

  const STORY = window.DARKROOM_STORY;
  if (!STORY) {
    document.body.textContent = 'story.js is missing — run `darkroom build`.';
    return;
  }
  const C = STORY.config;
  const P = STORY.passages;
  const KEY = `darkroom:${C.id || C.title || 'story'}`;
  const DEV = !!STORY.dev;
  const SLOTS = 6;

  // ---------------------------------------------------------------- storage
  // Browser storage can be unavailable (private mode, blocked third-party storage in an iframe).
  // Everything degrades to "no saves" instead of crashing.
  const mem = {};
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(`${KEY}:${k}`);
        return v == null ? (k in mem ? mem[k] : d) : JSON.parse(v);
      } catch {
        return k in mem ? mem[k] : d;
      }
    },
    set(k, v) {
      mem[k] = v;
      try {
        if (v === undefined) localStorage.removeItem(`${KEY}:${k}`);
        else localStorage.setItem(`${KEY}:${k}`, JSON.stringify(v));
      } catch {
        /* storage full or blocked */
      }
    },
  };

  const settings = Object.assign({ music: 0.8, sound: 0.9, cps: C.typewriter ?? 40, auto: 1 }, store.get('settings', {}));
  const endings = store.get('endings', {});

  // ---------------------------------------------------------------- helpers
  const $ = (sel, el = document) => el.querySelector(sel);
  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const url = (rel) => `assets/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const fadeOf = (v, d) => (v === undefined || v === null ? d : v);

  // ---------------------------------------------------------------- state
  let S = {}; // story variables ($name)
  const G = {
    passage: null,
    prev: null,
    visited: {},
    turns: 0,
    media: { bg: null, images: {}, music: null, ambience: null, textbox: true },
    history: [],
    log: [],
    started: false,
  };

  const H = {
    visited: (name) => G.visited[name ?? G.passage] || 0,
    random: (a, b) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a + 1))),
    either: (...xs) => xs[Math.floor(Math.random() * xs.length)],
    ending: (id) => !!endings[id],
    turns: () => G.turns,
    passage: () => G.passage,
    previous: () => G.prev,
    Math,
  };

  const fnCache = new Map();
  function compiled(js, stmt) {
    const k = (stmt ? 's:' : 'e:') + js;
    let f = fnCache.get(k);
    if (!f) {
      // eslint-disable-next-line no-new-func
      f = new Function('S', 'H', `with (H) { ${stmt ? js : `return (${js});`} }`);
      fnCache.set(k, f);
    }
    return f;
  }
  function evaluate(js, stmt = false) {
    try {
      return compiled(js, stmt)(S, H);
    } catch (e) {
      console.error(`[darkroom] in "${G.passage}": ${js}\n`, e);
      if (DEV) toast(`Error in ${G.passage}: ${esc(e.message)}`, 'error');
      return undefined;
    }
  }
  const fill = (html, x) =>
    x ? html.replace(/\u0001(\d+)\u0001/g, (m, i) => {
      const v = evaluate(x[+i]);
      return v === undefined || v === null ? '' : esc(v);
    }) : html;

  // ---------------------------------------------------------------- DOM
  document.documentElement.classList.toggle('dr-dev', DEV);
  const root = $('#dr') || document.body.appendChild(h('div'));
  root.id = 'dr';
  root.className = `dr mode-${C.mode === 'page' ? 'page' : 'vn'}`;
  root.innerHTML = `
    <div class="dr-stage">
      <div class="dr-bg"></div>
      <div class="dr-images"></div>
      <div class="dr-fx"></div>
      <div class="dr-page"><div class="dr-page-inner"></div></div>
      <div class="dr-choices" role="group"></div>
      <div class="dr-box" aria-live="polite">
        <div class="dr-name"></div>
        <div class="dr-body"></div>
        <div class="dr-next" aria-hidden="true">▾</div>
      </div>
      <div class="dr-card"><div class="dr-card-title"></div><div class="dr-card-sub"></div></div>
      <div class="dr-video"></div>
      <nav class="dr-bar">
        <button data-act="back" title="Back (←)">Back</button>
        <button data-act="log" title="Text log (L)">Log</button>
        <button data-act="auto" title="Auto-advance (A)">Auto</button>
        <button data-act="skip" title="Skip to the next choice (S)">Skip</button>
        <button data-act="hide" title="Hide text to see the picture (H)">View</button>
        <button data-act="full" title="Fullscreen (F)">Full</button>
        <button data-act="menu" title="Menu (Esc)">Menu</button>
      </nav>
      <div class="dr-badge"></div>
    </div>
    <div class="dr-title">
      <div class="dr-title-bg"></div>
      <div class="dr-title-inner">
        <h1 class="dr-title-name"></h1>
        <div class="dr-title-sub"></div>
        <div class="dr-title-buttons"></div>
        <div class="dr-title-by"></div>
      </div>
    </div>
    <div class="dr-modal" hidden><div class="dr-panel"></div></div>
    <div class="dr-toasts"></div>`;
  const stage = $('.dr-stage', root);
  const bgEl = $('.dr-bg', root);
  const imagesEl = $('.dr-images', root);
  const fxEl = $('.dr-fx', root);
  const pageEl = $('.dr-page-inner', root);
  const pageScroll = $('.dr-page', root);
  const choicesEl = $('.dr-choices', root);
  const box = $('.dr-box', root);
  const nameEl = $('.dr-name', root);
  const bodyEl = $('.dr-body', root);
  const cardEl = $('.dr-card', root);
  const videoEl = $('.dr-video', root);
  const titleEl = $('.dr-title', root);
  const modal = $('.dr-modal', root);
  const panel = $('.dr-panel', root);
  const badge = $('.dr-badge', root);
  const PAGE = C.mode === 'page';
  if (!document.fullscreenEnabled && !document.webkitFullscreenEnabled) $('[data-act=full]', root).remove();
  document.title = C.title || document.title;

  function toast(html, kind = '') {
    const t = h('div', `dr-toast ${kind}`, html);
    $('.dr-toasts', root).appendChild(t);
    setTimeout(() => t.classList.add('out'), kind === 'error' ? 8000 : 3200);
    setTimeout(() => t.remove(), kind === 'error' ? 8800 : 4000);
  }

  // ---------------------------------------------------------------- audio
  // Volume goes through Web Audio gain nodes when possible, because iOS ignores element.volume.
  const A = {
    ctx: null,
    bus: {},
    ch: { music: null, ambience: null, voice: null },
    unlocked: false,
    unlock() {
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'playback'; // play even with the iPhone ringer off
      } catch {}
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC && location.protocol !== 'file:') {
          this.ctx = new AC();
          for (const b of ['music', 'sound']) {
            this.bus[b] = this.ctx.createGain();
            this.bus[b].connect(this.ctx.destination);
          }
          this.applyVolumes();
        }
      } catch (e) {
        this.ctx = null;
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      // retry anything that was blocked before the first tap
      for (const k of ['music', 'ambience']) if (this.ch[k]) this.ch[k].el.play().catch(() => {});
    },
    applyVolumes() {
      if (this.ctx) {
        this.bus.music.gain.value = settings.music;
        this.bus.sound.gain.value = settings.sound;
      }
      for (const k of ['music', 'ambience', 'voice']) {
        const t = this.ch[k];
        if (t && !t.node) t.el.volume = Math.min(1, t.vol * this.busVol(t.bus));
      }
    },
    busVol(b) {
      return b === 'music' ? settings.music : settings.sound;
    },
    track(src, bus, loop, vol) {
      const el = new Audio();
      el.preload = 'auto';
      el.loop = loop;
      el.src = url(src);
      el.setAttribute('playsinline', '');
      const t = { el, src, bus, vol, node: null };
      if (this.ctx) {
        try {
          const n = this.ctx.createMediaElementSource(el);
          t.node = this.ctx.createGain();
          t.node.gain.value = 0;
          n.connect(t.node).connect(this.bus[bus]);
        } catch {
          t.node = null;
        }
      }
      if (!t.node) el.volume = 0;
      return t;
    },
    ramp(t, to, sec) {
      if (t.node) {
        const g = t.node.gain;
        const now = this.ctx.currentTime;
        g.cancelScheduledValues(now);
        g.setValueAtTime(g.value, now);
        g.linearRampToValueAtTime(to, now + Math.max(0.01, sec));
      } else {
        const from = t.el.volume;
        const target = Math.min(1, to * this.busVol(t.bus));
        const t0 = performance.now();
        clearInterval(t.timer);
        t.timer = setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / (Math.max(0.01, sec) * 1000));
          t.el.volume = from + (target - from) * k;
          if (k >= 1) clearInterval(t.timer);
        }, 30);
      }
    },
    play(ch, src, { fade = 1, volume = 1, loop = true } = {}) {
      const bus = ch === 'music' ? 'music' : 'sound';
      const cur = this.ch[ch];
      if (cur && src && cur.src === src) {
        cur.vol = volume;
        this.ramp(cur, volume, fade);
        return;
      }
      if (cur) this.fadeOut(cur, fade);
      this.ch[ch] = null;
      if (!src) return;
      const t = this.track(src, bus, loop, volume);
      this.ch[ch] = t;
      t.el.play().catch(() => {}); // blocked until the first tap; unlock() retries
      this.ramp(t, volume, fade);
    },
    fadeOut(t, fade) {
      this.ramp(t, 0, fade);
      setTimeout(() => {
        t.el.pause();
        t.el.removeAttribute('src');
        t.el.load();
      }, Math.max(0.01, fade) * 1000 + 60);
    },
    sfx(src, volume = 1, ch = null) {
      if (ch && this.ch[ch]) this.fadeOut(this.ch[ch], 0.1);
      const t = this.track(src, 'sound', false, volume);
      if (t.node) t.node.gain.value = volume;
      else t.el.volume = Math.min(1, volume * settings.sound);
      t.el.play().catch(() => {});
      if (ch) this.ch[ch] = t;
      t.el.addEventListener('ended', () => {
        if (ch && this.ch[ch] === t) this.ch[ch] = null;
      });
    },
    duck(on) {
      for (const k of ['music', 'ambience']) {
        const t = this.ch[k];
        if (t) this.ramp(t, on ? 0 : t.vol, 0.6);
      }
    },
  };

  // ---------------------------------------------------------------- pictures
  function applyBgStyle(el, op) {
    const fit = op.fit || C.bg_fit || 'cover';
    el.style.objectFit = fit;
    el.style.objectPosition = op.pos || 'center';
    if (op.filter) el.style.filter = op.filter;
    if (op.move) {
      el.classList.add(`dr-move-${op.move}`);
      el.style.animationDuration = `${op.time || 20}s`;
    }
  }

  async function setBg(op, instant = false) {
    const fade = instant ? 0 : fadeOf(op.fade, C.bg_fade ?? 1);
    const old = [...bgEl.children];
    G.media.bg = op.src ? { ...op, fade: undefined } : null;
    if (!op.src) {
      old.forEach((o) => {
        o.style.transitionDuration = `${fade}s`;
        o.classList.remove('on');
        setTimeout(() => o.remove(), fade * 1000 + 50);
      });
      return;
    }
    let el;
    if (op.t === 'bgvideo') {
      el = h('video', 'dr-layer');
      Object.assign(el, { muted: true, loop: true, autoplay: true, playsInline: true });
      el.setAttribute('muted', '');
      el.setAttribute('playsinline', '');
      el.src = url(op.src);
      el.play().catch(() => {});
    } else {
      el = h('img', 'dr-layer');
      el.alt = '';
      el.decoding = 'async';
      el.src = url(op.src);
    }
    applyBgStyle(el, op);
    el.style.transitionDuration = `${fade}s`;
    bgEl.appendChild(el);
    if (el.decode) await Promise.race([el.decode().catch(() => {}), sleep(1500)]);
    requestAnimationFrame(() => el.classList.add('on'));
    setTimeout(() => old.forEach((o) => o.remove()), fade * 1000 + 80);
  }

  function setImage(op, instant = false) {
    const fade = instant ? 0 : fadeOf(op.fade, 0.5);
    const id = op.id || op.pos || 'center';
    const kill = (el) => {
      el.style.transitionDuration = `${fade}s`;
      el.classList.remove('on');
      setTimeout(() => el.remove(), fade * 1000 + 50);
    };
    if (!op.src) {
      if (op.id) {
        imagesEl.querySelectorAll(`[data-id="${CSS.escape(op.id)}"]`).forEach(kill);
        delete G.media.images[op.id];
      } else {
        [...imagesEl.children].forEach(kill);
        G.media.images = {};
      }
      return;
    }
    imagesEl.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(kill);
    const el = h('img', `dr-img pos-${(op.pos || 'center').replace(/[^\w-]/g, '')}`);
    el.dataset.id = id;
    el.alt = '';
    el.src = url(op.src);
    if (op.width) el.style.width = op.width;
    el.style.transitionDuration = `${fade}s`;
    imagesEl.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
    G.media.images[id] = { ...op, fade: undefined };
  }

  function applyMedia(m) {
    fxEl.classList.remove('on');
    if (m.bg) setBg(m.bg, true);
    else setBg({ src: null }, true);
    setImage({ src: null }, true);
    for (const op of Object.values(m.images || {})) setImage(op, true);
    for (const k of ['music', 'ambience']) {
      const want = m[k];
      if (want) A.play(k, want.src, { fade: 0.8, volume: want.volume, loop: want.loop });
      else A.play(k, null, { fade: 0.8 });
    }
    showBox(m.textbox !== false);
  }

  function showBox(on) {
    G.media.textbox = on;
    box.classList.toggle('off', !on);
  }

  // ---------------------------------------------------------------- input / waiting
  let waiter = null; // { resolve, kind }
  let typing = null; // { finish }
  let mode = null; // 'auto' | 'skip' | null
  const setMode = (m) => {
    mode = mode === m ? null : m;
    $('[data-act=auto]', root).classList.toggle('on', mode === 'auto');
    $('[data-act=skip]', root).classList.toggle('on', mode === 'skip');
    if (mode && waiter && waiter.kind === 'text') advance();
  };

  function waitFor(kind, ms) {
    return new Promise((resolve) => {
      waiter = { resolve, kind };
      if (ms) setTimeout(() => waiter && waiter.resolve === resolve && advance(), ms);
    });
  }

  function advance() {
    if (typing) {
      typing.finish();
      return;
    }
    if (waiter) {
      const w = waiter;
      waiter = null;
      w.resolve();
    }
  }

  // Reveal HTML text one character at a time without breaking tags.
  function typewrite(el, html, cps) {
    el.innerHTML = html;
    if (!cps || mode === 'skip') return Promise.resolve();
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let total = 0;
    while (walker.nextNode()) {
      nodes.push([walker.currentNode, walker.currentNode.data]);
      total += walker.currentNode.data.length;
      walker.currentNode.data = '';
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      let raf;
      const show = (n) => {
        let left = n;
        for (const [node, full] of nodes) {
          const k = Math.max(0, Math.min(full.length, left));
          node.data = full.slice(0, k);
          left -= full.length;
        }
      };
      const done = () => {
        cancelAnimationFrame(raf);
        show(total);
        typing = null;
        resolve();
      };
      typing = { finish: done };
      const step = () => {
        const n = Math.floor(((performance.now() - t0) / 1000) * cps);
        if (n >= total) return done();
        show(n);
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    });
  }

  // ---------------------------------------------------------------- the player
  let runId = 0;
  let passageCps = null;

  function snapshot(name) {
    return { passage: name, S: clone(S), visited: clone(G.visited), turns: G.turns, prev: G.prev, media: clone(G.media) };
  }

  function restore(snap) {
    S = clone(snap.S);
    G.visited = clone(snap.visited);
    G.turns = snap.turns;
    G.prev = snap.prev;
    G.media = clone(snap.media);
    applyMedia(G.media);
  }

  async function enter(name, opts = {}) {
    const id = ++runId;
    if (!P[name]) {
      toast(`Missing passage: ${esc(name)}`, 'error');
      return;
    }
    if (waiter) waiter = null;
    if (typing) typing.finish();
    if (opts.restore) restore(opts.restore);
    else if (G.passage && !opts.keepPrev) G.prev = G.passage;
    const snap = snapshot(name);
    G.history.push(snap);
    if (G.history.length > 100) G.history.shift();
    if (!opts.noAutosave) store.set('save:auto', makeSave(snap));
    G.passage = name;
    G.visited[name] = (G.visited[name] || 0) + 1;
    G.turns++;
    passageCps = null;
    badge.textContent = name;
    choicesEl.innerHTML = '';
    choicesEl.classList.remove('on');
    if (PAGE) {
      pageEl.innerHTML = '';
      pageScroll.scrollTop = 0;
    }
    emit('passage', name);
    const choices = [];
    const r = await run(P[name].ops, id, choices);
    if (id !== runId || r === 'stop') return;
    showChoices(choices, id);
  }

  async function run(ops, id, choices) {
    for (const op of ops) {
      if (id !== runId) return 'cancel';
      const r = await exec(op, id, choices);
      if (r === 'stop' || r === 'cancel') return r;
    }
    return 'ok';
  }

  async function exec(op, id, choices) {
    switch (op.t) {
      case 'text':
        return showText(op, id);
      case 'choice':
        choices.push(op);
        return;
      case 'bg':
      case 'bgvideo':
        setBg(op);
        return;
      case 'image':
        setImage(op);
        return;
      case 'music':
      case 'ambience':
        G.media[op.t] = op.src ? { src: op.src, volume: op.volume, loop: op.loop } : null;
        A.play(op.t, op.src, { fade: fadeOf(op.fade, op.t === 'music' ? 2 : 1.5), volume: op.volume, loop: op.loop });
        return;
      case 'stop':
        for (const k of op.ch === 'all' ? ['music', 'ambience', 'voice'] : [op.ch]) {
          if (k !== 'voice') G.media[k] = null;
          A.play(k, null, { fade: fadeOf(op.fade, 1.5) });
        }
        return;
      case 'sfx':
        A.sfx(op.src, op.volume);
        return;
      case 'voice':
        A.sfx(op.src, op.volume, 'voice');
        return;
      case 'video':
        return playVideo(op, id);
      case 'wait':
        if (mode === 'skip') return;
        await Promise.race([sleep(op.s * 1000), waitFor('wait')]);
        waiter = null;
        return;
      case 'set':
      case 'run':
        evaluate(op.js, true);
        return;
      case 'if': {
        const b = op.branches.find((br) => evaluate(br.js));
        const ops = b ? b.ops : op.else;
        return ops ? run(ops, id, choices) : undefined;
      }
      case 'goto':
        setTimeout(() => id === runId && enter(op.target), 0);
        return 'stop';
      case 'include':
        return run(P[op.target]?.ops || [], id, choices);
      case 'ending':
        unlockEnding(op);
        return;
      case 'card':
        return showCard(op, id);
      case 'clear':
        if (PAGE) pageEl.innerHTML = '';
        else {
          bodyEl.innerHTML = '';
          nameEl.textContent = '';
        }
        return;
      case 'textbox':
        showBox(op.show);
        return;
      case 'fx':
        return fx(op);
      case 'speed':
        passageCps = op.cps;
        return;
      default:
        console.warn('[darkroom] unknown op', op);
    }
  }

  async function showText(op, id) {
    const html = fill(op.html, op.x);
    const who = op.who ? C.characters?.[op.who] || {} : null;
    const whoName = op.who ? who.name || op.who : '';
    G.log.push({ who: whoName, html });
    if (G.log.length > 400) G.log.shift();
    if (PAGE) {
      const p = h('p', op.who ? 'said' : '', (whoName ? `<b class="who" style="color:${esc(who.color || '')}">${esc(whoName)}</b> ` : '') + html);
      pageEl.appendChild(p);
      requestAnimationFrame(() => p.classList.add('on'));
      return;
    }
    showBox(true); // a line of text always brings the box back after @textbox hide
    nameEl.textContent = whoName;
    nameEl.style.color = who?.color || '';
    nameEl.classList.toggle('on', !!whoName);
    box.classList.toggle('said', !!op.who);
    box.classList.remove('ready');
    await typewrite(bodyEl, html, passageCps ?? settings.cps);
    if (id !== runId) return 'cancel';
    box.classList.add('ready');
    const autoMs = mode === 'skip' ? 40 : mode === 'auto' ? (1200 + bodyEl.textContent.length * 45) / settings.auto : 0;
    await waitFor('text', autoMs);
    if (id !== runId) return 'cancel';
  }

  function showChoices(choices, id) {
    if (mode === 'skip') setMode('skip');
    choicesEl.innerHTML = '';
    if (!choices.length) {
      // passage ended without choices: an ending, or a dead end
      const b = h('button', 'dr-choice end', G.endingHere ? 'Return to title' : 'The End — return to title');
      b.onclick = () => toTitle();
      choicesEl.appendChild(b);
      if (G.endingHere) {
        const e = h('button', 'dr-choice end', 'Endings found');
        e.onclick = () => openEndings();
        choicesEl.appendChild(e);
      }
    }
    G.endingHere = false;
    choices.forEach((c, i) => {
      const b = h('button', 'dr-choice', fill(c.html, c.x));
      b.dataset.key = i + 1;
      if (G.visited[c.target] && C.mark_visited !== false) b.classList.add('seen');
      b.onclick = (e) => {
        e.stopPropagation();
        if (id !== runId) return;
        A.unlock();
        if (c.set) evaluate(c.set, true);
        enter(c.target);
      };
      choicesEl.appendChild(b);
    });
    if (PAGE) pageEl.appendChild(choicesEl);
    requestAnimationFrame(() => choicesEl.classList.add('on'));
    preload(G.passage);
  }

  function unlockEnding(op) {
    G.endingHere = true;
    if (!endings[op.id]) {
      endings[op.id] = { title: op.title, date: Date.now() };
      store.set('endings', endings);
      const total = (STORY.endings || []).length;
      toast(`Ending unlocked: <b>${esc(op.title)}</b>${total ? ` (${Object.keys(endings).length}/${total})` : ''}`);
    }
    emit('ending', op.id);
  }

  async function showCard(op, id) {
    $('.dr-card-title', cardEl).textContent = op.title;
    $('.dr-card-sub', cardEl).textContent = op.sub || '';
    cardEl.classList.add('on');
    box.classList.add('hidden-by-card');
    if (mode !== 'skip') await waitFor('card', op.s ? op.s * 1000 : 0);
    waiter = null;
    cardEl.classList.remove('on');
    box.classList.remove('hidden-by-card');
    await sleep(400);
    if (id !== runId) return 'cancel';
  }

  async function fx(op) {
    const s = op.s ?? (op.kind === 'shake' ? 0.5 : op.kind === 'flash' ? 0.6 : 1.5);
    if (op.kind === 'shake') {
      stage.classList.remove('dr-shake');
      void stage.offsetWidth;
      stage.style.animationDuration = `${s}s`;
      stage.classList.add('dr-shake');
      return;
    }
    if (op.kind === 'fadein') {
      fxEl.style.transitionDuration = `${s}s`;
      fxEl.classList.remove('on');
      if (mode !== 'skip') await sleep(s * 1000);
      return;
    }
    const half = op.kind === 'flash' ? s / 2 : s;
    fxEl.style.background = op.color || (op.kind === 'flash' ? '#fff' : '#000');
    fxEl.style.transitionDuration = `${half}s`;
    fxEl.classList.add('on');
    if (mode !== 'skip') await sleep(half * 1000);
    if (op.kind === 'flash') {
      fxEl.classList.remove('on');
      await sleep(half * 1000);
    }
  }

  function playVideo(op, id) {
    return new Promise((resolve) => {
      const v = h('video');
      v.src = url(op.src);
      v.playsInline = true;
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      v.volume = Math.min(1, (op.volume ?? 1) * settings.sound);
      v.style.objectFit = op.fit || 'contain';
      videoEl.innerHTML = '';
      videoEl.appendChild(v);
      videoEl.classList.add('on');
      A.duck(true);
      let finished = false;
      const end = () => {
        if (finished) return;
        finished = true;
        waiter = null;
        v.pause();
        videoEl.classList.remove('on');
        setTimeout(() => (videoEl.innerHTML = ''), 400);
        A.duck(false);
        resolve(id === runId ? undefined : 'cancel');
      };
      v.addEventListener('ended', end);
      v.addEventListener('error', () => {
        console.warn('[darkroom] video failed', op.src);
        end();
      });
      if (op.skip) {
        const hint = h('div', 'dr-video-hint', 'tap to skip');
        videoEl.appendChild(hint);
        waitFor('video').then(end);
      }
      v.play().catch(() => {
        // autoplay with sound refused (rare after a tap): ask for one more tap
        const b = h('button', 'dr-video-play', '▶ Play');
        b.onclick = (e) => {
          e.stopPropagation();
          b.remove();
          v.play().catch(end);
        };
        videoEl.appendChild(b);
      });
    });
  }

  // Load the pictures (and small sounds) of the passages the player can go to next.
  const preloaded = new Set();
  function preload(name) {
    const meta = STORY.assets || {};
    for (const t of P[name]?.links || []) {
      for (const rel of P[t]?.assets || []) {
        if (preloaded.has(rel)) continue;
        preloaded.add(rel);
        const m = meta[rel] || {};
        if (m.type === 'image') new Image().src = url(rel);
        else if (m.type === 'audio' && (m.bytes || 0) < 4e6) fetch(url(rel)).catch(() => {});
      }
    }
  }

  // ---------------------------------------------------------------- saves
  function makeSave(snap) {
    return { snap, date: Date.now(), passage: snap.passage, bg: snap.media.bg?.src || null, line: G.log.at(-1)?.html?.replace(/<[^>]+>/g, '').slice(0, 90) || '' };
  }
  function save(slot) {
    const snap = G.history.at(-1);
    if (!snap) return;
    store.set(`save:${slot}`, makeSave(snap));
    toast('Saved');
  }
  function load(slot) {
    const s = store.get(`save:${slot}`);
    if (!s || !P[s.snap.passage]) return toast('That save is empty or from an older version.', 'error');
    closeModal();
    startGame(s.snap);
  }
  function back() {
    if (G.history.length < 2) return;
    G.history.pop();
    const prev = G.history.pop();
    enter(prev.passage, { restore: prev, keepPrev: true });
  }

  // ---------------------------------------------------------------- menus
  function openModal(html, cls = '') {
    panel.className = `dr-panel ${cls}`;
    panel.innerHTML = `<button class="dr-close" data-act="close" aria-label="Close">✕</button>${html}`;
    modal.hidden = false;
    G.modal = true;
  }
  function closeModal() {
    modal.hidden = true;
    G.modal = false;
  }

  function openMenu() {
    const inGame = G.started;
    openModal(
      `<h2>${esc(C.title || 'Menu')}</h2>
      <div class="dr-menu">
        ${inGame ? '<button data-act="save">Save</button>' : ''}
        <button data-act="load">Load</button>
        ${inGame ? '<button data-act="log">Text log</button>' : ''}
        <button data-act="settings">Settings</button>
        ${(STORY.endings || []).length ? '<button data-act="endings">Endings</button>' : ''}
        ${inGame ? '<button data-act="title">Return to title</button>' : ''}
      </div>`,
      'menu',
    );
  }

  function openSlots(saving) {
    const rows = [];
    const slots = saving ? [] : ['auto'];
    for (let i = 1; i <= SLOTS; i++) slots.push(i);
    for (const s of slots) {
      const d = store.get(`save:${s}`);
      const thumb = d?.bg ? `<img src="${url(d.bg)}" alt="">` : '<span></span>';
      rows.push(`<button class="dr-slot" data-slot="${s}" ${!saving && !d ? 'disabled' : ''}>
        ${thumb}<span><b>${s === 'auto' ? 'Autosave' : `Slot ${s}`}</b>
        <small>${d ? `${new Date(d.date).toLocaleString()} — ${esc(d.passage)}` : 'Empty'}</small>
        ${d?.line ? `<em>${esc(d.line)}</em>` : ''}</span></button>`);
    }
    openModal(`<h2>${saving ? 'Save' : 'Load'}</h2><div class="dr-slots" data-mode="${saving ? 'save' : 'load'}">${rows.join('')}</div>`, 'slots');
  }

  function openLog() {
    const items = G.log
      .slice(-150)
      .map((l) => `<p>${l.who ? `<b>${esc(l.who)}</b> ` : ''}${l.html}</p>`)
      .join('');
    openModal(`<h2>Text log</h2><div class="dr-log">${items || '<p>Nothing yet.</p>'}</div>`, 'log');
    const lg = $('.dr-log', panel);
    lg.scrollTop = lg.scrollHeight;
  }

  function openSettings() {
    const row = (k, label, min, max, step) =>
      `<label>${label}<input type="range" data-set="${k}" min="${min}" max="${max}" step="${step}" value="${settings[k]}"><output>${settings[k]}</output></label>`;
    openModal(
      `<h2>Settings</h2><div class="dr-settings">
        ${row('music', 'Music volume', 0, 1, 0.05)}
        ${row('sound', 'Sound volume', 0, 1, 0.05)}
        ${row('cps', 'Text speed (0 = instant)', 0, 120, 5)}
        ${row('auto', 'Auto-advance speed', 0.5, 3, 0.25)}
      </div>`,
      'settings',
    );
  }

  function openEndings() {
    const all = STORY.endings || [];
    const found = all.filter((e) => endings[e.id]).length;
    const items = all
      .map((e) => (endings[e.id] ? `<li class="got"><b>${esc(e.title)}</b><small>${new Date(endings[e.id].date).toLocaleDateString()}</small></li>` : '<li>???</li>'))
      .join('');
    openModal(`<h2>Endings</h2><p class="dr-count">${found} of ${all.length} found</p><ul class="dr-endings">${items}</ul>`, 'endings');
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) return closeModal();
    const b = e.target.closest('button');
    if (!b) return;
    const act = b.dataset.act;
    if (b.dataset.slot) {
      const mode = b.closest('.dr-slots').dataset.mode;
      if (mode === 'save') {
        save(b.dataset.slot);
        openSlots(true);
      } else load(b.dataset.slot);
      return;
    }
    if (act === 'close') closeModal();
    else if (act === 'save') openSlots(true);
    else if (act === 'load') openSlots(false);
    else if (act === 'log') openLog();
    else if (act === 'settings') openSettings();
    else if (act === 'endings') openEndings();
    else if (act === 'title') {
      closeModal();
      toTitle();
    } else if (act === 'new') {
      closeModal();
      startGame();
    }
  });
  modal.addEventListener('input', (e) => {
    const k = e.target.dataset.set;
    if (!k) return;
    settings[k] = parseFloat(e.target.value);
    e.target.nextElementSibling.textContent = e.target.value;
    store.set('settings', settings);
    A.applyVolumes();
  });

  // ---------------------------------------------------------------- title screen
  function toTitle() {
    ++runId;
    waiter = null;
    G.started = false;
    root.classList.remove('playing');
    titleEl.classList.add('on');
    const ts = C.title_screen || {};
    $('.dr-title-name', titleEl).textContent = C.title || '';
    $('.dr-title-sub', titleEl).textContent = ts.subtitle || '';
    $('.dr-title-by', titleEl).textContent = C.author ? `by ${C.author}` : '';
    const tbg = $('.dr-title-bg', titleEl);
    tbg.innerHTML = ts.background_src ? `<img src="${url(ts.background_src)}" alt="">` : '';
    const auto = store.get('save:auto');
    const btns = [];
    if (auto && P[auto.snap.passage]) btns.push('<button data-t="continue">Continue</button>');
    btns.push('<button data-t="new">New game</button>');
    if (hasSaves()) btns.push('<button data-t="load">Load</button>');
    if ((STORY.endings || []).length && Object.keys(endings).length) btns.push('<button data-t="endings">Endings</button>');
    btns.push('<button data-t="settings">Settings</button>');
    $('.dr-title-buttons', titleEl).innerHTML = btns.join('');
    A.play('ambience', null, { fade: 1 });
    if (ts.music_src) A.play('music', ts.music_src, { fade: 1.5 });
    else A.play('music', null, { fade: 1.5 });
  }
  function hasSaves() {
    for (let i = 1; i <= SLOTS; i++) if (store.get(`save:${i}`)) return true;
    return !!store.get('save:auto');
  }
  titleEl.addEventListener('click', (e) => {
    A.unlock();
    const b = e.target.closest('button');
    if (!b) return;
    const t = b.dataset.t;
    if (t === 'new') startGame();
    else if (t === 'continue') startGame(store.get('save:auto').snap);
    else if (t === 'load') openSlots(false);
    else if (t === 'endings') openEndings();
    else if (t === 'settings') openSettings();
  });

  function startGame(snap) {
    titleEl.classList.remove('on');
    root.classList.add('playing');
    G.started = true;
    G.history = [];
    G.log = [];
    G.passage = null;
    if (snap) {
      enter(snap.passage, { restore: snap, noAutosave: true });
      return;
    }
    S = {};
    G.visited = {};
    G.turns = 0;
    G.prev = null;
    G.media = { bg: null, images: {}, music: null, ambience: null, textbox: true };
    applyMedia(G.media);
    const id = ++runId;
    run(STORY.init || [], id, []).then(() => enter(STORY.start));
  }

  // ---------------------------------------------------------------- events
  const listeners = {};
  function emit(ev, arg) {
    for (const f of listeners[ev] || []) {
      try {
        f(arg);
      } catch (e) {
        console.error(e);
      }
    }
  }

  stage.addEventListener('click', (e) => {
    A.unlock();
    const link = e.target.closest('.dr-link');
    if (link) {
      e.stopPropagation();
      if (link.dataset.set) evaluate(link.dataset.set, true);
      enter(link.dataset.goto);
      return;
    }
    const btn = e.target.closest('.dr-bar button');
    if (btn) return bar(btn.dataset.act);
    if (e.target.closest('.dr-choice, .dr-video-play')) return;
    if (root.classList.contains('ui-hidden')) {
      root.classList.remove('ui-hidden');
      return;
    }
    if (mode === 'auto') setMode('auto');
    advance();
  });

  function bar(act) {
    if (act === 'menu') openMenu();
    else if (act === 'back') back();
    else if (act === 'log') openLog();
    else if (act === 'auto') setMode('auto');
    else if (act === 'skip') setMode('skip');
    else if (act === 'hide') root.classList.toggle('ui-hidden');
    else if (act === 'full') {
      const el = document.documentElement;
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    A.unlock();
    if (e.key === 'Escape') return G.modal ? closeModal() : G.started ? openMenu() : null;
    if (G.modal || !G.started) return;
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (root.classList.contains('ui-hidden')) root.classList.remove('ui-hidden');
      else advance();
    } else if (/^[1-9]$/.test(e.key)) {
      const b = choicesEl.querySelector(`.dr-choice[data-key="${e.key}"]`);
      if (b && choicesEl.classList.contains('on')) b.click();
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') back();
    else if (e.key === 'h' || e.key === 'H') bar('hide');
    else if (e.key === 'a' || e.key === 'A') bar('auto');
    else if (e.key === 's' || e.key === 'S') bar('skip');
    else if (e.key === 'l' || e.key === 'L') bar('log');
    else if (e.key === 'f' || e.key === 'F') bar('full');
    else if (DEV && e.key === '`') openDebug();
  });

  // ---------------------------------------------------------------- dev tools
  function openDebug() {
    const names = Object.keys(P).sort();
    openModal(
      `<h2>Debug</h2>
      <p>Passage: <b>${esc(G.passage || '')}</b></p>
      <label>Jump to <select class="dr-jump">${names.map((n) => `<option ${n === G.passage ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <button class="dr-go">Go</button>
      <h3>Variables</h3><textarea class="dr-vars" spellcheck="false">${esc(JSON.stringify(S, null, 2))}</textarea>
      <button class="dr-apply">Apply variables</button>`,
      'debug',
    );
    $('.dr-go', panel).onclick = () => {
      closeModal();
      if (!G.started) {
        titleEl.classList.remove('on');
        root.classList.add('playing');
        G.started = true;
      }
      enter($('.dr-jump', panel).value);
    };
    $('.dr-apply', panel).onclick = () => {
      try {
        S = JSON.parse($('.dr-vars', panel).value);
        toast('Variables updated');
      } catch (e) {
        toast(esc(e.message), 'error');
      }
    };
  }

  // ---------------------------------------------------------------- public API (for script passages)
  window.Darkroom = {
    get state() {
      return S;
    },
    set state(v) {
      S = v;
    },
    helpers: H,
    go: (name) => enter(name),
    on: (ev, f) => (listeners[ev] ||= []).push(f),
    story: STORY,
    toast,
  };

  if (DEV) {
    for (const w of STORY.warnings || []) console.warn('[darkroom]', w);
    if ((STORY.errors || []).length) toast(`${STORY.errors.length} story error(s) — see the terminal`, 'error');
  }
  toTitle();
  if (DEV && location.hash.length > 1) {
    const target = decodeURIComponent(location.hash.slice(1));
    if (P[target]) {
      startGame();
      setTimeout(() => enter(target), 50);
    }
  }
})();
