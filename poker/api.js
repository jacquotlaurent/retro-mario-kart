/* ═══════════════════════════════════════════════════════════════════════════
   Couche d'accès aux données du Planning Poker.

   Le navigateur ne connaît QUE les douze fonctions RPC de supabase/setup.sql.
   Il n'a le droit de lire aucune table : ni les votes, ni les participants.
   Un vote caché n'est donc pas « envoyé puis masqué » — il ne quitte jamais la
   base avant la révélation.

   Le temps réel se fait en deux temps :
     1. la base pousse une notification Realtime « maj » (juste un numéro de
        révision, aucun contenu) à chaque changement ;
     2. chaque écran rappelle alors poker_state, qui décide de ce qu'il a le
        droit de voir.

   Un sondage lent tourne derrière, en filet : il rattrape une notification
   perdue et sert de « je suis toujours là » (au-delà de 35 s de silence, on
   n'est plus compté parmi les votants attendus).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.POKER_CONFIG || {};

  function env() {
    return {
      url: (CFG.SUPABASE_URL || '').replace(/\/+$/, ''),
      key: CFG.SUPABASE_ANON_KEY || '',
    };
  }

  // ─── Appels RPC ──────────────────────────────────────────────────────────

  function rpc(fn, body) {
    var e = env();
    var headers = { 'Content-Type': 'application/json', apikey: e.key };
    // Les projets récents fournissent une clé « publishable » (sb_publishable_…)
    // au lieu de l'ancienne clé anon au format JWT. L'en-tête apikey suffit
    // dans les deux cas ; on n'ajoute Authorization que pour les clés JWT,
    // qu'une gateway pourrait exiger.
    if (/^ey/.test(e.key)) headers.Authorization = 'Bearer ' + e.key;

    return fetch(e.url + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body || {}),
    }).then(function (res) {
      return res.text().then(function (text) {
        if (!res.ok) {
          var detail = text;
          try { detail = JSON.parse(text).message || text; } catch (_) {}
          throw new Error(detail || 'HTTP ' + res.status);
        }
        return text ? JSON.parse(text) : null;
      });
    });
  }

  // ─── Mémoire du navigateur ───────────────────────────────────────────────

  /* Le jeton EST l'identité : il est tiré au hasard, gardé par code de session,
     et jamais partagé. Recharger la page ne crée donc pas un doublon dans la
     liste des présents — on reprend sa place, et son vote. */

  function lire(cle) {
    try { return localStorage.getItem(cle); } catch (_) { return null; }
  }
  function ecrire(cle, valeur) {
    try { localStorage.setItem(cle, valeur); } catch (_) {}
  }

  function nouveauJeton() {
    var buf = new Uint8Array(18);
    (window.crypto || window.msCrypto).getRandomValues(buf);
    var out = '';
    for (var i = 0; i < buf.length; i++) out += ('0' + buf[i].toString(16)).slice(-2);
    return out;
  }

  function jetonPour(code) {
    var cle = 'poker-jeton-' + code;
    var jeton = lire(cle);
    if (!jeton || jeton.length < 8) { jeton = nouveauJeton(); ecrire(cle, jeton); }
    return jeton;
  }

  function profil() {
    try { return JSON.parse(lire('poker-profil') || '{}') || {}; } catch (_) { return {}; }
  }
  function retenirProfil(nom, role, code) {
    ecrire('poker-profil', JSON.stringify({ nom: nom, role: role, code: code || null }));
  }

  // ─── Le client ───────────────────────────────────────────────────────────

  function PokerClient(code, jeton) {
    this.code = String(code || '').toUpperCase();
    this.jeton = jeton;
    this.etat = null;
    this.decalage = 0;          // horloge serveur − horloge locale, en ms
    this.echecs = 0;
    this.realtimeOk = false;
    this.ecouteurs = [];
    this.ecouteursReseau = [];
    this.enVol = false;
    this.minuteurSondage = null;
    this.minuteurGroupe = null;
    this.canal = null;
    this.sb = null;
  }

  PokerClient.prototype.sur = function (cb) { this.ecouteurs.push(cb); return this; };
  PokerClient.prototype.surReseau = function (cb) { this.ecouteursReseau.push(cb); return this; };

  PokerClient.prototype.diffuser = function (etat) {
    if (etat && etat.server_now) {
      var serveur = Date.parse(etat.server_now);
      if (!isNaN(serveur)) this.decalage = serveur - Date.now();
    }
    this.etat = etat;
    for (var i = 0; i < this.ecouteurs.length; i++) this.ecouteurs[i](etat);
  };

  PokerClient.prototype.diffuserReseau = function (erreur) {
    for (var i = 0; i < this.ecouteursReseau.length; i++) {
      this.ecouteursReseau[i]({ erreur: erreur, echecs: this.echecs, realtime: this.realtimeOk });
    }
  };

  /** Appelle une fonction RPC en y glissant le code et le jeton. */
  PokerClient.prototype.appeler = function (fn, corps) {
    var self = this;
    corps = corps || {};
    corps.p_code = this.code;
    corps.p_token = this.jeton;
    return rpc(fn, corps).then(function (etat) {
      self.echecs = 0;
      self.diffuserReseau(null);
      // poker_leave ne renvoie qu'un accusé : il n'y a rien à redessiner.
      if (etat && etat.ok && etat.me) self.diffuser(etat);
      return etat;
    }).catch(function (err) {
      self.echecs++;
      self.diffuserReseau(err);
      throw err;
    });
  };

  PokerClient.prototype.rafraichir     = function ()       { return this.appeler('poker_state'); };
  PokerClient.prototype.voter          = function (carte)  { return this.appeler('poker_vote', { p_card: carte }); };
  PokerClient.prototype.reveler        = function ()       { return this.appeler('poker_reveal'); };
  PokerClient.prototype.nouveauTour    = function ()       { return this.appeler('poker_new_round'); };
  PokerClient.prototype.chrono         = function (s)      { return this.appeler('poker_timer', { p_seconds: s === null ? null : (s || CFG.CHRONO_S || 15) }); };
  PokerClient.prototype.chiffrer       = function (valeur) { return this.appeler('poker_estimate', { p_value: valeur }); };
  PokerClient.prototype.ticketSuivant  = function ()       { return this.appeler('poker_next_ticket'); };
  PokerClient.prototype.choisirTicket  = function (id)     { return this.appeler('poker_select_ticket', { p_ticket: id }); };
  PokerClient.prototype.importer       = function (liste)  { return this.appeler('poker_import_tickets', { p_tickets: liste }); };
  PokerClient.prototype.partir         = function ()       { return this.appeler('poker_leave'); };
  PokerClient.prototype.rejoindre      = function (nom, role) {
    return this.appeler('poker_join', { p_name: nom, p_role: role });
  };

  /** Plusieurs notifications d'affilée ne déclenchent qu'un seul appel. */
  PokerClient.prototype.rafraichirBientot = function () {
    var self = this;
    if (this.minuteurGroupe) return;
    this.minuteurGroupe = setTimeout(function () {
      self.minuteurGroupe = null;
      if (self.enVol) { self.rafraichirBientot(); return; }
      self.enVol = true;
      self.rafraichir().catch(function () {}).then(function () { self.enVol = false; });
    }, 70);
  };

  /** Branche l'écoute Realtime. La notification ne contient aucun vote. */
  PokerClient.prototype.brancherRealtime = function () {
    var self = this;
    if (!window.supabase || !window.supabase.createClient) return false;
    var e = env();
    if (!e.url || !e.key) return false;

    try {
      this.sb = window.supabase.createClient(e.url, e.key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      this.canal = this.sb.channel('poker:' + this.code)
        .on('broadcast', { event: 'maj' }, function () { self.rafraichirBientot(); })
        .subscribe(function (statut) {
          self.realtimeOk = statut === 'SUBSCRIBED';
          self.diffuserReseau(null);
          // Au retour du réseau, on peut avoir manqué des tours entiers.
          if (self.realtimeOk) self.rafraichirBientot();
        });
      return true;
    } catch (_) {
      return false;
    }
  };

  /** Le filet : un sondage lent, resserré quand le websocket est tombé. */
  PokerClient.prototype.demarrerSondage = function () {
    var self = this;
    if (this.minuteurSondage) return this;
    (function tour() {
      var periode = self.realtimeOk ? (CFG.POLL_MS || 5000) : (CFG.POLL_MS_HORS_LIGNE || 1200);
      self.minuteurSondage = setTimeout(function () {
        if (self.enVol) { tour(); return; }
        self.enVol = true;
        self.rafraichir().catch(function () {}).then(function () { self.enVol = false; tour(); });
      }, periode);
    })();
    return this;
  };

  PokerClient.prototype.arreter = function () {
    if (this.minuteurSondage) { clearTimeout(this.minuteurSondage); this.minuteurSondage = null; }
    if (this.minuteurGroupe) { clearTimeout(this.minuteurGroupe); this.minuteurGroupe = null; }
    if (this.canal) { try { this.sb.removeChannel(this.canal); } catch (_) {} this.canal = null; }
  };

  // ─── Ouverture d'une session ─────────────────────────────────────────────

  /** Crée une session : renvoie {client, etat}. */
  function creer(nom, role) {
    var jeton = nouveauJeton();
    return rpc('poker_create_session', { p_token: jeton, p_name: nom, p_role: role })
      .then(function (etat) {
        ecrire('poker-jeton-' + etat.code, jeton);
        retenirProfil(nom, role, etat.code);
        var client = new PokerClient(etat.code, jeton);
        client.diffuser(etat);
        return { client: client, etat: etat };
      });
  }

  /** Rejoint une session existante : renvoie {client, etat}. */
  function rejoindre(code, nom, role) {
    code = String(code || '').toUpperCase();
    var client = new PokerClient(code, jetonPour(code));
    return client.rejoindre(nom, role).then(function (etat) {
      retenirProfil(nom, role, code);
      return { client: client, etat: etat };
    });
  }

  window.Poker = {
    Client: PokerClient,
    creer: creer,
    rejoindre: rejoindre,
    profil: profil,
    jetonPour: jetonPour,
    configuree: function () { var e = env(); return !!(e.url && e.key); },
  };
})();
