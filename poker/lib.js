/* ═══════════════════════════════════════════════════════════════════════════
   Les fonctions pures du Planning Poker : lecture d'une liste de tickets,
   arrondi au barème, arithmétique du chrono.

   Aucun DOM, aucun réseau : c'est ce fichier que couvrent les tests
   (`node --test poker/tests/`).
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var MAX_TICKETS = 300;

  // ─── Lecture d'une liste de tickets ──────────────────────────────────────

  /** Une clé façon Jira : PROJ-123, AB1-7, SUPPORT-4512. */
  var CLE = /^([A-Za-z][A-Za-z0-9_]{0,19}-\d{1,9})$/;

  /** Découpe une ligne de CSV en respectant les guillemets doubles. */
  function decouper(ligne, separateur) {
    var cellules = [];
    var courante = '';
    var dansGuillemets = false;
    for (var i = 0; i < ligne.length; i++) {
      var c = ligne.charAt(i);
      if (dansGuillemets) {
        if (c === '"') {
          if (ligne.charAt(i + 1) === '"') { courante += '"'; i++; }
          else dansGuillemets = false;
        } else courante += c;
      } else if (c === '"') {
        dansGuillemets = true;
      } else if (c === separateur) {
        cellules.push(courante); courante = '';
      } else courante += c;
    }
    cellules.push(courante);
    for (var j = 0; j < cellules.length; j++) cellules[j] = cellules[j].trim();
    return cellules;
  }

  /** Le séparateur le plus probable, ou null si le texte n'est pas tabulaire. */
  function separateurDe(lignes) {
    var candidats = ['\t', ';', ','];
    for (var i = 0; i < candidats.length; i++) {
      var sep = candidats[i];
      var avec = 0;
      for (var j = 0; j < lignes.length; j++) {
        if (decouper(lignes[j], sep).length > 1) avec++;
      }
      // Une majorité de lignes découpées : c'est bien du tabulaire.
      if (avec >= Math.ceil(lignes.length / 2)) return sep;
    }
    return null;
  }

  var ENTETE_CLE   = /^"?\s*(cl[eé]s?|key|issue\s*key|ticket|jira|id|r[eé]f[eé]rence|r[eé]f)\s*"?$/i;
  var ENTETE_TITRE = /^"?\s*(titres?|title|summary|r[eé]sum[eé]|libell[eé]|description|nom|sujet)\s*"?$/i;

  /** Repère une ligne d'en-tête et dit quelle colonne porte quoi. */
  function lireEntete(cellules) {
    var iCle = -1, iTitre = -1;
    for (var i = 0; i < cellules.length; i++) {
      if (iCle < 0 && ENTETE_CLE.test(cellules[i])) iCle = i;
      else if (iTitre < 0 && ENTETE_TITRE.test(cellules[i])) iTitre = i;
    }
    if (iCle < 0 && iTitre < 0) return null;
    return { cle: iCle, titre: iTitre };
  }

  /** Sépare « PROJ-12 Faire le café » en clé et titre. */
  function lireLigneLibre(ligne) {
    // Puces et numérotations de liste collées devant la clé.
    var texte = ligne.replace(/^\s*(?:[-*•–—]|\d{1,3}[.)])\s+/, '').trim();
    // Le séparateur peut être n'importe quoi : deux-points, tiret, point-virgule,
    // virgule, barre verticale, ou une simple espace.
    var m = /^([A-Za-z][A-Za-z0-9_]{0,19}-\d{1,9})\s*(?:[:;,\-–—|]\s*|\s+)([\s\S]*)$/.exec(texte);
    if (m) return { key: m[1], title: m[2].trim() || m[1] };
    if (CLE.test(texte)) return { key: texte, title: texte };
    return { key: '', title: texte };
  }

  /**
   * Lit une liste de tickets collée à la main ou sortie d'un CSV.
   *
   * Accepte, dans n'importe quel mélange :
   *   PROJ-1 Écran de connexion
   *   PROJ-2 : export CSV
   *   PROJ-3;Migration de la base
   *   "Issue key","Summary"    (l'en-tête d'un export Jira, colonnes retrouvées)
   *   Juste un titre sans clé
   */
  function lireTickets(texte) {
    var lignes = String(texte || '').split(/\r\n|\r|\n/);
    var propres = [];
    for (var i = 0; i < lignes.length; i++) {
      var l = lignes[i].trim();
      if (l) propres.push(l);
    }
    if (!propres.length) return [];

    var sep = separateurDe(propres);
    var tickets = [];

    if (sep) {
      var cols = { cle: 0, titre: 1 };
      var entete = lireEntete(decouper(propres[0], sep));
      var debut = 0;
      if (entete) {
        cols = entete;
        debut = 1;
        if (cols.cle < 0) cols.cle = cols.titre === 0 ? 1 : 0;
        if (cols.titre < 0) cols.titre = cols.cle === 0 ? 1 : 0;
      }
      for (var k = debut; k < propres.length; k++) {
        var cellules = decouper(propres[k], sep);
        var cle   = (cellules[cols.cle] || '').trim();
        var titre = (cellules[cols.titre] || '').trim();
        if (!cle && !titre) continue;
        // Une seule colonne remplie : on retombe sur la lecture libre.
        if (!titre) { tickets.push(lireLigneLibre(cle)); continue; }
        if (!cle) { tickets.push({ key: '', title: titre }); continue; }
        // Colonnes inversées (« Summary, Issue key » de Jira) : la clé se
        // reconnaît à sa forme.
        if (!CLE.test(cle) && CLE.test(titre)) { var t = cle; cle = titre; titre = t; }
        tickets.push({ key: CLE.test(cle) ? cle : '', title: CLE.test(cle) ? titre : cle + ' ' + titre });
      }
    } else {
      for (var m = 0; m < propres.length; m++) tickets.push(lireLigneLibre(propres[m]));
    }

    // Nettoyage final : plus de doublon de clé, plus de ligne vide, et un
    // plafond pour ne pas noyer la session.
    var vues = {};
    var sortie = [];
    for (var n = 0; n < tickets.length && sortie.length < MAX_TICKETS; n++) {
      var ticket = tickets[n];
      var key = (ticket.key || '').slice(0, 40);
      var title = (ticket.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!key && !title) continue;
      if (key) {
        if (vues[key.toUpperCase()]) continue;
        vues[key.toUpperCase()] = true;
      }
      sortie.push({ key: key, title: title || key });
    }
    return sortie;
  }

  // ─── Barème ──────────────────────────────────────────────────────────────

  /** La carte du barème la plus proche d'une moyenne. À égalité, la plus forte. */
  function carteLaPlusProche(deck, valeur) {
    if (valeur === null || valeur === undefined || isNaN(valeur)) return null;
    var meilleure = null, ecart = Infinity;
    for (var i = 0; i < (deck || []).length; i++) {
      var carte = deck[i];
      if (carte.value === null || carte.value === undefined) continue;
      var d = Math.abs(Number(carte.value) - Number(valeur));
      if (d <= ecart) { ecart = d; meilleure = carte.id; }
    }
    return meilleure;
  }

  /** « 5 » plutôt que « 5.00 », « 5.5 » plutôt que « 5.50 ». */
  function formatMoyenne(valeur) {
    if (valeur === null || valeur === undefined || valeur === '') return '—';
    var n = Number(valeur);
    if (isNaN(n)) return '—';
    return String(Math.round(n * 100) / 100);
  }

  // ─── Chrono ──────────────────────────────────────────────────────────────

  /**
   * Secondes restantes d'un chrono, vues d'un navigateur dont l'horloge n'est
   * pas celle du serveur : `decalage` est l'écart mesuré (serveur − navigateur).
   * Renvoie null quand aucun chrono ne tourne.
   */
  function chronoRestant(round, decalage, maintenant) {
    if (!round || !round.timer_started_at || !round.timer_seconds) return null;
    var depart = Date.parse(round.timer_started_at);
    if (isNaN(depart)) return null;
    var ecoule = (maintenant + (decalage || 0) - depart) / 1000;
    var reste = Number(round.timer_seconds) - ecoule;
    return Math.max(0, Math.ceil(reste));
  }

  /** Le code de session écrit dans l'URL (#ABCD ou ?code=abcd). */
  function codeDeUrl(hash, search) {
    var h = String(hash || '').replace('#', '').toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(h)) return h;
    var m = /[?&]code=([A-Za-z0-9]{4})(?:&|$)/.exec(String(search || ''));
    return m ? m[1].toUpperCase() : null;
  }

  var PokerLib = {
    lireTickets: lireTickets,
    decouper: decouper,
    lireLigneLibre: lireLigneLibre,
    carteLaPlusProche: carteLaPlusProche,
    formatMoyenne: formatMoyenne,
    chronoRestant: chronoRestant,
    codeDeUrl: codeDeUrl,
    MAX_TICKETS: MAX_TICKETS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PokerLib;
  if (typeof window !== 'undefined') window.PokerLib = PokerLib;
})();
