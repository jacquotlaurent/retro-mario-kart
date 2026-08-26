/* ═══════════════════════════════════════════════════════════════════════════
   Écran smartphone : la manette de chaque participant.
   Aucun compte, aucun mot de passe — juste un prénom et six cartes.

   Deux temps, comme dans la vraie rétro :
     • la PRÉPARATION — chacun se constitue une main pendant que les autres
       parlent. Rien ne quitte le téléphone : la main vit dans le stockage local
       du navigateur, personne d'autre ne la voit ;
     • l'ENVOI — quand vient son tour de parole, on envoie ses cartes une par
       une, et le kart bouge sur le grand écran à chaque fois.
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

  var STORAGE_MAIN = 'retro-mario-kart-main-' + code;

  var demo = window.Retro.isDemo();
  var client = new window.Retro.Client({ code: code, demo: demo, eventsLimit: 12 });
  var deck = {};
  var nom = '';
  var carteChoisie = null;
  var etat = null;
  var dejaVu = false;      // le prénom a déjà été vu dans la liste des pilotes
  var parti = false;       // sorti de la course, volontairement ou non
  var pingPresence = null;

  try { nom = localStorage.getItem(STORAGE_NOM) || ''; } catch (_) {}

  function deltaTexte(d) { return (d > 0 ? '+' : '') + d; }
  function unitéCases(d) { return Math.abs(d) > 1 ? ' cases' : ' case'; }

  function signalerErreur(err) {
    var boite = $('alerte');
    boite.textContent = '⚠️ ' + (err && err.message ? err.message : 'connexion perdue');
    boite.hidden = false;
    setTimeout(function () { boite.hidden = true; }, 4000);
  }

  // ─── La main préparée ────────────────────────────────────────────────────
  // Elle ne quitte jamais le téléphone tant qu'une carte n'est pas envoyée.
  // localStorage et non sessionStorage : sur mobile, l'onglet est tué dès qu'on
  // passe vingt minutes dans une autre application — la main doit y survivre.

  var main = [];

  function chargerMain() {
    try {
      var brut = localStorage.getItem(STORAGE_MAIN);
      var lu = brut ? JSON.parse(brut) : null;
      if (lu && Object.prototype.toString.call(lu.cartes) === '[object Array]') return lu.cartes;
    } catch (_) {}
    return [];
  }

  function sauverMain() {
    try {
      localStorage.setItem(STORAGE_MAIN, JSON.stringify({ v: 1, cartes: main }));
    } catch (_) {}
  }

  function ajouterAMain(card, note) {
    var uid = String(Date.now()) + '-' + main.length;
    main.push({ uid: uid, card_id: card.id, note: note || '', envoye: false });
    sauverMain();
    return uid;
  }

  function deplacer(index, sens) {
    var cible = index + sens;
    if (cible < 0 || cible >= main.length) return;
    var tmp = main[index];
    main[index] = main[cible];
    main[cible] = tmp;
    sauverMain();
    renderMain();
  }

  function supprimer(index) {
    main.splice(index, 1);
    sauverMain();
    renderMain();
  }

  function trouver(uid) {
    for (var i = 0; i < main.length; i++) if (main[i].uid === uid) return main[i];
    return null;
  }

  function envoyer(uid, bouton) {
    var entree = trouver(uid);
    if (!entree || entree.envoye) return;
    var card = deck[entree.card_id];
    if (!card) return;

    // Envoyer alors que quelqu'un d'autre a la parole coupe son récit : on
    // demande confirmation plutôt que d'interdire, il y a de bonnes raisons
    // de rebondir.
    var orateur = etat && etat.speaker;
    if (orateur && orateur !== nom &&
        !confirm(orateur + ' a la manette. Envoyer ' + card.emoji + ' ' + card.label +
                 ' quand même, sans attendre ton tour ?')) {
      return;
    }

    bouton.disabled = true;
    bouton.textContent = 'Envoi…';

    client.play(entree.card_id, nom, entree.note).then(function () {
      entree.envoye = true;
      sauverMain();
      window.RetroFx.vibrate(card.delta >= 0 ? [16, 50, 16] : [60]);
      renderMain();
    }).catch(function (err) {
      bouton.disabled = false;
      bouton.textContent = 'Envoyer';
      signalerErreur(err);
    });
  }

  function renderMain() {
    var liste = $('main');
    liste.innerHTML = '';

    var enAttente = 0;
    main.forEach(function (entree, index) {
      var card = deck[entree.card_id];
      if (!card) return;             // le paquet n'est pas encore chargé
      if (!entree.envoye) enAttente++;

      var li = document.createElement('li');
      li.className = 'carte-main' + (entree.envoye ? ' carte-main--envoyee' : '');

      var haut = document.createElement('div');
      haut.className = 'carte-main__haut';

      var objet = document.createElement('span');
      objet.className = 'carte-main__objet';
      objet.textContent = card.emoji;

      var texte = document.createElement('div');
      texte.className = 'carte-main__texte';

      var titre = document.createElement('div');
      titre.className = 'carte-main__titre';
      titre.appendChild(document.createTextNode(card.label + ' '));
      var delta = document.createElement('span');
      delta.className = 'delta--' + (card.delta >= 0 ? 'positif' : 'negatif');
      delta.textContent = deltaTexte(card.delta) + unitéCases(card.delta);
      titre.appendChild(delta);
      texte.appendChild(titre);

      if (entree.note) {
        var note = document.createElement('div');
        note.className = 'carte-main__note';
        note.textContent = '« ' + entree.note + ' »';
        texte.appendChild(note);
      }

      haut.appendChild(objet);
      haut.appendChild(texte);
      li.appendChild(haut);

      var bas = document.createElement('div');
      bas.className = 'carte-main__bas';

      if (entree.envoye) {
        var fait = document.createElement('span');
        fait.className = 'carte-main__fait';
        fait.textContent = '✓ envoyée sur le circuit';
        bas.appendChild(fait);
      } else {
        var outils = document.createElement('div');
        outils.className = 'carte-main__outils';
        [['↑', -1, 'Monter'], ['↓', 1, 'Descendre']].forEach(function (o) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'mini';
          b.textContent = o[0];
          b.title = o[1] > 0 ? 'Descendre' : 'Monter';
          b.setAttribute('aria-label', o[2]);
          b.addEventListener('click', function () { deplacer(index, o[1]); });
          outils.appendChild(b);
        });
        var suppr = document.createElement('button');
        suppr.type = 'button';
        suppr.className = 'mini mini--danger';
        suppr.textContent = '✕';
        suppr.setAttribute('aria-label', 'Retirer de ma main');
        suppr.addEventListener('click', function () { supprimer(index); });
        outils.appendChild(suppr);
        bas.appendChild(outils);

        var envoi = document.createElement('button');
        envoi.type = 'button';
        envoi.className = 'bouton bouton--principal';
        envoi.textContent = 'Envoyer';
        envoi.dataset.uid = entree.uid;
        envoi.addEventListener('click', function () { envoyer(entree.uid, envoi); });
        bas.appendChild(envoi);
      }

      li.appendChild(bas);
      liste.appendChild(li);
    });

    $('main-vide').hidden = main.length > 0;
    $('bloc-manette').hidden = !(etat && (etat.players || []).length > 1);

    var preparer = $('btn-preparer');
    preparer.textContent = enAttente ? '+ Préparer une autre carte' : '+ Préparer une carte';
  }

  // ─── Le choix d'une carte ────────────────────────────────────────────────

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
        deltaTexte(card.delta) + unitéCases(card.delta) + '</span>' +
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
    $('btn-ajouter').disabled = false;
    $('btn-ajouter').textContent = 'Ajouter ' + card.emoji + ' à ma main';
    $('btn-envoyer-direct').disabled = false;
  }

  function reinitialiserChoix() {
    carteChoisie = null;
    $('champ-note').value = '';
    Array.prototype.forEach.call($('cartes').children, function (n) {
      n.setAttribute('aria-pressed', 'false');
    });
    $('btn-ajouter').disabled = true;
    $('btn-ajouter').textContent = 'Choisis une carte';
    $('btn-envoyer-direct').disabled = true;
  }

  // ─── Passage de parole ───────────────────────────────────────────────────

  var signatureJoueurs = null;

  function renderJoueurs(players, orateur, ontParle) {
    var zone = $('puces-joueurs');
    ontParle = ontParle || [];
    // Le prénom du porteur fait partie de la signature : il s'exclut lui-même
    // de la liste, et sans ça un rechargement après coup laissait sa propre
    // puce affichée — on pouvait se passer la manette à soi-même.
    var signature = nom + '@' + (players || []).join('|') + '→' + (orateur || '') + '✓' + ontParle.join('|');
    if (signature === signatureJoueurs) return;   // sinon on reconstruit 80 fois par minute
    signatureJoueurs = signature;

    // Ceux qui n'ont pas encore parlé d'abord : c'est à eux qu'on pense en
    // premier au moment de passer la manette.
    var candidats = (players || []).filter(function (p) { return p !== nom; });
    candidats.sort(function (a, b) {
      return (ontParle.indexOf(a) !== -1 ? 1 : 0) - (ontParle.indexOf(b) !== -1 ? 1 : 0);
    });

    var restants = candidats.filter(function (p) { return ontParle.indexOf(p) === -1; }).length;
    $('aide-manette').textContent = restants
      ? restants + (restants > 1 ? ' pilotes n\'ont' : ' pilote n\'a') + ' pas encore parlé.'
      : 'Tout le monde a déjà parlé — à toi de voir.';

    zone.innerHTML = '';
    candidats.forEach(function (p) {
      var dejaParle = ontParle.indexOf(p) !== -1;
      var puce = document.createElement('button');
      puce.type = 'button';
      puce.className = 'puce' + (p === orateur ? ' puce--actif' : (dejaParle ? ' puce--parle' : ''));
      puce.textContent = (p === orateur ? '🎮 ' : (dejaParle ? '✓ ' : '')) + p;
      puce.addEventListener('click', function () {
        if (p === orateur) return;
        puce.classList.add('puce--envoi');
        puce.textContent = '⏳ ' + p;
        client.pass(p).then(function () {
          window.RetroFx.vibrate([10, 40, 10]);
        }).catch(function (err) {
          puce.classList.remove('puce--envoi');
          puce.textContent = p;
          signalerErreur(err);
        });
      });
      zone.appendChild(puce);
    });
    if (!zone.childElementCount) {
      $('aide-manette').textContent = '';
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

  var deckConnu = false;

  function render(state) {
    if (!state || !state.exists) return;
    etat = state;
    (state.deck || []).forEach(function (c) { deck[c.id] = c; });

    $('hud-code').textContent = state.code;
    $('hud-case').textContent = state.position + '/' + state.casesPerLap;
    $('hud-tour').textContent = state.lap;

    var cartes = (state.deck || []).slice().sort(function (a, b) { return a.ordinal - b.ordinal; });
    renderCartes(cartes);
    renderFlux(state.events);
    renderJoueurs(state.players, state.speaker, state.spoken);

    // L'animateur a remis le plateau à zéro : les cartes de la main portaient
    // encore la mention « envoyée » alors que le circuit est vide. On les rend
    // à nouveau jouables plutôt que de laisser le pilote devant une main morte.
    if (deckConnu && !(state.events || []).length && main.some(function (e) { return e.envoye; })) {
      main.forEach(function (e) { e.envoye = false; });
      sauverMain();
      renderMain();
    }

    // Retiré de la course par l'animateur : on ne le découvre qu'en constatant
    // que le prénom a disparu de la liste après y avoir figuré.
    var present = (state.players || []).indexOf(nom) !== -1;
    if (nom && present) dejaVu = true;
    else if (nom && dejaVu && !parti) quitter(false);

    // La main ne peut s'afficher qu'une fois le paquet connu : c'est lui qui
    // porte les emoji, les libellés et le barème.
    if (!deckConnu && cartes.length) { deckConnu = true; renderMain(); }
    else if (deckConnu) { $('bloc-manette').hidden = !((state.players || []).length > 1); }

    var parole = $('tour-de-parole');
    if (state.speaker === nom) {
      parole.innerHTML = '🎮 <strong style="color:var(--or)">C\'est à toi — envoie tes cartes.</strong>';
    } else if (state.speaker) {
      parole.textContent = '🎮 ' + state.speaker + ' a la parole. Prépare ta main en attendant.';
    } else {
      parole.textContent = 'Personne n\'a encore pris la parole. Prépare ta main.';
    }
  }

  // ─── Étapes ──────────────────────────────────────────────────────────────

  function montrer(etape) {
    ['etape-nom', 'etape-main', 'etape-choix', 'etape-parti'].forEach(function (id) {
      $(id).hidden = id !== etape;
    });
    $('bloc-flux').hidden = etape === 'etape-nom' || etape === 'etape-parti';
  }

  /** Sortie de course : de son plein gré, ou retiré par l'animateur. */
  function quitter(volontaire) {
    parti = true;
    dejaVu = false;
    arreterPresence();
    $('raison-depart').textContent = volontaire
      ? 'Tu ne figures plus parmi les pilotes. Les cartes que tu as déjà envoyées restent sur le circuit.'
      : 'L\'animateur t\'a retiré de la course. Les cartes que tu as déjà envoyées restent sur le circuit.';
    montrer('etape-parti');
  }

  /* Sans ce rappel, un pilote qui écoute sans rien jouer disparaît de la liste
     au bout d'un quart d'heure : c'est le délai au-delà duquel la base cesse
     de le considérer comme présent. */
  function demarrerPresence() {
    if (pingPresence) return;
    pingPresence = setInterval(function () {
      if (parti || !nom || document.hidden) return;
      client.join(nom).catch(function () {});
    }, 120000);
  }

  function arreterPresence() {
    if (pingPresence) { clearInterval(pingPresence); pingPresence = null; }
  }

  function rejoindre() {
    var saisi = $('champ-nom').value.trim();
    if (!saisi) { $('champ-nom').focus(); return; }
    nom = saisi;
    try { localStorage.setItem(STORAGE_NOM, nom); } catch (_) {}
    window.RetroFx.unlockAudio();
    parti = false;
    montrer('etape-main');
    renderMain();
    client.join(nom).catch(signalerErreur);
    demarrerPresence();
  }

  // ─── Démarrage ───────────────────────────────────────────────────────────

  main = chargerMain();

  $('badge-demo').hidden = !demo;
  $('hud-code').textContent = code;
  $('champ-nom').value = nom;

  $('btn-rejoindre').addEventListener('click', rejoindre);
  $('champ-nom').addEventListener('keydown', function (e) { if (e.key === 'Enter') rejoindre(); });

  $('btn-preparer').addEventListener('click', function () {
    reinitialiserChoix();
    montrer('etape-choix');
  });

  $('btn-retour').addEventListener('click', function () { montrer('etape-main'); });

  $('btn-quitter').addEventListener('click', function () {
    if (!confirm('Quitter la course ? Tu peux revenir à tout moment.')) return;
    client.leave(nom).catch(signalerErreur).then(function () { quitter(true); });
  });

  $('btn-revenir').addEventListener('click', function () {
    parti = false;
    montrer('etape-main');
    renderMain();
    client.join(nom).catch(signalerErreur);
    demarrerPresence();
  });

  $('btn-ajouter').addEventListener('click', function () {
    if (!carteChoisie) return;
    ajouterAMain(carteChoisie, $('champ-note').value.trim());
    window.RetroFx.vibrate(12);
    renderMain();
    montrer('etape-main');
  });

  // Raccourci pour qui n'a rien préparé et veut réagir dans l'instant :
  // la carte rejoint la main puis part aussitôt.
  $('btn-envoyer-direct').addEventListener('click', function () {
    if (!carteChoisie) return;
    var uid = ajouterAMain(carteChoisie, $('champ-note').value.trim());
    renderMain();
    montrer('etape-main');
    var bouton = $('main').querySelector('[data-uid="' + uid + '"]');
    if (bouton) envoyer(uid, bouton);
  });

  client.onError(function (err, failures) {
    if (err && failures >= 3) signalerErreur(new Error('connexion perdue, nouvelle tentative…'));
  });
  client.on(render);
  client.join(nom || null).catch(signalerErreur).then(function () { client.startPolling(); });

  montrer(nom ? 'etape-main' : 'etape-nom');
  if (nom) demarrerPresence();
})();
