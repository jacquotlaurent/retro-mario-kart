/* ═══════════════════════════════════════════════════════════════════════════
   L'écran du Planning Poker.

   Un seul état fait foi : celui que renvoie poker_state. À chaque nouvelle
   version reçue, on redessine — c'est court, et ça évite toute divergence
   entre ce qui est affiché et ce que la base autorise à voir.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = window.POKER_CONFIG || {};
  var lib = window.PokerLib;

  function $(id) { return document.getElementById(id); }
  function texte(id, valeur) { $(id).textContent = valeur; }
  function montrer(id, oui) { $(id).hidden = !oui; }

  var client = null;
  var etat = null;
  var roleChoisi = 'participant';
  var cartesDessinees = false;
  var minuteurChrono = null;
  var minuteurAlerte = null;
  var tourPrecedent = null;      // { id, revele } — pour repérer la révélation
  var chiffrageTouche = false;   // le facilitateur a choisi lui-même sa valeur
  var listeAImporter = [];

  // ─── Petits services d'écran ─────────────────────────────────────────────

  function alerte(message, duree) {
    var el = $('alerte');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(minuteurAlerte);
    minuteurAlerte = setTimeout(function () { el.hidden = true; }, duree || 3200);
  }

  function echec(err) {
    alerte(err && err.message ? err.message : 'Action impossible', 4000);
  }

  function lien() {
    return location.origin + location.pathname + '#' + (etat ? etat.code : '');
  }

  // ─── Écran d'entrée ──────────────────────────────────────────────────────

  function choisirRole(role) {
    roleChoisi = role;
    ['participant', 'spectateur'].forEach(function (r) {
      var el = $('role-' + r);
      el.classList.toggle('est-actif', r === role);
      el.setAttribute('aria-checked', r === role ? 'true' : 'false');
    });
  }

  function nomSaisi() {
    var nom = $('champ-nom').value.trim();
    if (!nom) {
      $('champ-nom').focus();
      alerte('Il manque ton prénom.');
      return null;
    }
    return nom;
  }

  function versAccueil(message) {
    if (client) { client.arreter(); client = null; }
    etat = null;
    tourPrecedent = null;
    cartesDessinees = false;
    montrer('vue-session', false);
    montrer('vue-accueil', true);
    if (message) alerte(message, 5000);
  }

  function entrer(resultat) {
    client = resultat.client;
    etat = resultat.etat;
    tourPrecedent = null;
    chiffrageTouche = false;
    cartesDessinees = false;

    client.sur(function (nouvel) { etat = nouvel; rendre(); });
    client.surReseau(function (info) {
      var el = $('bandeau-reseau');
      if (info.erreur && /inconnu|session inconnue/i.test(info.erreur.message || '')) {
        versAccueil('Cette session n\'existe plus. Crée ou rejoins-en une autre.');
        return;
      }
      el.hidden = info.echecs < 2;
      el.textContent = 'Connexion perdue — nouvelle tentative…';
    });

    client.brancherRealtime();
    client.demarrerSondage();

    if (location.hash.replace('#', '').toUpperCase() !== etat.code) {
      history.replaceState(null, '', '#' + etat.code);
    }

    montrer('vue-accueil', false);
    montrer('vue-session', true);
    rendre();

    if (!minuteurChrono) minuteurChrono = setInterval(dessinerChrono, 250);
  }

  function creer() {
    var nom = nomSaisi();
    if (!nom) return;
    $('btn-creer').disabled = true;
    window.Poker.creer(nom, roleChoisi)
      .then(entrer)
      .catch(echec)
      .then(function () { $('btn-creer').disabled = false; });
  }

  function rejoindre() {
    var nom = nomSaisi();
    if (!nom) return;
    var code = $('champ-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      $('champ-code').focus();
      alerte('Un code de session fait quatre caractères.');
      return;
    }
    $('btn-rejoindre').disabled = true;
    window.Poker.rejoindre(code, nom, roleChoisi)
      .then(entrer)
      .catch(echec)
      .then(function () { $('btn-rejoindre').disabled = false; });
  }

  // ─── Dessin de la session ────────────────────────────────────────────────

  /** Les personnes dont on attend un vote : participants, présents. */
  function votantsAttendus() {
    return (etat.participants || []).filter(function (p) {
      return p.role === 'participant' && p.online;
    });
  }

  function rendre() {
    if (!etat || !etat.me) return;

    var moi = etat.me;
    var chef = !!moi.is_facilitator;
    var round = etat.round;
    var revele = !!(round && round.revealed);
    var attendus = votantsAttendus();
    var votes = attendus.filter(function (p) { return p.has_voted; }).length;

    // ─ entête
    texte('etiquette-code', etat.code);
    texte('compte-presents', String((etat.participants || []).filter(function (p) { return p.online; }).length));

    // ─ ticket
    var ticket = etat.ticket;
    montrer('ticket-cle', !!(ticket && ticket.key));
    if (ticket && ticket.key) texte('ticket-cle', ticket.key);
    texte('ticket-titre', ticket ? ticket.title : 'Aucun ticket chargé');
    montrer('ticket-tour', !!(round && round.number > 1));
    if (round) texte('ticket-tour', 'Tour n° ' + round.number);
    montrer('ticket-chiffrage', !!(ticket && ticket.final_estimate));
    if (ticket && ticket.final_estimate) texte('ticket-chiffrage', '✓ chiffré ' + ticket.final_estimate);
    montrer('ticket-vide', !ticket);
    if (!ticket) {
      texte('ticket-vide', chef
        ? 'Colle la liste des tickets pour démarrer.'
        : 'En attente que le facilitateur charge les tickets.');
    }

    // ─ avancement du vote
    montrer('avancement', !!round && !revele && attendus.length > 0);
    if (round && !revele) {
      texte('avancement-texte', votes + ' / ' + attendus.length +
        (attendus.length > 1 ? ' ont voté' : ' a voté'));
      $('jauge').style.width = (attendus.length ? (votes / attendus.length) * 100 : 0) + '%';
    }

    // ─ les cartes, cœur de l'écran
    dessinerCartes(revele);

    // ─ message d'ambiance
    var message = '';
    if (ticket && moi.role === 'spectateur') {
      message = revele
        ? ''
        : '👀 Tu observes cette session : les spectateurs ne votent pas, et ne bloquent pas la révélation.';
    } else if (ticket && !revele && moi.vote) {
      message = 'Ta carte est enregistrée. Elle reste cachée jusqu\'à ce que tout le monde ait voté.';
    }
    montrer('message', !!message);
    if (message) texte('message', message);

    // ─ résultats
    montrer('resultats', revele);
    if (revele) dessinerResultats();

    // ─ barre du facilitateur
    montrer('barre', chef);
    if (chef) dessinerBarre(revele, votes);

    // ─ panneau
    dessinerParticipants(revele);
    dessinerTickets(chef);
    montrer('btn-importer', chef);
    var animateur = (etat.participants || []).filter(function (p) { return p.is_facilitator; })[0];
    $('aide-facilitateur').textContent = chef
      ? 'Tu animes la session : à toi les tickets, la révélation et le chrono.'
      : (animateur ? animateur.name + ' anime la session.' : '');

    // ─ chrono
    dessinerChrono();

    // ─ consensus : uniquement au moment où la révélation tombe
    if (round) {
      var memeTour = tourPrecedent && tourPrecedent.id === round.id;
      if (revele && memeTour && !tourPrecedent.revele && etat.tally && etat.tally.consensus) feter();
      tourPrecedent = { id: round.id, revele: revele };
    } else {
      tourPrecedent = null;
    }
  }

  function dessinerCartes(revele) {
    var moi = etat.me;
    var jouable = !!etat.round && !revele && moi.role === 'participant';
    var conteneur = $('cartes');

    if (!etat.deck.length || moi.role !== 'participant' || !etat.ticket) {
      conteneur.innerHTML = '';
      cartesDessinees = false;
      return;
    }

    if (!cartesDessinees) {
      conteneur.innerHTML = '';
      etat.deck.forEach(function (carte) {
        var bouton = document.createElement('button');
        bouton.type = 'button';
        bouton.className = 'carte';
        bouton.dataset.carte = carte.id;
        bouton.textContent = carte.id;
        bouton.setAttribute('aria-pressed', 'false');
        bouton.title = carte.value === null ? 'Je ne sais pas' : carte.value + ' points';
        bouton.addEventListener('click', function () { voter(carte.id); });
        conteneur.appendChild(bouton);
      });
      cartesDessinees = true;
    }

    Array.prototype.forEach.call(conteneur.children, function (bouton) {
      var choisie = moi.vote === bouton.dataset.carte;
      bouton.classList.toggle('est-choisie', choisie);
      bouton.setAttribute('aria-pressed', choisie ? 'true' : 'false');
      bouton.disabled = !jouable;
    });
    conteneur.hidden = revele;
  }

  function dessinerResultats() {
    var t = etat.tally || {};
    texte('moyenne', t.numeric_votes ? lib.formatMoyenne(t.average) : '—');

    var details = [];
    if (t.numeric_votes) details.push('de ' + lib.formatMoyenne(t.min) + ' à ' + lib.formatMoyenne(t.max));
    details.push(t.votes + (t.votes > 1 ? ' votes' : ' vote'));
    var inconnus = (t.votes || 0) - (t.numeric_votes || 0);
    if (inconnus > 0) details.push(inconnus + ' × « ? » hors moyenne');
    texte('moyenne-detail', details.join(' · '));

    var ordre = {};
    etat.deck.forEach(function (carte, i) { ordre[carte.id] = i; });

    var votants = (etat.participants || []).filter(function (p) { return p.role === 'participant'; });
    votants.sort(function (a, b) {
      var oa = a.vote ? ordre[a.vote] : 99;
      var ob = b.vote ? ordre[b.vote] : 99;
      return oa - ob || a.name.localeCompare(b.name);
    });

    var liste = $('revelation');
    liste.innerHTML = '';
    votants.forEach(function (p) {
      var li = document.createElement('li');
      var carte = document.createElement('span');
      carte.className = 'revelation__carte' +
        (p.vote ? '' : ' revelation__carte--vide') +
        (p.id === etat.me.id ? ' revelation__carte--moi' : '');
      carte.textContent = p.vote || '—';
      var nom = document.createElement('span');
      nom.className = 'revelation__nom';
      nom.textContent = p.name;
      li.appendChild(carte);
      li.appendChild(nom);
      liste.appendChild(li);
    });
  }

  function dessinerBarre(revele, votes) {
    var round = etat.round;
    var chronoEnCours = !!(round && round.timer_started_at &&
      lib.chronoRestant(round, client.decalage, Date.now()) > 0);

    $('btn-chrono').textContent = chronoEnCours ? '⏹ Arrêter' : '⏱ ' + (CFG.CHRONO_S || 15) + ' s';
    $('btn-chrono').disabled = !round;

    montrer('btn-reveler', !!round && !revele);
    $('btn-reveler').disabled = !votes;
    $('btn-reveler').title = votes ? '' : 'Personne n\'a encore voté';

    montrer('btn-nouveau-tour', !!round && revele);
    montrer('bloc-chiffrage', !!round && revele);
    if (round && revele) remplirChiffrage();

    $('btn-suivant').disabled = !(etat.tickets || []).length;
  }

  /** Propose d'emblée la valeur la plus probable, sans jamais l'imposer. */
  function remplirChiffrage() {
    var select = $('select-chiffrage');
    if (select.options.length !== etat.deck.length) {
      select.innerHTML = '';
      etat.deck.forEach(function (carte) {
        var option = document.createElement('option');
        option.value = carte.id;
        option.textContent = carte.id;
        select.appendChild(option);
      });
      chiffrageTouche = false;
    }
    if (chiffrageTouche) return;

    var t = etat.tally || {};
    var propose = (etat.ticket && etat.ticket.final_estimate) ||
      (t.consensus && t.numeric_votes ? lib.carteLaPlusProche(etat.deck, t.min)
        : lib.carteLaPlusProche(etat.deck, t.average));
    if (propose) select.value = propose;
  }

  function dessinerParticipants(revele) {
    var liste = $('participants');
    liste.innerHTML = '';
    (etat.participants || []).forEach(function (p) {
      var li = document.createElement('li');
      if (p.id === etat.me.id) li.className = 'est-moi';

      var pastille = document.createElement('span');
      pastille.className = 'pastille' + (p.online ? '' : ' pastille--absent');
      pastille.title = p.online ? 'présent' : 'silencieux depuis un moment';
      li.appendChild(pastille);

      var nom = document.createElement('span');
      nom.className = 'participants__nom';
      nom.textContent = p.name;
      li.appendChild(nom);

      var rang = document.createElement('span');
      rang.className = 'participants__rang';
      rang.textContent = (p.is_facilitator ? '🎙' : '') + (p.role === 'spectateur' ? ' 👀' : '');
      rang.title = (p.is_facilitator ? 'facilitateur ' : '') + p.role;
      li.appendChild(rang);

      if (p.role === 'spectateur') {
        var vide = document.createElement('span');
        vide.className = 'participants__etat';
        vide.textContent = 'spectateur';
        li.appendChild(vide);
      } else if (revele) {
        var carte = document.createElement('span');
        carte.className = 'participants__carte';
        carte.textContent = p.vote || '—';
        li.appendChild(carte);
      } else {
        var marque = document.createElement('span');
        marque.className = 'participants__etat' + (p.has_voted ? ' a-vote' : '');
        marque.textContent = p.has_voted ? '✓ a voté' : 'réfléchit…';
        li.appendChild(marque);
      }
      liste.appendChild(li);
    });

    texte('compte-participants', String((etat.participants || []).length));
  }

  function dessinerTickets(chef) {
    var liste = $('tickets');
    liste.innerHTML = '';
    (etat.tickets || []).forEach(function (t) {
      var li = document.createElement('li');
      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'ticket-item' + (t.current ? ' est-courant' : '');
      bouton.disabled = !chef;
      if (chef) bouton.addEventListener('click', function () {
        client.choisirTicket(t.id).then(fermerPanneau).catch(echec);
      });

      if (t.key) {
        var cle = document.createElement('span');
        cle.className = 'ticket-item__cle';
        cle.textContent = t.key;
        bouton.appendChild(cle);
      }
      var titre = document.createElement('span');
      titre.className = 'ticket-item__titre';
      titre.textContent = t.title;
      titre.title = t.title;
      bouton.appendChild(titre);

      if (t.final_estimate) {
        var chiffre = document.createElement('span');
        chiffre.className = 'ticket-item__chiffrage';
        chiffre.textContent = t.final_estimate;
        bouton.appendChild(chiffre);
      }
      li.appendChild(bouton);
      liste.appendChild(li);
    });

    var chiffres = (etat.tickets || []).filter(function (t) { return t.final_estimate; }).length;
    texte('compte-tickets', (etat.tickets || []).length
      ? chiffres + '/' + etat.tickets.length + ' chiffrés' : '');
  }

  function dessinerChrono() {
    if (!etat || !client) return;
    var reste = lib.chronoRestant(etat.round, client.decalage, Date.now());
    montrer('chrono', reste !== null);
    if (reste === null) return;
    texte('chrono-valeur', String(reste));
    var el = $('chrono');
    el.classList.toggle('est-court', reste > 0 && reste <= 5);
    el.classList.toggle('est-fini', reste === 0);
  }

  /** Court, discret, et jamais deux fois pour le même tour. */
  function feter() {
    var el = $('consensus');
    el.hidden = false;
    var grains = [];
    for (var i = 0; i < 10; i++) {
      var grain = document.createElement('span');
      grain.className = 'consensus__grain';
      grain.textContent = ['🎉', '✨', '🎊'][i % 3];
      // Les grains retombent sous la bulle : ils ne passent pas devant l'entête.
      grain.style.setProperty('--dx', (Math.random() * 300 - 150).toFixed(0) + 'px');
      grain.style.setProperty('--dy', (Math.random() * 170 + 30).toFixed(0) + 'px');
      el.appendChild(grain);
      grains.push(grain);
    }
    setTimeout(function () {
      el.hidden = true;
      grains.forEach(function (g) { g.remove(); });
    }, 1900);
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  function voter(carte) {
    if (!client) return;
    client.voter(carte).catch(echec);
  }

  function fermerPanneau() { $('panneau').classList.remove('est-ouvert'); $('btn-panneau').setAttribute('aria-expanded', 'false'); }

  function basculerPanneau() {
    var ouvert = $('panneau').classList.toggle('est-ouvert');
    $('btn-panneau').setAttribute('aria-expanded', ouvert ? 'true' : 'false');
  }

  function lancerChrono() {
    var round = etat.round;
    var enCours = !!(round && round.timer_started_at &&
      lib.chronoRestant(round, client.decalage, Date.now()) > 0);
    client.chrono(enCours ? null : (CFG.CHRONO_S || 15)).catch(echec);
  }

  function relireImport() {
    listeAImporter = lib.lireTickets($('champ-tickets').value);
    $('btn-lancer-import').disabled = !listeAImporter.length;
    texte('apercu-import', listeAImporter.length
      ? listeAImporter.length + (listeAImporter.length > 1 ? ' tickets reconnus' : ' ticket reconnu')
      : '');
  }

  function lancerImport() {
    if (!listeAImporter.length) return;
    $('btn-lancer-import').disabled = true;
    client.importer(listeAImporter).then(function (reponse) {
      montrer('modale-import', false);
      $('champ-tickets').value = '';
      relireImport();
      var n = reponse && reponse.imported;
      alerte(n ? n + (n > 1 ? ' tickets importés.' : ' ticket importé.') : 'Ces tickets étaient déjà là.');
    }).catch(function (err) {
      $('btn-lancer-import').disabled = false;
      echec(err);
    });
  }

  function ouvrirInvitation() {
    montrer('modale-invitation', true);
    texte('code-affiche', etat.code);
    texte('url-affichee', lien());
    if (window.RetroQr) window.RetroQr.render($('qr'), lien(), 132);
  }

  function copierLien() {
    var url = lien();
    var fini = function () { alerte('Lien copié.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(fini, function () { alerte('Copie refusée : le lien est affiché.'); });
    } else {
      alerte('Copie indisponible : le lien est affiché.');
    }
  }

  function quitter() {
    if (!client) return;
    var fin = function () {
      history.replaceState(null, '', location.pathname);
      fermerPanneau();
      versAccueil('Tu as quitté la session.');
    };
    client.partir().then(fin, fin);
  }

  // ─── Branchements ────────────────────────────────────────────────────────

  function brancher() {
    $('role-participant').addEventListener('click', function () { choisirRole('participant'); });
    $('role-spectateur').addEventListener('click', function () { choisirRole('spectateur'); });
    $('form-accueil').addEventListener('submit', function (e) { e.preventDefault(); rejoindre(); });
    $('btn-creer').addEventListener('click', creer);
    $('champ-code').addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    });

    $('btn-panneau').addEventListener('click', basculerPanneau);
    $('btn-fermer-panneau').addEventListener('click', fermerPanneau);
    $('btn-quitter').addEventListener('click', quitter);

    $('btn-chrono').addEventListener('click', lancerChrono);
    $('btn-reveler').addEventListener('click', function () { client.reveler().catch(echec); });
    $('btn-nouveau-tour').addEventListener('click', function () {
      chiffrageTouche = false;
      client.nouveauTour().catch(echec);
    });
    $('select-chiffrage').addEventListener('change', function () { chiffrageTouche = true; });
    $('btn-valider').addEventListener('click', function () {
      client.chiffrer($('select-chiffrage').value).then(function () {
        chiffrageTouche = false;
        alerte('Chiffrage enregistré.');
      }).catch(echec);
    });
    $('btn-suivant').addEventListener('click', function () {
      chiffrageTouche = false;
      client.ticketSuivant().then(function (reponse) {
        if (reponse && reponse.finished) alerte('Tous les tickets sont chiffrés. 🎉', 4000);
      }).catch(echec);
    });

    $('btn-inviter').addEventListener('click', ouvrirInvitation);
    $('btn-copier').addEventListener('click', copierLien);
    $('btn-fermer-invitation').addEventListener('click', function () { montrer('modale-invitation', false); });

    $('btn-importer').addEventListener('click', function () {
      montrer('modale-import', true);
      $('champ-tickets').focus();
    });
    $('btn-fermer-import').addEventListener('click', function () { montrer('modale-import', false); });
    $('champ-tickets').addEventListener('input', relireImport);
    $('btn-lancer-import').addEventListener('click', lancerImport);
    $('fichier-csv').addEventListener('change', function () {
      var fichier = this.files && this.files[0];
      if (!fichier) return;
      var lecteur = new FileReader();
      lecteur.onload = function () {
        $('champ-tickets').value = String(lecteur.result || '');
        relireImport();
      };
      lecteur.onerror = function () { alerte('Ce fichier n\'a pas pu être lu.'); };
      lecteur.readAsText(fichier);
      this.value = '';
    });

    // Fermer une fenêtre en cliquant à côté, ou avec Échap.
    ['modale-invitation', 'modale-import'].forEach(function (id) {
      $(id).addEventListener('click', function (e) { if (e.target === this) this.hidden = true; });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      montrer('modale-invitation', false);
      montrer('modale-import', false);
      fermerPanneau();
    });

    // Retour d'onglet : on peut avoir manqué des tours entiers.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && client) client.rafraichirBientot();
    });
  }

  // ─── Démarrage ───────────────────────────────────────────────────────────

  function demarrer() {
    brancher();

    var profil = window.Poker.profil();
    if (profil.nom) $('champ-nom').value = profil.nom;
    choisirRole(profil.role === 'spectateur' ? 'spectateur' : 'participant');

    var code = lib.codeDeUrl(location.hash, location.search);
    if (code) $('champ-code').value = code;

    // Avec un code sous la main on vient rejoindre ; sans code, on vient créer.
    $('btn-rejoindre').classList.toggle('bouton--principal', !!code);
    $('btn-creer').classList.toggle('bouton--principal', !code);

    if (!window.Poker.configuree()) {
      montrer('vue-accueil', true);
      alerte('Supabase n\'est pas configuré : voir poker/config.js.', 9000);
      return;
    }

    // On était déjà dans cette session : on reprend sa place sans rien demander.
    if (code && profil.nom && profil.code === code) {
      window.Poker.rejoindre(code, profil.nom, profil.role || 'participant')
        .then(entrer)
        .catch(function () {
          montrer('vue-accueil', true);
          $('champ-nom').focus();
        });
      return;
    }

    montrer('vue-accueil', true);
    ($('champ-nom').value ? $(code ? 'btn-rejoindre' : 'champ-code') : $('champ-nom')).focus();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer);
  else demarrer();
})();
