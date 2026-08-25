/* ═══════════════════════════════════════════════════════════════════════════
   Écran animateur : celui qu'on projette. Il affiche le circuit, déplace le
   kart, empile les post-its et réagit à chaque carte jouée.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  // ─── Session ─────────────────────────────────────────────────────────────

  var STORAGE_CODE = 'retro-mario-kart-code';

  function resolveCode() {
    var fromUrl = window.Retro.codeFromUrl();
    if (fromUrl) return fromUrl;
    var saved = null;
    try { saved = localStorage.getItem(STORAGE_CODE); } catch (_) {}
    var code = saved || window.Retro.randomCode();
    try { localStorage.setItem(STORAGE_CODE, code); } catch (_) {}
    location.hash = code;
    return code;
  }

  /** URL à donner aux téléphones : le même dossier, mais la page play.html. */
  function joinUrl(code) {
    var path = location.pathname.replace(/\/index\.html$/, '').replace(/\/$/, '');
    return location.origin + path + '/play.html' + (window.Retro.isDemo() ? '?demo=1' : '') + '#' + code;
  }

  var code = resolveCode();
  var demo = window.Retro.isDemo();
  var client = new window.Retro.Client({ code: code, demo: demo });

  var track = null;
  var deck = {};
  var lastEventId = 0;
  var lastLap = 0;
  var lastSignature = null;   // null, jamais '' : '' est la signature d'un plateau vide
  var premierRendu = true;

  // ─── Rendu ───────────────────────────────────────────────────────────────

  function deltaTexte(delta) { return (delta > 0 ? '+' : '') + delta; }

  function postitNode(event, card) {
    var node = document.createElement('div');
    node.className = 'postit postit--' + (event.delta >= 0 ? 'positif' : 'negatif') + (event.undone ? ' postit--annule' : '');
    var texte = document.createElement('div');
    texte.textContent = event.note;
    var meta = document.createElement('div');
    meta.className = 'postit__meta';
    var objet = document.createElement('span');
    objet.className = 'postit__objet';
    objet.textContent = (card ? card.emoji + ' ' : '') + deltaTexte(event.delta);
    var auteur = document.createElement('span');
    auteur.textContent = event.player;
    meta.appendChild(objet);
    meta.appendChild(auteur);
    node.appendChild(texte);
    node.appendChild(meta);
    return node;
  }

  function renderPostits(events) {
    var positifs = $('postits-positifs'), negatifs = $('postits-negatifs');
    positifs.innerHTML = '';
    negatifs.innerHTML = '';
    var nbPos = 0, nbNeg = 0;
    for (var i = 0; i < events.length; i++) {
      var e = events[i];
      if (!e.note) continue;
      if (e.delta >= 0 && nbPos < 8) { positifs.appendChild(postitNode(e, deck[e.card_id])); nbPos++; }
      else if (e.delta < 0 && nbNeg < 8) { negatifs.appendChild(postitNode(e, deck[e.card_id])); nbNeg++; }
    }
  }

  var BANDEAU_REPOS =
    '<div class="dernier-coup__objet">🏁</div>' +
    '<div class="dernier-coup__texte">' +
      '<div class="dernier-coup__ligne">En attente du premier pilote…</div>' +
      '<div class="dernier-coup__note">Chacun scanne le QR code, prépare sa main et raconte.</div>' +
    '</div>';

  function renderDernierCoup(event) {
    var zone = $('dernier-coup');
    if (!event) { zone.innerHTML = BANDEAU_REPOS; return; }
    var card = deck[event.card_id] || {};
    zone.innerHTML = '';

    var objet = document.createElement('div');
    objet.className = 'dernier-coup__objet';
    objet.textContent = card.emoji || '🎴';

    var texte = document.createElement('div');
    texte.className = 'dernier-coup__texte';
    var ligne = document.createElement('div');
    ligne.className = 'dernier-coup__ligne';
    var nom = document.createElement('strong');
    nom.textContent = event.player;
    ligne.appendChild(nom);
    ligne.appendChild(document.createTextNode(' a joué ' + (card.label || event.card_id) + ' '));
    var delta = document.createElement('span');
    delta.className = 'dernier-coup__delta delta--' + (event.delta >= 0 ? 'positif' : 'negatif');
    delta.textContent = deltaTexte(event.delta) + (Math.abs(event.delta) > 1 ? ' cases' : ' case');
    ligne.appendChild(delta);
    if (event.undone) ligne.appendChild(document.createTextNode('  (annulé)'));
    texte.appendChild(ligne);

    if (event.note) {
      var note = document.createElement('div');
      note.className = 'dernier-coup__note';
      note.textContent = '« ' + event.note + ' »';
      texte.appendChild(note);
    }

    zone.appendChild(objet);
    zone.appendChild(texte);
  }

  function render(state) {
    if (!state || !state.exists) return;

    (state.deck || []).forEach(function (c) { deck[c.id] = c; });

    if (!track) {
      track = window.RetroTrack.build($('circuit'), { cases: state.casesPerLap });
      track.jumpTo(state.lap * state.casesPerLap + state.position);
      renderTiroirCartes();
    }

    $('valeur-case').innerHTML = state.position + '<span style="font-size:.55em">/' + state.casesPerLap + '</span>';
    $('valeur-tour').textContent = state.lap;
    var pilotes = state.players || [];
    $('valeur-pilotes').textContent = pilotes.length;
    var signature2 = pilotes.join('|');
    if (signature2 !== signaturePilotes) {
      signaturePilotes = signature2;
      renderPilotes(pilotes);
    }

    $('parole').hidden = !state.speaker;
    if (state.speaker) $('parole-nom').textContent = state.speaker;

    var events = state.events || [];
    var signature = events.map(function (e) { return e.id + (e.undone ? 'x' : ''); }).join(',');
    if (signature !== lastSignature) {
      lastSignature = signature;
      renderPostits(events);
      renderDernierCoup(events[0]);
    }

    track.moveTo(state.lap * state.casesPerLap + state.position);

    var dernier = events[0];
    var nouveau = dernier && dernier.id > lastEventId;

    if (!premierRendu && nouveau) {
      var force = Math.abs(dernier.delta);
      if (dernier.delta >= 0) window.RetroFx.play('boost', force);
      else { window.RetroFx.play('hit', force); window.RetroFx.shake($('ecran'), force); }
    }
    if (dernier) lastEventId = Math.max(lastEventId, dernier.id);

    if (!premierRendu && state.lap > lastLap) {
      window.RetroFx.confetti($('confettis'));
      window.RetroFx.play('lap');
    }
    lastLap = state.lap;
    premierRendu = false;
  }

  // ─── Tiroir des pilotes ──────────────────────────────────────────────────

  var signaturePilotes = null;

  function renderPilotes(players) {
    var zone = $('liste-pilotes');
    zone.innerHTML = '';

    if (!players.length) {
      var vide = document.createElement('p');
      vide.className = 'tiroir__aide';
      vide.textContent = 'Personne n\'a encore rejoint la course.';
      zone.appendChild(vide);
      return;
    }

    players.forEach(function (nom) {
      var ligne = document.createElement('li');
      ligne.className = 'pilote';

      var etiquette = document.createElement('span');
      etiquette.className = 'pilote__nom';
      etiquette.textContent = nom;
      ligne.appendChild(etiquette);

      var retirer = document.createElement('button');
      retirer.type = 'button';
      retirer.className = 'bouton bouton--danger';
      retirer.textContent = 'Retirer';
      retirer.addEventListener('click', function () {
        retirer.disabled = true;
        client.leave(nom).catch(function (err) {
          retirer.disabled = false;
          signalerErreur(err);
        });
      });
      ligne.appendChild(retirer);

      zone.appendChild(ligne);
    });
  }

  // ─── Tiroir « jouer une carte » ──────────────────────────────────────────

  function renderTiroirCartes() {
    var zone = $('tiroir-cartes');
    zone.innerHTML = '';
    Object.keys(deck).map(function (k) { return deck[k]; })
      .sort(function (a, b) { return a.ordinal - b.ordinal; })
      .forEach(function (card) {
        var bouton = document.createElement('button');
        bouton.className = 'carte';
        bouton.type = 'button';
        bouton.innerHTML =
          '<span class="carte__objet">' + card.emoji + '</span>' +
          '<span class="carte__label"></span>' +
          '<span class="carte__delta delta--' + (card.delta >= 0 ? 'positif' : 'negatif') + '">' + deltaTexte(card.delta) + '</span>';
        bouton.querySelector('.carte__label').textContent = card.label;
        bouton.addEventListener('click', function () {
          var nom = ($('tiroir-nom').value || 'Animateur').trim();
          var note = $('tiroir-note').value.trim();
          client.play(card.id, nom, note).then(function () {
            $('tiroir-note').value = '';
            $('tiroir').hidden = true;
          }).catch(signalerErreur);
        });
        zone.appendChild(bouton);
      });
  }

  // ─── Erreurs ─────────────────────────────────────────────────────────────

  function signalerErreur(err) {
    var boite = $('alerte');
    boite.textContent = '⚠️ ' + (err && err.message ? err.message : 'connexion perdue');
    boite.hidden = false;
    setTimeout(function () { boite.hidden = true; }, 5000);
  }

  client.onError(function (err, failures) {
    var boite = $('alerte');
    if (!err) { if (!boite.dataset.sticky) boite.hidden = true; return; }
    if (failures >= 3) {
      boite.dataset.sticky = '1';
      boite.textContent = '⚠️ Connexion à Supabase perdue — nouvelle tentative en cours. ' +
                          'Si ça dure, ajoute ?demo=1 à l\'URL pour animer hors ligne.';
      boite.hidden = false;
    }
  });

  // ─── Démarrage ───────────────────────────────────────────────────────────

  $('code-session').textContent = code;
  var url = joinUrl(code);
  $('url-affichee').textContent = url.replace(/^https?:\/\//, '');
  window.RetroQr.render($('qr'), url, 108);
  $('badge-demo').hidden = !demo;

  client.on(render);
  client.join(null).catch(signalerErreur).then(function () { client.startPolling(); });

  $('btn-annuler').addEventListener('click', function () { client.undo().catch(signalerErreur); });
  $('btn-reset').addEventListener('click', function () {
    if (confirm('Remettre le kart sur la ligne de départ et effacer tous les post-its ?')) {
      lastEventId = 0; lastLap = 0; lastSignature = null; premierRendu = true;
      client.reset().catch(signalerErreur);
    }
  });
  $('btn-carte').addEventListener('click', function () {
    window.RetroFx.unlockAudio();
    $('tiroir').hidden = false;
    $('tiroir-note').focus();
  });
  $('tiroir-fermer').addEventListener('click', function () { $('tiroir').hidden = true; });
  $('btn-pilotes').addEventListener('click', function () { $('tiroir-pilotes').hidden = false; });
  $('pilotes-fermer').addEventListener('click', function () { $('tiroir-pilotes').hidden = true; });
  $('tiroir-pilotes').addEventListener('click', function (e) {
    if (e.target === $('tiroir-pilotes')) $('tiroir-pilotes').hidden = true;
  });
  $('tiroir').addEventListener('click', function (e) { if (e.target === $('tiroir')) $('tiroir').hidden = true; });
  $('btn-plein-ecran').addEventListener('click', function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  });

  // Les navigateurs exigent un geste de l'utilisateur avant d'autoriser le son.
  document.addEventListener('click', function once() {
    window.RetroFx.unlockAudio();
    document.removeEventListener('click', once);
  });

  document.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); client.undo().catch(signalerErreur); }
    if (e.key === 'c') $('btn-carte').click();
  });
})();
