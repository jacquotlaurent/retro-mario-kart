/* ═══════════════════════════════════════════════════════════════════════════
   Couche d'accès aux données.

   Deux implémentations interchangeables :
     • SupabaseBackend — appelle les 6 fonctions RPC de setup.sql en HTTP.
     • DemoBackend     — rejoue la même logique en local, sans réseau (?demo=1).
                         C'est le filet de sécurité : si le wifi ou Supabase
                         lâche pendant la rétro, l'animation continue.

   Pas de WebSocket, pas de librairie : un simple sondage toutes les 800 ms.
   Pour 8 personnes pendant 45 minutes ça fait ~20 000 requêtes, très loin des
   quotas gratuits, et l'œil ne voit pas la différence avec du temps réel.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.RETRO_CONFIG || {};

  function env() {
    var injected = window.RETRO_ENV || {};
    return {
      url: (injected.url || CFG.SUPABASE_URL || '').replace(/\/+$/, ''),
      key: injected.key || CFG.SUPABASE_ANON_KEY || '',
    };
  }

  // ─── Supabase ────────────────────────────────────────────────────────────

  function SupabaseBackend() {
    var e = env();
    this.url = e.url;
    this.key = e.key;
  }

  SupabaseBackend.prototype.rpc = function (fn, body) {
    var self = this;
    var headers = { 'Content-Type': 'application/json', apikey: self.key };
    // Les projets récents fournissent une clé « publishable » (sb_publishable_…)
    // au lieu de l'ancienne clé anon au format JWT. L'en-tête apikey suffit dans
    // les deux cas ; on ne rajoute Authorization que pour les clés JWT, qu'une
    // gateway pourrait exiger, pour ne rien envoyer qui puisse être rejeté.
    if (/^ey/.test(self.key)) headers.Authorization = 'Bearer ' + self.key;

    return fetch(this.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) {
          var detail = text;
          try { detail = (JSON.parse(text).message) || text; } catch (_) {}
          throw new Error(detail || ('HTTP ' + res.status));
        }
        return text ? JSON.parse(text) : null;
      });
    });
  };

  // ─── Démo hors-ligne ─────────────────────────────────────────────────────

  function DemoBackend(code) {
    this.storageKey = 'retro-demo-' + code;
    this.state = this.load(code);
  }

  DemoBackend.prototype.load = function (code) {
    try {
      var raw = localStorage.getItem(this.storageKey);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return {
      exists: true, code: code, position: 0, lap: 0, casesPerLap: 20,
      speaker: null, players: [], spoken: [], events: [], nextId: 1,
      deck: (window.RETRO_DEMO_DECK || []).slice(),
    };
  };

  DemoBackend.prototype.save = function (limite) {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.state)); } catch (_) {}
    var copie = JSON.parse(JSON.stringify(this.state));
    copie.eventsTotal = copie.events.length;
    if (limite) copie.events = copie.events.slice(0, limite);
    return copie;
  };

  DemoBackend.prototype.aParle = function (name) {
    if (name && this.state.spoken.indexOf(name) === -1) this.state.spoken.push(name);
  };

  DemoBackend.prototype.card = function (id) {
    for (var i = 0; i < this.state.deck.length; i++) {
      if (this.state.deck[i].id === id) return this.state.deck[i];
    }
    return null;
  };

  DemoBackend.prototype.seePlayer = function (name) {
    if (name && this.state.players.indexOf(name) === -1) this.state.players.push(name);
  };

  DemoBackend.prototype.rpc = function (fn, body) {
    var s = this.state, self = this;
    if (!s.spoken) s.spoken = [];
    var total = s.lap * s.casesPerLap + s.position;

    if (fn === 'retro_join') {
      self.seePlayer(body.p_name);
    } else if (fn === 'retro_play') {
      var card = self.card(body.p_card);
      if (!card) return Promise.reject(new Error('carte inconnue : ' + body.p_card));
      self.seePlayer(body.p_name);
      total = Math.max(0, total + card.delta);
      s.events.unshift({
        id: s.nextId++, player: body.p_name, card_id: card.id, delta: card.delta,
        note: (body.p_note || '').slice(0, 200) || null, undone: false,
        created_at: new Date().toISOString(),
      });
      s.events = s.events.slice(0, 200);
      s.speaker = body.p_name;
      self.aParle(body.p_name);
    } else if (fn === 'retro_pass') {
      s.speaker = body.p_name;
      self.aParle(body.p_name);
    } else if (fn === 'retro_leave') {
      s.players = s.players.filter(function (n) { return n !== body.p_name; });
      if (s.speaker === body.p_name) s.speaker = null;
    } else if (fn === 'retro_undo') {
      for (var i = 0; i < s.events.length; i++) {
        if (!s.events[i].undone) { s.events[i].undone = true; total = Math.max(0, total - s.events[i].delta); break; }
      }
    } else if (fn === 'retro_reset') {
      s.events = []; total = 0; s.speaker = null; s.spoken = [];
    }

    s.position = total % s.casesPerLap;
    s.lap = Math.floor(total / s.casesPerLap);
    return Promise.resolve(self.save(body.p_limit));
  };

  // ─── Client : sondage + notification des écrans ──────────────────────────

  function RetroClient(opts) {
    this.code = opts.code;
    this.demo = !!opts.demo;
    // L'écran de course en demande beaucoup pour ses colonnes défilantes, les
    // téléphones très peu : c'est ce qui garde le sondage léger à huit.
    this.eventsLimit = opts.eventsLimit || 40;
    this.backend = this.demo ? new DemoBackend(this.code) : new SupabaseBackend();
    this.listeners = [];
    this.errorListeners = [];
    this.state = null;
    this.inFlight = false;
    this.timer = null;
    this.failures = 0;
  }

  RetroClient.prototype.on = function (cb) { this.listeners.push(cb); return this; };
  RetroClient.prototype.onError = function (cb) { this.errorListeners.push(cb); return this; };

  RetroClient.prototype.emit = function (state) {
    this.state = state;
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](state);
  };

  RetroClient.prototype.emitError = function (err) {
    for (var i = 0; i < this.errorListeners.length; i++) this.errorListeners[i](err, this.failures);
  };

  RetroClient.prototype.call = function (fn, body) {
    var self = this;
    body = body || {};
    body.p_code = this.code;
    return this.backend.rpc(fn, body).then(function (state) {
      self.failures = 0;
      self.emitError(null, 0);
      if (state) self.emit(state);
      return state;
    }).catch(function (err) {
      self.failures++;
      self.emitError(err);
      throw err;
    });
  };

  RetroClient.prototype.join   = function (name)       { return this.call('retro_join', { p_name: name || null }); };
  RetroClient.prototype.play   = function (card, name, note) { return this.call('retro_play', { p_name: name, p_card: card, p_note: note || null }); };
  RetroClient.prototype.pass   = function (name)       { return this.call('retro_pass', { p_name: name }); };
  RetroClient.prototype.leave  = function (name)       { return this.call('retro_leave', { p_name: name }); };
  RetroClient.prototype.undo   = function ()           { return this.call('retro_undo'); };
  RetroClient.prototype.reset  = function ()           { return this.call('retro_reset'); };
  RetroClient.prototype.refresh = function ()          { return this.call('retro_state', { p_limit: this.eventsLimit }); };

  /** Récupère l'historique complet sans le diffuser aux écrans : sert à l'export. */
  RetroClient.prototype.fetchAll = function () {
    return this.backend.rpc('retro_state', { p_code: this.code, p_limit: 1000 });
  };

  RetroClient.prototype.startPolling = function () {
    var self = this;
    var period = CFG.POLL_MS || 800;
    if (this.timer) return;
    this.timer = setInterval(function () {
      if (self.inFlight || document.hidden) return;
      self.inFlight = true;
      self.refresh().catch(function () {}).then(function () { self.inFlight = false; });
    }, period);
    return this;
  };

  RetroClient.prototype.stopPolling = function () {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  };

  // ─── Utilitaires de session ──────────────────────────────────────────────

  var ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans I, O, 0, 1 : illisibles à l'oral

  function randomCode() {
    var out = '';
    var buf = new Uint32Array(4);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    for (var i = 0; i < 4; i++) out += ALPHABET[buf[i] % ALPHABET.length];
    return out;
  }

  function codeFromUrl() {
    var hash = (location.hash || '').replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{3,8}$/.test(hash)) return hash;
    var q = new URLSearchParams(location.search).get('code');
    if (q && /^[A-Z0-9]{3,8}$/i.test(q)) return q.toUpperCase();
    return null;
  }

  window.Retro = {
    Client: RetroClient,
    randomCode: randomCode,
    codeFromUrl: codeFromUrl,
    hasBackend: function () { return !!(env().url && env().key); },
    isDemo: function () {
      return new URLSearchParams(location.search).has('demo') || !window.Retro.hasBackend();
    },
  };
})();
