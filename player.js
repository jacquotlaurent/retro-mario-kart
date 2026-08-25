/* ═══════════════════════════════════════════════════════════════════════════
   Écran smartphone : la manette de chaque participant.
   Aucun compte, aucun mot de passe — juste un prénom et six cartes.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var STORAGE_NOM = 'retro-mario-kart-nom';

  var code = window.Retro.codeFromUrl();
  if (!code) {
    document.body.innerHTML =
      '<div class="tel"><h1 class="tel__titre">🏁 Code de course manquant</h1>' +
      '<p class="tel__aide">Scanne le QR code affiché sur le grand écran, ou ajoute le code ' +
      'de la course à la fin de l\'adresse (par exemple <code>…/play.html#ABCD</code>).</p></div>';
    return;
  }

  var demo = window.Retro.isDemo();
  var client = new window.Retro.Client({ code: code, demo: demo });
  var deck = {};
  var nom = '';
  var carteChoisie = null;
  var etat = null;

  try { nom = localStorage.getItem(STORAGE_NOM) || ''; } catch (_) {}

  function deltaTexte(d) { return (d > 0 ? '+' : '') + d; }

  function signalerErreur(err) {
    var boite = $('alerte');
    boite.textContent = '⚠️ ' + (err && err.message ? err.message : 'connexion perdue');
    boite.hidden = false;
    setTimeout(function () { boite.hidden = true; }, 4000);
  }

  // ─── Les cartes ──────────────────────────────────────────────────────────

  function renderCartes(cartes) {
    var zone = $('cartes');
    if (zone.childElementCount === cartes.length) return;
    zone.innerHTML = '';
    cartes.forEach(function (card) {
      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'carte';
      bouton.setAttribute('aria-pressed', 'false');
      bouton.dataset.id = card.id;
      bouton.innerHTML =
        '<span class="carte__objet">' + card.emoji + '</span>' +
        '<span class="carte__label"></span>' +
        '<span class="carte__delta delta--' + (card.delta >= 0 ? 'positif' : 'negatif') + '">' +
        deltaTexte(card.delta) + (Math.abs(card.delta) > 1 ? ' cases' : ' case') + '</span>' +
        '<span class="carte__hint"></span>';
      bouton.querySelector('.carte__label').textContent = card.label;
      bouton.querySelector('.carte__hint').textContent = card.hint || '';
      bouton.addEventListener('click', function () { choisir(card); });
      zone.appendChild(bouton);
    });
  }

  function choisir(card) {
    carteChoisie = card;
    window.RetroFx.vibrate(12);
    Array.prototype.forEach.call($('cartes').children, function (n) {
      n.setAttribute('aria-pressed', String(n.dataset.id === card.id));
    });
    var bouton = $('btn-jouer');
    bouton.disabled = false;
    bouton.textContent = 'Jouer ' + card.emoji + ' ' + card.label + ' (' + deltaTexte(card.delta) + ')';
  }

  // ─── Passage de parole ───────────────────────────────────────────────────

  function renderJoueurs(players) {
    var zone = $('puces-joueurs');
    zone.innerHTML = '';
    (players || []).forEach(function (p) {
      if (p === nom) return;
      var puce = document.createElement('button');
      puce.type = 'button';
      puce.className = 'puce';
      puce.textContent = p;
      puce.addEventListener('click', function () {
        client.pass(p).then(function () {
          puce.classList.add('puce--actif');
          window.RetroFx.vibrate([10, 40, 10]);
        }).catch(signalerErreur);
      });
      zone.appendChild(puce);
    });
    if (!zone.childElementCount) {
      var vide = document.createElement('p');
      vide.className = 'tel__aide';
      vide.textContent = 'Tu es seul·e connecté·e pour l\'instant — les autres apparaîtront ici dès qu\'ils rejoindront.';
      zone.appendChild(vide);
    }
  }

  // ─── Flux ────────────────────────────────────────────────────────────────

  function renderFlux(events) {
    var liste = $('flux');
    liste.innerHTML = '';
    (events || []).slice(0, 6).forEach(function (e) {
      var card = deck[e.card_id] || {};
      var li = document.createElement('li');
      var auteur = document.createElement('b');
      auteur.textContent = e.player;
      li.appendChild(document.createTextNode((card.emoji || '🎴') + ' '));
      li.appendChild(auteur);
      li.appendChild(document.createTextNode(
        ' ' + deltaTexte(e.delta) + (e.note ? ' — ' + e.note : '') + (e.undone ? ' (annulé)' : '')
      ));
      if (e.undone) li.style.opacity = '.45';
      liste.appendChild(li);
    });
  }

  // ─── Rendu global ────────────────────────────────────────────────────────

  function render(state) {
    if (!state || !state.exists) return;
    etat = state;
    (state.deck || []).forEach(function (c) { deck[c.id] = c; });

    $('hud-code').textContent = state.code;
    $('hud-case').textContent = state.position + '/' + state.casesPerLap;
    $('hud-tour').textContent = state.lap;

    renderCartes((state.deck || []).slice().sort(function (a, b) { return a.ordinal - b.ordinal; }));
    renderFlux(state.events);
    renderJoueurs(state.players);

    var parole = $('tour-de-parole');
    if (state.speaker === nom) {
      parole.innerHTML = '🐢 <strong style="color:var(--or)">C\'est à toi de parler.</strong>';
    } else if (state.speaker) {
      parole.textContent = '🐢 ' + state.speaker + ' a la parole.';
    } else {
      parole.textContent = 'Personne n\'a encore pris la parole. Lance-toi !';
    }
  }

  // ─── Étapes ──────────────────────────────────────────────────────────────

  function montrer(etape) {
    ['etape-nom', 'etape-jeu', 'etape-apres'].forEach(function (id) {
      $(id).hidden = id !== etape;
    });
  }

  function rejoindre() {
    var saisi = $('champ-nom').value.trim();
    if (!saisi) { $('champ-nom').focus(); return; }
    nom = saisi;
    try { localStorage.setItem(STORAGE_NOM, nom); } catch (_) {}
    window.RetroFx.unlockAudio();
    montrer('etape-jeu');
    client.join(nom).catch(signalerErreur);
  }

  function jouer() {
    if (!carteChoisie) return;
    var note = $('champ-note').value.trim();
    var card = carteChoisie;
    $('btn-jouer').disabled = true;
    client.play(card.id, nom, note).then(function () {
      window.RetroFx.vibrate(card.delta >= 0 ? [16, 50, 16] : [60]);
      $('confirm-objet').textContent = card.emoji;
      $('confirm-texte').textContent =
        card.label + ' ' + deltaTexte(card.delta) + ' — le kart de l\'équipe a bougé sur le grand écran !';
      $('champ-note').value = '';
      carteChoisie = null;
      Array.prototype.forEach.call($('cartes').children, function (n) { n.setAttribute('aria-pressed', 'false'); });
      $('btn-jouer').textContent = 'Choisis une carte';
      montrer('etape-apres');
      if (etat) renderJoueurs(etat.players);
    }).catch(function (err) {
      $('btn-jouer').disabled = false;
      signalerErreur(err);
    });
  }

  // ─── Démarrage ───────────────────────────────────────────────────────────

  $('badge-demo').hidden = !demo;
  $('hud-code').textContent = code;
  $('champ-nom').value = nom;

  $('btn-rejoindre').addEventListener('click', rejoindre);
  $('champ-nom').addEventListener('keydown', function (e) { if (e.key === 'Enter') rejoindre(); });
  $('btn-jouer').addEventListener('click', jouer);
  $('btn-rejouer').addEventListener('click', function () { montrer('etape-jeu'); });

  client.onError(function (err, failures) {
    if (err && failures >= 3) signalerErreur(new Error('connexion perdue, nouvelle tentative…'));
  });
  client.on(render);
  client.join(nom || null).catch(signalerErreur).then(function () { client.startPolling(); });

  montrer(nom ? 'etape-jeu' : 'etape-nom');
})();
