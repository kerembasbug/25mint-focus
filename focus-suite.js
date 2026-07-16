/*!
 * 25Mint Focus Suite — portable focus toolkit engine
 * Vanilla JS, zero dependencies. All state in localStorage under `25mint.*`.
 * Designed to be lifted unchanged into a PWA / Capacitor shell later.
 * Modules: Timer (Pomodoro) · Sounds (procedural noise) · Breathe · Stats · Tasks
 */
(function (window, document) {
  'use strict';

  /* ============================ State ============================ */
  var State = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem('25mint.' + key);
        return raw ? JSON.parse(raw) : (fallback === undefined ? null : fallback);
      } catch (e) { return fallback === undefined ? null : fallback; }
    },
    set: function (key, val) {
      try { localStorage.setItem('25mint.' + key, JSON.stringify(val)); } catch (e) {}
    }
  };

  function todayKey() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /* ============================ Audio (shared context) ============================ */
  var _ctx = null;
  function ctx() {
    if (!_ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) _ctx = new AC();
    }
    if (_ctx && _ctx.state === 'suspended') { _ctx.resume(); }
    return _ctx;
  }

  // Short pleasant chime on session end
  function chime() {
    var c = ctx(); if (!c) return;
    var now = c.currentTime;
    [0, 0.18, 0.36].forEach(function (t, i) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.value = [660, 880, 1046][i];
      g.gain.setValueAtTime(0.0001, now + t);
      g.gain.exponentialRampToValueAtTime(0.35, now + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.45);
      o.connect(g); g.connect(c.destination);
      o.start(now + t); o.stop(now + t + 0.5);
    });
  }

  /* ============================ Notifications ============================ */
  var Notify = {
    supported: function () { return 'Notification' in window; },
    // Ask once, only on a real user gesture (first Start). Never blocks the timer.
    request: function () {
      if (!this.supported()) return;
      try {
        if (Notification.permission === 'default') { Notification.requestPermission(); }
      } catch (e) {}
    },
    fire: function (title, body) {
      if (!this.supported() || Notification.permission !== 'granted') return;
      // Only notify when the tab is hidden — otherwise the on-screen chime + card is enough
      if (document.visibilityState === 'visible') return;
      try {
        var opts = { body: body, tag: '25mint-focus', renotify: true };
        if (window.FS_NOTIFY_ICON) opts.icon = window.FS_NOTIFY_ICON;
        var n = new Notification(title, opts);
        n.onclick = function () { window.focus(); n.close(); };
      } catch (e) {}
    }
  };

  /* ============================ Timer (Pomodoro) singleton ============================ */
  var PRESETS = {
    '25/5':  { focus: 25 * 60, short: 5 * 60,  long: 15 * 60, label: '25 / 5' },
    '50/10': { focus: 50 * 60, short: 10 * 60, long: 20 * 60, label: '50 / 10' },
    '15/3':  { focus: 15 * 60, short: 3 * 60,  long: 10 * 60, label: '15 / 3' }
  };

  /* ============================ Settings ============================ */
  var Settings = {
    defaults: { autostart: false, sound: true, notify: true, theme: 'auto', dailyGoal: 4, custom: { focus: 25, short: 5, long: 15 } },
    load: function () {
      var s = State.get('settings', null);
      if (!s) return JSON.parse(JSON.stringify(this.defaults));
      s.custom = s.custom || JSON.parse(JSON.stringify(this.defaults.custom));
      if (s.autostart === undefined) s.autostart = false;
      if (s.sound === undefined) s.sound = true;
      if (s.notify === undefined) s.notify = true;
      if (s.theme === undefined) s.theme = 'auto';
      if (s.dailyGoal === undefined) s.dailyGoal = 4;
      return s;
    },
    save: function (s) { State.set('settings', s); }
  };

  var Timer = {
    views: [],
    tickHandle: null,
    st: null,

    load: function () {
      var s = State.get('timer', null);
      if (!s || (s.preset !== 'custom' && !PRESETS[s.preset])) {
        s = { preset: '25/5', mode: 'focus', running: false, endAt: 0, remaining: PRESETS['25/5'].focus, cycles: 0 };
      }
      // Reconcile a running session against wall clock (persistence across reloads / pages)
      if (s.running && s.endAt) {
        var left = Math.round((s.endAt - Date.now()) / 1000);
        if (left <= 0) { s.running = false; s.remaining = 0; }
        else { s.remaining = left; }
      }
      this.st = s;
      return s;
    },
    save: function () { State.set('timer', this.st); },
    dur: function (mode) {
      mode = mode || this.st.mode;
      if (this.st.preset === 'custom') {
        var cs = Settings.load().custom;
        return Math.max(1, (cs[mode] || 25)) * 60;
      }
      return PRESETS[this.st.preset][mode];
    },

    init: function () {
      if (this._init) return;
      this._init = true;
      this.load();
      var self = this;
      // resume ticking if a session was running when we left the page
      if (this.st.running && this.st.remaining > 0) { this._startTick(); }
      else if (this.st.running && this.st.remaining <= 0) { this._complete(true); }
      // keep tabs in sync
      window.addEventListener('storage', function (e) {
        if (e.key === '25mint.timer') { self.load(); self.render(); if (self.st.running) self._startTick(); }
      });
    },

    registerView: function (v) { this.views.push(v); v.render(this.st); },
    render: function () {
      var s = this.st;
      this.views.forEach(function (v) { v.render(s); });
      if (this._baseTitle === undefined) this._baseTitle = document.title;
      document.title = s.running
        ? fmt(s.remaining) + (s.mode === 'focus' ? ' · Focus' : ' · Break') + ' — 25Mint'
        : this._baseTitle;
    },

    setPreset: function (p) {
      if (p !== 'custom' && !PRESETS[p]) return;
      this.st.preset = p;
      this.st.running = false; this.st.endAt = 0;
      this.st.remaining = this.dur();
      this._stopTick(); this.save(); this.render();
    },
    setMode: function (mode) {
      this.st.mode = mode; this.st.running = false; this.st.endAt = 0;
      this.st.remaining = this.dur(mode);
      this._stopTick(); this.save(); this.render();
    },
    toggle: function () { this.st.running ? this.pause() : this.start(); },
    start: function () {
      ctx(); // unlock audio on user gesture
      Notify.request(); // ask once, on a genuine user gesture
      if (this.st.remaining <= 0) this.st.remaining = this.dur();
      this.st.running = true;
      this.st.endAt = Date.now() + this.st.remaining * 1000;
      this.save(); this._startTick(); this.render();
    },
    pause: function () {
      if (this.st.running && this.st.endAt) {
        this.st.remaining = Math.max(0, Math.round((this.st.endAt - Date.now()) / 1000));
      }
      this.st.running = false; this.st.endAt = 0;
      this._stopTick(); this.save(); this.render();
    },
    reset: function () {
      this.st.running = false; this.st.endAt = 0;
      this.st.remaining = this.dur();
      this._stopTick(); this.save(); this.render();
    },
    skip: function () { this._complete(false); },

    _startTick: function () {
      var self = this; this._stopTick();
      this.tickHandle = setInterval(function () { self._tick(); }, 250);
    },
    _stopTick: function () { if (this.tickHandle) { clearInterval(this.tickHandle); this.tickHandle = null; } },
    _tick: function () {
      if (!this.st.running) { this._stopTick(); return; }
      var left = Math.round((this.st.endAt - Date.now()) / 1000);
      this.st.remaining = Math.max(0, left);
      if (left <= 0) { this._complete(false); return; }
      this.render();
    },
    _complete: function (silent) {
      var wasFocus = this.st.mode === 'focus';
      var cfg = Settings.load();
      this._stopTick();
      this.st.running = false; this.st.endAt = 0; this.st.remaining = 0;
      if (wasFocus) {
        this.st.cycles = (this.st.cycles || 0) + 1;
        Stats.recordFocus(this.dur('focus') / 60);
        Tasks.creditActive();
        if (!silent) {
          if (cfg.sound) chime();
          Celebrate.show();
          if (cfg.notify) Notify.fire('Focus session complete 🎉', 'Nice work. Time for a break.');
        }
        // auto-advance to a break
        var nextMode = (this.st.cycles % 4 === 0) ? 'long' : 'short';
        this.st.mode = nextMode; this.st.remaining = this.dur(nextMode);
      } else {
        if (!silent) {
          if (cfg.sound) chime();
          if (cfg.notify) Notify.fire('Break over ☕', 'Ready for your next focus session?');
        }
        this.st.mode = 'focus'; this.st.remaining = this.dur('focus');
      }
      this.save(); this.render();
      Stats.renderAll(); Tasks.renderAll();
      // auto-start the next session if enabled (skip=silent still auto-starts, matches user intent)
      if (cfg.autostart) { var self = this; setTimeout(function () { self.start(); }, 400); }
    }
  };

  /* ============================ Session-complete celebration ============================ */
  var Celebrate = {
    show: function () {
      // one card per completion, attached to the first visible timer root
      var root = $all('[data-focus-timer]').filter(function (r) { return r.offsetParent !== null; })[0]
              || $('[data-focus-timer]');
      if (!root || $('.fs-celebrate', root)) return;
      var stats = Stats.load();
      var tk = todayKey();
      var todaySessions = (stats.days[tk] && stats.days[tk].sessions) || 1;
      var shopBase = window.FS_SHOP_BASE || '';
      var card = document.createElement('div');
      card.className = 'fs-celebrate';
      card.innerHTML =
        '<button class="fs-celebrate-close" aria-label="Dismiss">×</button>' +
        '<div class="fs-celebrate-title">🎉 Session complete!</div>' +
        '<p class="fs-celebrate-text">That’s ' + todaySessions + ' focus session' + (todaySessions === 1 ? '' : 's') + ' today. Take your break — you’ve earned it.</p>' +
        '<p class="fs-celebrate-text fs-celebrate-cta">Love the rhythm? A <a href="' + shopBase + '/collections/study-timers">physical Pomodoro timer</a> on your desk makes it a daily habit — no screens needed.</p>';
      card.querySelector('.fs-celebrate-close').addEventListener('click', function () { card.remove(); });
      root.appendChild(card);
      setTimeout(function () { if (card.parentNode) card.classList.add('fs-celebrate-fade'); }, 30000);
      setTimeout(function () { if (card.parentNode) card.remove(); }, 31000);
    }
  };

  /* Timer UI view — binds a DOM root to the Timer singleton (compact or full) */
  function TimerView(root) {
    var compact = root.getAttribute('data-focus-timer') === 'compact';
    var ring = $('.fs-ring-fg', root);
    var clock = $('.fs-clock', root);
    var stateLbl = $('.fs-state', root);
    var startBtn = $('[data-act="toggle"]', root);
    var R = ring ? ring.r.baseVal.value : 0;
    var CIRC = 2 * Math.PI * R;
    if (ring) { ring.style.strokeDasharray = CIRC; }

    // wire controls
    $all('[data-preset]', root).forEach(function (b) {
      b.addEventListener('click', function () { Timer.setPreset(b.getAttribute('data-preset')); });
    });
    $all('[data-mode]', root).forEach(function (b) {
      b.addEventListener('click', function () { Timer.setMode(b.getAttribute('data-mode')); });
    });
    if (startBtn) startBtn.addEventListener('click', function () { Timer.toggle(); });
    var resetBtn = $('[data-act="reset"]', root);
    if (resetBtn) resetBtn.addEventListener('click', function () { Timer.reset(); });
    var skipBtn = $('[data-act="skip"]', root);
    if (skipBtn) skipBtn.addEventListener('click', function () { Timer.skip(); });

    var view = {
      render: function (s) {
        var total = Timer.dur(s.mode);
        if (clock) clock.textContent = fmt(s.remaining);
        if (stateLbl) stateLbl.textContent = s.running
          ? (s.mode === 'focus' ? 'Focusing' : 'Break')
          : (s.mode === 'focus' ? 'Ready to focus' : 'Break — ready');
        if (ring) {
          var frac = total ? (s.remaining / total) : 0;
          ring.style.strokeDashoffset = CIRC * (1 - frac);
        }
        if (startBtn) startBtn.textContent = s.running ? 'Pause' : (s.remaining < total ? 'Resume' : 'Start');
        root.setAttribute('data-fs-mode', s.mode);
        root.setAttribute('data-fs-running', s.running ? '1' : '0');
        $all('[data-mode]', root).forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-mode') === s.mode);
        });
        $all('[data-preset]', root).forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-preset') === s.preset);
        });
        var cyc = $('.fs-cycles', root);
        if (cyc) cyc.textContent = (s.cycles || 0);
      }
    };
    Timer.registerView(view);
    // Spacebar toggles (full mode only, avoid hijacking home page typing)
    if (!compact) {
      document.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && !/INPUT|TEXTAREA|BUTTON/.test((e.target.tagName || ''))) {
          e.preventDefault(); Timer.toggle();
        }
      });
    }
  }

  /* ============================ Sounds (procedural, zero-file) ============================ */
  function makeNoiseBuffer(c, type) {
    var len = c.sampleRate * 4; // 4s loop
    var buf = c.createBuffer(1, len, c.sampleRate);
    var d = buf.getChannelData(0);
    var b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0, last=0;
    for (var i = 0; i < len; i++) {
      var wn = Math.random() * 2 - 1;
      if (type === 'white') { d[i] = wn * 0.6; }
      else if (type === 'pink') {
        b0 = 0.99886*b0 + wn*0.0555179; b1 = 0.99332*b1 + wn*0.0750759;
        b2 = 0.96900*b2 + wn*0.1538520; b3 = 0.86650*b3 + wn*0.3104856;
        b4 = 0.55000*b4 + wn*0.5329522; b5 = -0.7616*b5 - wn*0.0168980;
        d[i] = (b0+b1+b2+b3+b4+b5+b6+wn*0.5362) * 0.11; b6 = wn*0.115926;
      } else { // brown
        last = (last + 0.02 * wn) / 1.02; d[i] = last * 3.5;
      }
    }
    return buf;
  }

  var SOUNDS = [
    { id: 'brown', name: 'Brown Noise', icon: '🟤' },
    { id: 'pink',  name: 'Pink Noise',  icon: '🌸' },
    { id: 'white', name: 'White Noise', icon: '⚪' },
    { id: 'rain',  name: 'Rain',        icon: '🌧️' },
    { id: 'ocean', name: 'Ocean Waves', icon: '🌊' },
    { id: 'cafe',  name: 'Café',        icon: '☕' },
    { id: 'forest', name: 'Forest',     icon: '🌲' }
  ];

  var Sounds = {
    nodes: {}, master: null, schedTimer: null,
    // short filtered-noise burst → rain droplet
    droplet: function (c, dest, when) {
      var b = c.createBuffer(1, c.sampleRate * 0.05, c.sampleRate), d = b.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
      var s = c.createBufferSource(); s.buffer = b;
      var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400 + Math.random() * 2600; bp.Q.value = 1.2;
      var g = c.createGain(); g.gain.value = 0.10 + Math.random() * 0.16;
      s.connect(bp); bp.connect(g); g.connect(dest); s.start(when);
    },
    // two quick FM sine blips → bird chirp
    chirp: function (c, dest, when) {
      var base = 1800 + Math.random() * 1400;
      for (var k = 0; k < 2; k++) {
        var t = when + k * 0.11, o = c.createOscillator(), g = c.createGain();
        o.type = 'sine'; o.frequency.setValueAtTime(base, t); o.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.06);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
        o.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.1);
      }
    },
    // short high ping → cup/cutlery clink
    clink: function (c, dest, when) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = 2400 + Math.random() * 1800;
      g.gain.setValueAtTime(0.0001, when); g.gain.exponentialRampToValueAtTime(0.05, when + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18);
      o.connect(g); g.connect(dest); o.start(when); o.stop(when + 0.2);
    },
    build: function (id) {
      var c = ctx(); if (!c) return null;
      if (!this.master) { this.master = c.createGain(); this.master.gain.value = 1; this.master.connect(c.destination); }
      // optional licensed loop override
      if (window.FS_SOUND_LOOPS && window.FS_SOUND_LOOPS[id]) {
        var lg = c.createGain(); lg.gain.value = 0; lg.connect(this.master);
        var a = new Audio(window.FS_SOUND_LOOPS[id]); a.loop = true; a.crossOrigin = 'anonymous';
        try { var mediaSrc = c.createMediaElementSource(a); mediaSrc.connect(lg); a.play().catch(function(){}); } catch (e) {}
        return { gain: lg, audio: a };
      }
      var g = c.createGain(); g.gain.value = 0; g.connect(this.master);
      var baseType = (id === 'rain' || id === 'forest') ? 'white' : (id === 'ocean' || id === 'cafe') ? 'brown' : id;
      var src = c.createBufferSource(); src.buffer = makeNoiseBuffer(c, baseType); src.loop = true;
      var transient = null;
      if (id === 'rain') {
        var hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 800;
        var bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.5;
        src.connect(hp); hp.connect(bp); bp.connect(g); transient = 'droplet';
      } else if (id === 'ocean') {
        var lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 550;
        src.connect(lp); lp.connect(g);
        var lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.09;
        var lg2 = c.createGain(); lg2.gain.value = 0.5; lfo.connect(lg2); lg2.connect(g.gain); lfo.start();
      } else if (id === 'cafe') {
        var lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 900;
        src.connect(lp2); lp2.connect(g); transient = 'clink';
      } else if (id === 'forest') {
        var lp3 = c.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 700;
        src.connect(lp3); lp3.connect(g);
        var wlfo = c.createOscillator(); wlfo.type = 'sine'; wlfo.frequency.value = 0.13;
        var wg = c.createGain(); wg.gain.value = 0.35; wlfo.connect(wg); wg.connect(g.gain); wlfo.start();
        transient = 'chirp';
      } else {
        src.connect(g);
      }
      src.start();
      return { gain: g, src: src, transient: transient };
    },
    startSched: function () {
      if (this.schedTimer) return;
      var self = this;
      this.schedTimer = setInterval(function () {
        var c = _ctx; if (!c) return;
        var now = c.currentTime;
        Object.keys(self.nodes).forEach(function (id) {
          var n = self.nodes[id]; if (!n || !n.transient) return;
          var vol = n.gain.gain.value; if (vol < 0.03) return;
          // density scales with volume; schedule over next 1s
          var rate = n.transient === 'droplet' ? 14 : n.transient === 'chirp' ? 0.6 : 0.9;
          var count = 0, expected = rate * vol;
          for (var t = 0; t < 1; t += 0.05) { if (Math.random() < expected * 0.05) { self[n.transient](c, n.gain, now + t); count++; } }
        });
      }, 1000);
    },
    setVol: function (id, v) {
      ctx();
      if (!this.nodes[id]) this.nodes[id] = this.build(id);
      var n = this.nodes[id]; if (!n) return;
      var target = (id === 'ocean' || id === 'forest') ? v * 0.7 : v;
      n.gain.gain.setTargetAtTime(target, ctx().currentTime, 0.05);
      if (n.transient) this.startSched();
      var s = State.get('sounds', {}); s[id] = v; State.set('sounds', s);
    },
    stopAll: function () {
      var self = this; var s = State.get('sounds', {});
      Object.keys(this.nodes).forEach(function (id) { if (self.nodes[id]) self.nodes[id].gain.gain.setTargetAtTime(0, ctx().currentTime, 0.05); s[id] = 0; });
      State.set('sounds', s);
      $all('[data-sound-vol]').forEach(function (el) { el.value = 0; });
    }
  };

  function initSounds(root) {
    var saved = State.get('sounds', {});
    $all('[data-sound-vol]', root).forEach(function (sl) {
      var id = sl.getAttribute('data-sound-vol');
      if (saved[id]) sl.value = saved[id];
      sl.addEventListener('input', function () { Sounds.setVol(id, parseFloat(sl.value)); });
    });
    var stop = $('[data-act="sounds-stop"]', root);
    if (stop) stop.addEventListener('click', function () { Sounds.stopAll(); });
  }

  /* ============================ Breathe (box breathing 4-4-4-4) ============================ */
  var Breathe = { raf: null, t0: 0, running: false };
  function initBreathe(root) {
    var circle = $('.fs-breath-circle', root);
    var label = $('.fs-breath-label', root);
    var count = $('.fs-breath-count', root);
    var btn = $('[data-act="breathe-toggle"]', root);
    if (!circle || !btn) return;
    var PHASES = [['Breathe in', 4], ['Hold', 4], ['Breathe out', 4], ['Hold', 4]];
    var CYCLE = 16;
    function frame(now) {
      if (!Breathe.running) return;
      var t = ((now - Breathe.t0) / 1000) % CYCLE;
      var acc = 0, phase = 0, into = 0;
      for (var i = 0; i < PHASES.length; i++) { if (t < acc + PHASES[i][1]) { phase = i; into = t - acc; break; } acc += PHASES[i][1]; }
      var scale;
      if (phase === 0) scale = 0.5 + 0.5 * (into / 4);      // grow
      else if (phase === 1) scale = 1;                       // hold big
      else if (phase === 2) scale = 1 - 0.5 * (into / 4);   // shrink
      else scale = 0.5;                                      // hold small
      circle.style.transform = 'scale(' + scale.toFixed(3) + ')';
      if (label) label.textContent = PHASES[phase][0];
      if (count) count.textContent = Math.ceil(PHASES[phase][1] - into);
      Breathe.raf = requestAnimationFrame(frame);
    }
    btn.addEventListener('click', function () {
      Breathe.running = !Breathe.running;
      root.setAttribute('data-breathing', Breathe.running ? '1' : '0');
      btn.textContent = Breathe.running ? 'Stop' : 'Start breathing';
      if (Breathe.running) { Breathe.t0 = performance.now(); Breathe.raf = requestAnimationFrame(frame); }
      else { cancelAnimationFrame(Breathe.raf); circle.style.transform = 'scale(0.5)'; if (label) label.textContent = 'Ready'; if (count) count.textContent = ''; }
    });
  }

  /* ============================ Stats / Streak ============================ */
  var Stats = {
    load: function () { return State.get('stats', { totalMin: 0, sessions: 0, days: {}, lastDay: null, streak: 0 }); },
    recordFocus: function (minutes) {
      var s = this.load(); var tk = todayKey();
      s.totalMin = Math.round((s.totalMin + minutes) * 10) / 10;
      s.sessions = (s.sessions || 0) + 1;
      s.days[tk] = s.days[tk] || { sessions: 0, minutes: 0 };
      s.days[tk].sessions++; s.days[tk].minutes += minutes;
      // streak
      if (s.lastDay !== tk) {
        var y = new Date(); y.setDate(y.getDate() - 1);
        var yk = y.getFullYear() + '-' + pad(y.getMonth() + 1) + '-' + pad(y.getDate());
        s.streak = (s.lastDay === yk) ? (s.streak || 0) + 1 : 1;
        s.lastDay = tk;
      }
      State.set('stats', s); this.renderAll();
    },
    renderAll: function () {
      var s = this.load(); var tk = todayKey();
      var today = s.days[tk] || { sessions: 0, minutes: 0 };
      $all('[data-stat="today-sessions"]').forEach(function (e) { e.textContent = today.sessions; });
      $all('[data-stat="today-min"]').forEach(function (e) { e.textContent = Math.round(today.minutes); });
      $all('[data-stat="total-min"]').forEach(function (e) { e.textContent = Math.round(s.totalMin); });
      $all('[data-stat="total-sessions"]').forEach(function (e) { e.textContent = s.sessions || 0; });
      $all('[data-stat="streak"]').forEach(function (e) { e.textContent = s.streak || 0; });
      this.renderChart(s, tk);
      this.renderGoal(s, tk);
      this.renderHeatmap(s, tk);
    },
    renderGoal: function (s, tk) {
      var hosts = $all('[data-goal]');
      if (!hosts.length) return;
      var goal = (Settings.load().dailyGoal) || 4;
      var done = (s.days[tk] && s.days[tk].sessions) || 0;
      var pct = Math.min(100, Math.round((done / goal) * 100));
      var met = done >= goal;
      hosts.forEach(function (h) {
        h.innerHTML = '<div class="fs-goal-bar"><div class="fs-goal-fill' + (met ? ' met' : '') + '" style="width:' + pct + '%"></div></div>' +
          '<div class="fs-goal-label">' + (met ? '🎯 Daily goal reached!' : done + ' / ' + goal + ' sessions today') + '</div>';
      });
    },
    renderHeatmap: function (s, tk) {
      var hosts = $all('[data-heatmap]');
      if (!hosts.length) return;
      var WEEKS = 18; // ~4 months
      var cells = [];
      var maxm = 0;
      var start = new Date(); start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (WEEKS * 7 - 1));
      // align start to Sunday
      start.setDate(start.getDate() - start.getDay());
      for (var i = 0; i < WEEKS * 7; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i);
        var key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        var mins = (s.days[key] && s.days[key].minutes) || 0;
        if (mins > maxm) maxm = mins;
        cells.push({ key: key, mins: mins, future: d > new Date() });
      }
      var html = cells.map(function (c) {
        var lvl = 0;
        if (c.mins > 0 && maxm > 0) lvl = Math.min(4, Math.ceil((c.mins / maxm) * 4));
        return '<div class="fs-hm-cell lvl' + lvl + (c.key === tk ? ' today' : '') + (c.future ? ' future' : '') + '" title="' + Math.round(c.mins) + ' min"></div>';
      }).join('');
      hosts.forEach(function (h) { h.innerHTML = html; });
    },
    renderChart: function (s, tk) {
      var hosts = $all('[data-stat-chart]');
      if (!hosts.length) return;
      var days = [];
      var max = 0;
      var wk = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      for (var i = 6; i >= 0; i--) {
        var d = new Date(); d.setDate(d.getDate() - i);
        var key = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        var mins = (s.days[key] && s.days[key].minutes) || 0;
        if (mins > max) max = mins;
        days.push({ key: key, label: wk[d.getDay()], mins: mins, today: key === tk });
      }
      var TRACK = 100; // px, matches .fs-bar-track height headroom
      var html = days.map(function (d) {
        var h = (d.mins > 0 && max > 0) ? Math.max(4, Math.round((d.mins / max) * TRACK)) : 0;
        var title = Math.round(d.mins) + ' focus min';
        return '<div class="fs-bar-col"><div class="fs-bar-track">' +
          '<div class="fs-bar-fill' + (d.today ? ' today' : '') + (d.mins > 0 ? '' : ' empty') + '" style="height:' + h + 'px" title="' + title + '"></div>' +
          '</div><div class="fs-bar-label' + (d.today ? ' today' : '') + '">' + d.label + '</div></div>';
      }).join('');
      hosts.forEach(function (host) { host.innerHTML = html; });
    }
  };

  /* ============================ Tasks ============================ */
  var Tasks = {
    load: function () { return State.get('tasks', { items: [], active: null }); },
    save: function (t) { State.set('tasks', t); },
    add: function (text) {
      text = (text || '').trim(); if (!text) return;
      var t = this.load();
      var id = Date.now() + '' + Math.floor(Math.random() * 999);
      t.items.push({ id: id, text: text, done: false, pomos: 0 });
      if (!t.active) t.active = id;
      this.save(t); this.renderAll();
    },
    toggle: function (id) { var t = this.load(); t.items.forEach(function (i) { if (i.id === id) i.done = !i.done; }); this.save(t); this.renderAll(); },
    remove: function (id) { var t = this.load(); t.items = t.items.filter(function (i) { return i.id !== id; }); if (t.active === id) t.active = (t.items[0] && t.items[0].id) || null; this.save(t); this.renderAll(); },
    setActive: function (id) { var t = this.load(); t.active = id; this.save(t); this.renderAll(); },
    creditActive: function () {
      var t = this.load(); if (!t.active) return;
      t.items.forEach(function (i) { if (i.id === t.active) i.pomos = (i.pomos || 0) + 1; });
      this.save(t); this.renderAll();
    },
    renderAll: function () {
      var t = this.load();
      $all('[data-tasks-list]').forEach(function (list) {
        list.innerHTML = '';
        if (!t.items.length) { list.innerHTML = '<li class="fs-task-empty">No tasks yet — add one to track your pomodoros.</li>'; return; }
        t.items.forEach(function (i) {
          var li = document.createElement('li');
          li.className = 'fs-task' + (i.done ? ' done' : '') + (i.id === t.active ? ' active' : '');
          li.innerHTML =
            '<button class="fs-task-check" data-task-toggle="' + i.id + '" aria-label="Toggle done">' + (i.done ? '✓' : '') + '</button>' +
            '<span class="fs-task-text" data-task-active="' + i.id + '">' + escapeHtml(i.text) + '</span>' +
            '<span class="fs-task-pomos" title="Completed pomodoros">🍅 ' + (i.pomos || 0) + '</span>' +
            '<button class="fs-task-del" data-task-del="' + i.id + '" aria-label="Delete">×</button>';
          list.appendChild(li);
        });
      });
    }
  };
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }

  function initTasks(root) {
    var form = $('[data-tasks-form]', root);
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('[data-tasks-input]', form);
        Tasks.add(input.value); input.value = '';
      });
    }
    // event delegation for list actions
    $all('[data-tasks-list]', root).forEach(function (list) {
      list.addEventListener('click', function (e) {
        var el = e.target.closest('[data-task-toggle],[data-task-del],[data-task-active]');
        if (!el) return;
        if (el.hasAttribute('data-task-toggle')) Tasks.toggle(el.getAttribute('data-task-toggle'));
        else if (el.hasAttribute('data-task-del')) Tasks.remove(el.getAttribute('data-task-del'));
        else if (el.hasAttribute('data-task-active')) Tasks.setActive(el.getAttribute('data-task-active'));
      });
    });
  }

  /* ============================ Settings UI ============================ */
  function initSettings(root) {
    var panel = $('[data-settings]', root);
    if (!panel) return;
    var cfg = Settings.load();

    function sync() {
      $all('[data-set-toggle]', panel).forEach(function (el) {
        var on = !!cfg[el.getAttribute('data-set-toggle')];
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
        el.classList.toggle('on', on);
      });
      ['focus', 'short', 'long'].forEach(function (m) {
        var inp = $('[data-set-dur="' + m + '"]', panel);
        if (inp) inp.value = cfg.custom[m];
      });
    }

    $all('[data-set-toggle]', panel).forEach(function (el) {
      el.addEventListener('click', function () {
        var key = el.getAttribute('data-set-toggle');
        cfg[key] = !cfg[key];
        Settings.save(cfg);
        if (key === 'notify' && cfg.notify) Notify.request();
        sync();
      });
    });
    $all('[data-set-dur]', panel).forEach(function (inp) {
      inp.addEventListener('change', function () {
        var m = inp.getAttribute('data-set-dur');
        var v = Math.max(1, Math.min(180, parseInt(inp.value, 10) || Settings.defaults.custom[m]));
        inp.value = v; cfg.custom[m] = v; Settings.save(cfg);
        // if currently on custom preset and idle, reflect immediately
        if (Timer.st.preset === 'custom' && !Timer.st.running) {
          Timer.st.remaining = Timer.dur(); Timer.save(); Timer.render();
        }
      });
    });

    // theme segmented control
    $all('[data-set-theme]', panel).forEach(function (b) {
      b.addEventListener('click', function () {
        cfg.theme = b.getAttribute('data-set-theme'); Settings.save(cfg);
        Theme.apply(); syncTheme();
      });
    });
    function syncTheme() {
      $all('[data-set-theme]', panel).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-set-theme') === (cfg.theme || 'auto')); });
    }
    // daily goal
    var goalInp = $('[data-set-goal]', panel);
    if (goalInp) {
      goalInp.value = cfg.dailyGoal;
      goalInp.addEventListener('change', function () {
        cfg.dailyGoal = Math.max(1, Math.min(20, parseInt(goalInp.value, 10) || 4));
        goalInp.value = cfg.dailyGoal; Settings.save(cfg); Stats.renderAll();
      });
    }

    var gear = $('[data-settings-toggle]', root);
    if (gear) gear.addEventListener('click', function () {
      var open = panel.classList.toggle('open');
      gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    sync(); syncTheme();
  }

  /* ============================ Theme (light/dark/auto) ============================ */
  var Theme = {
    load: function () { return Settings.load().theme || 'auto'; },
    isDark: function () {
      var t = this.load();
      return t === 'dark' || (t === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    },
    apply: function () {
      var mode = this.isDark() ? 'dark' : 'light';
      $all('[data-focus-app]').forEach(function (el) { el.setAttribute('data-theme', mode); });
      $all('[data-focus-timer]').forEach(function (el) { el.setAttribute('data-theme', mode); });
      if (window.FS_STANDALONE) document.documentElement.setAttribute('data-theme', mode);
    },
    set: function (t) { var s = Settings.load(); s.theme = t; Settings.save(s); this.apply(); }
  };

  /* ============================ Shop (Storefront API) ============================ */
  var Shop = {
    TTL: 2 * 3600 * 1000,
    gid2id: function (gid) { return String(gid).split('/').pop(); },
    cache: function () { return State.get('shop', null); },
    money: function (amt) { return '$' + parseFloat(amt || 0).toFixed(2); },
    fetch: function (cb) {
      var cached = this.cache();
      if (cached && cached.at && (Date.now() - cached.at) < this.TTL && cached.products && cached.products.length) { cb(cached, true); return; }
      var token = window.FS_STOREFRONT_TOKEN, dom = window.FS_SHOP_DOMAIN;
      if (!token || !dom || !window.fetch) { cb(cached || { products: [], collections: [] }, false); return; }
      var q = '{ products(first:60){edges{node{ handle title featuredImage{url(transform:{maxWidth:420})} priceRange{minVariantPrice{amount currencyCode}} variants(first:1){edges{node{id availableForSale}}} collections(first:8){edges{node{handle title}}} }}} }';
      var self = this;
      fetch('https://' + dom + '/api/2024-10/graphql.json', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Storefront-Access-Token': token },
        body: JSON.stringify({ query: q })
      }).then(function (r) { return r.json(); }).then(function (j) {
        var prods = ((j.data && j.data.products.edges) || []).map(function (e) {
          var n = e.node, v = (n.variants.edges[0] || {}).node || {};
          return {
            handle: n.handle, title: n.title, img: (n.featuredImage || {}).url || '',
            price: n.priceRange.minVariantPrice.amount, cur: n.priceRange.minVariantPrice.currencyCode,
            vid: v.id ? self.gid2id(v.id) : null, avail: v.availableForSale !== false,
            cols: ((n.collections.edges) || []).map(function (c) { return { h: c.node.handle, t: c.node.title }; })
          };
        });
        var colMap = {};
        prods.forEach(function (p) { p.cols.forEach(function (c) { colMap[c.h] = c.t; }); });
        var out = { at: Date.now(), products: prods, collections: Object.keys(colMap).map(function (h) { return { h: h, t: colMap[h] }; }) };
        State.set('shop', out); cb(out, false);
      }).catch(function () { cb(cached || { products: [], collections: [] }, false); });
    },
    buyUrl: function (p) { return (window.FS_SHOP_BASE || '') + (p.vid ? '/cart/' + p.vid + ':1' : '/products/' + p.handle); },
    viewUrl: function (p) { return (window.FS_SHOP_BASE || '') + '/products/' + p.handle; }
  };

  function initShop(root) {
    var panel = $('[data-shop]', root);
    if (!panel) return;
    var chipsHost = $('[data-shop-chips]', panel);
    var grid = $('[data-shop-grid]', panel);
    var filter = 'all';
    var data = null;

    function renderChips() {
      if (!chipsHost || !data) return;
      var chips = '<button class="fs-chip' + (filter === 'all' ? ' active' : '') + '" data-chip="all">All</button>';
      chips += data.collections.map(function (c) {
        return '<button class="fs-chip' + (filter === c.h ? ' active' : '') + '" data-chip="' + c.h + '">' + escapeHtml(c.t) + '</button>';
      }).join('');
      chipsHost.innerHTML = chips;
    }
    function renderGrid() {
      if (!grid) return;
      if (!data || !data.products.length) { grid.innerHTML = '<p class="fs-shop-empty">Couldn’t load products right now. <a href="' + (window.FS_SHOP_BASE || '') + '/collections/all" target="_blank" rel="noopener">Browse the full store →</a></p>'; return; }
      var items = data.products.filter(function (p) { return filter === 'all' || p.cols.some(function (c) { return c.h === filter; }); });
      grid.innerHTML = items.map(function (p) {
        return '<div class="fs-prod">' +
          '<a class="fs-prod-img" href="' + Shop.viewUrl(p) + '" target="_blank" rel="noopener"' + (p.img ? ' style="background-image:url(\'' + p.img + '\')"' : '') + ' aria-label="' + escapeHtml(p.title) + '"></a>' +
          '<div class="fs-prod-body">' +
          '<a class="fs-prod-title" href="' + Shop.viewUrl(p) + '" target="_blank" rel="noopener">' + escapeHtml(p.title) + '</a>' +
          '<div class="fs-prod-foot"><span class="fs-prod-price">' + Shop.money(p.price) + '</span>' +
          (p.avail ? '<a class="fs-btn sm" href="' + Shop.buyUrl(p) + '" target="_blank" rel="noopener">Buy</a>' : '<span class="fs-prod-sold">Sold out</span>') +
          '</div></div></div>';
      }).join('');
    }
    function render() { renderChips(); renderGrid(); }

    if (chipsHost) chipsHost.addEventListener('click', function (e) {
      var b = e.target.closest('[data-chip]'); if (!b) return;
      filter = b.getAttribute('data-chip'); render();
    });

    var loaded = false;
    function load() {
      if (loaded) return; loaded = true;
      if (grid) grid.innerHTML = '<div class="fs-shop-loading">Loading products…</div>';
      Shop.fetch(function (d) { data = d; render(); });
    }
    // lazy: load when Shop tab first activated
    var tabBtn = $('[data-tab="shop"]', root);
    if (tabBtn) tabBtn.addEventListener('click', load);
    // if deep-linked to #shop
    if ((location.hash || '').replace('#', '') === 'shop') load();
  }

  /* ============================ Fullscreen focus mode ============================ */
  var Fullscreen = {
    enter: function () {
      var app = $('[data-focus-app]'); if (!app) return;
      app.classList.add('fs-fs-on');
      if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
    },
    exit: function () {
      var app = $('[data-focus-app]'); if (app) app.classList.remove('fs-fs-on');
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    }
  };

  /* ============================ Tabs ============================ */
  function initTabs(root) {
    var tabs = $all('[data-tab]', root);
    var panels = $all('[data-panel]', root);
    if (!tabs.length) return;
    function activate(name) {
      tabs.forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-tab') === name); });
      panels.forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-panel') === name); });
    }
    tabs.forEach(function (t) { t.addEventListener('click', function () { activate(t.getAttribute('data-tab')); location.hash = t.getAttribute('data-tab'); }); });
    var hash = (location.hash || '').replace('#', '');
    if (hash && tabs.some(function (t) { return t.getAttribute('data-tab') === hash; })) activate(hash);
    else activate(tabs[0].getAttribute('data-tab'));
  }

  /* ============================ Boot ============================ */
  function boot() {
    Timer.init();
    Theme.apply();
    $all('[data-focus-timer]').forEach(function (r) { TimerView(r); });
    $all('[data-focus-app]').forEach(function (r) { initTabs(r); initSounds(r); initBreathe(r); initTasks(r); initSettings(r); initShop(r); });
    // Fullscreen enter/exit buttons
    $all('[data-act="fullscreen"]').forEach(function (b) { b.addEventListener('click', function () { Fullscreen.enter(); }); });
    $all('[data-act="fullscreen-exit"]').forEach(function (b) { b.addEventListener('click', function () { Fullscreen.exit(); }); });
    document.addEventListener('fullscreenchange', function () { if (!document.fullscreenElement) Fullscreen.exit(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') Fullscreen.exit(); });
    if (window.matchMedia) { try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { if (Theme.load() === 'auto') Theme.apply(); }); } catch (e) {} }
    Stats.renderAll();
    Tasks.renderAll();
    Timer.render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.FocusSuite = { Timer: Timer, Sounds: Sounds, Stats: Stats, Tasks: Tasks, State: State, Notify: Notify, Settings: Settings, Theme: Theme, Shop: Shop, Fullscreen: Fullscreen, version: '2.0.0' };
})(window, document);
