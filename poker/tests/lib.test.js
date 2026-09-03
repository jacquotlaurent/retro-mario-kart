/* Tests des fonctions pures du Planning Poker.  Lancement : npm test
   (ou directement : node --test poker/tests/) */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const lib = require('../lib.js');

// ─── Lecture de tickets ────────────────────────────────────────────────────

test('liste collée à la main : clé puis titre', () => {
  assert.deepStrictEqual(lib.lireTickets(
    'PROJ-1 Écran de connexion\nPROJ-2 : export CSV\nPROJ-3 - Migration base'), [
    { key: 'PROJ-1', title: 'Écran de connexion' },
    { key: 'PROJ-2', title: 'export CSV' },
    { key: 'PROJ-3', title: 'Migration base' },
  ]);
});

test('puces et numérotations de liste ignorées', () => {
  assert.deepStrictEqual(lib.lireTickets('- PROJ-1 Un\n* PROJ-2 Deux\n3. PROJ-3 Trois'), [
    { key: 'PROJ-1', title: 'Un' },
    { key: 'PROJ-2', title: 'Deux' },
    { key: 'PROJ-3', title: 'Trois' },
  ]);
});

test('lignes vides et espaces superflus tombent', () => {
  assert.deepStrictEqual(lib.lireTickets('\n\n  PROJ-1   Un    titre  \n   \n'), [
    { key: 'PROJ-1', title: 'Un titre' },
  ]);
});

test('clé seule : le titre reprend la clé', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-42'), [{ key: 'PROJ-42', title: 'PROJ-42' }]);
});

test('titre sans clé : accepté sans clé', () => {
  assert.deepStrictEqual(lib.lireTickets('Refaire la page de connexion'), [
    { key: '', title: 'Refaire la page de connexion' },
  ]);
});

test('CSV point-virgule', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1;Écran de connexion\nPROJ-2;Export CSV'), [
    { key: 'PROJ-1', title: 'Écran de connexion' },
    { key: 'PROJ-2', title: 'Export CSV' },
  ]);
});

test('CSV virgule avec en-tête', () => {
  assert.deepStrictEqual(lib.lireTickets('clé,titre\nPROJ-1,Un\nPROJ-2,Deux'), [
    { key: 'PROJ-1', title: 'Un' },
    { key: 'PROJ-2', title: 'Deux' },
  ]);
});

test('en-tête Jira, colonnes dans l\'autre sens', () => {
  assert.deepStrictEqual(lib.lireTickets('Summary,Issue key\nUn écran,PROJ-1\nUn autre,PROJ-2'), [
    { key: 'PROJ-1', title: 'Un écran' },
    { key: 'PROJ-2', title: 'Un autre' },
  ]);
});

test('CSV sans en-tête, colonnes dans l\'autre sens : la clé se reconnaît', () => {
  assert.deepStrictEqual(lib.lireTickets('Un écran,PROJ-1\nUn autre,PROJ-2'), [
    { key: 'PROJ-1', title: 'Un écran' },
    { key: 'PROJ-2', title: 'Un autre' },
  ]);
});

test('guillemets : une virgule dans le titre ne coupe pas la cellule', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1,"Export CSV, avec en-tête"'), [
    { key: 'PROJ-1', title: 'Export CSV, avec en-tête' },
  ]);
});

test('guillemets doublés', () => {
  assert.deepStrictEqual(lib.decouper('a,"il dit ""oui""",b', ','), ['a', 'il dit "oui"', 'b']);
});

test('CSV à trois colonnes : les suivantes sont ignorées', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1,Un titre,En cours,Alice'), [
    { key: 'PROJ-1', title: 'Un titre' },
  ]);
});

test('CSV tabulé (copié depuis un tableur)', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1\tUn\nPROJ-2\tDeux'), [
    { key: 'PROJ-1', title: 'Un' },
    { key: 'PROJ-2', title: 'Deux' },
  ]);
});

test('doublons de clé écartés', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1 Un\nproj-1 Le même\nPROJ-2 Deux'), [
    { key: 'PROJ-1', title: 'Un' },
    { key: 'PROJ-2', title: 'Deux' },
  ]);
});

test('titres sans clé : pas de dédoublonnage abusif', () => {
  assert.strictEqual(lib.lireTickets('Un truc\nUn autre truc\nUn truc').length, 3);
});

test('plafond à 300 tickets', () => {
  const texte = Array.from({ length: 400 }, (_, i) => `PROJ-${i + 1} Titre ${i + 1}`).join('\n');
  assert.strictEqual(lib.lireTickets(texte).length, lib.MAX_TICKETS);
});

test('titre tronqué à 300 caractères, clé à 40', () => {
  const t = lib.lireTickets('PROJ-1 ' + 'a'.repeat(500))[0];
  assert.strictEqual(t.title.length, 300);
  assert.ok(lib.lireTickets('X'.repeat(60) + '-1 titre')[0].key.length <= 40);
});

test('texte vide ou nul', () => {
  assert.deepStrictEqual(lib.lireTickets(''), []);
  assert.deepStrictEqual(lib.lireTickets(null), []);
  assert.deepStrictEqual(lib.lireTickets('   \n  \n'), []);
});

test('mélange de formats dans le même collage', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1 Un\nJuste un titre\nPROJ-3: Trois'), [
    { key: 'PROJ-1', title: 'Un' },
    { key: '', title: 'Juste un titre' },
    { key: 'PROJ-3', title: 'Trois' },
  ]);
});

// ─── Barème ────────────────────────────────────────────────────────────────

const DECK = ['1', '2', '3', '5', '8', '13', '21', '34', '55'].map((id) => ({ id, value: Number(id) }))
  .concat([{ id: '?', value: null }]);

test('la carte la plus proche de la moyenne', () => {
  assert.strictEqual(lib.carteLaPlusProche(DECK, 5), '5');
  assert.strictEqual(lib.carteLaPlusProche(DECK, 5.5), '5');
  assert.strictEqual(lib.carteLaPlusProche(DECK, 6), '5');
  assert.strictEqual(lib.carteLaPlusProche(DECK, 7), '8');
  assert.strictEqual(lib.carteLaPlusProche(DECK, 100), '55');
  assert.strictEqual(lib.carteLaPlusProche(DECK, 0), '1');
});

test('à égalité, on prend la carte la plus forte', () => {
  assert.strictEqual(lib.carteLaPlusProche(DECK, 1.5), '2');
  assert.strictEqual(lib.carteLaPlusProche(DECK, 2.5), '3');
});

test('le « ? » n\'est jamais proposé comme chiffrage', () => {
  assert.notStrictEqual(lib.carteLaPlusProche(DECK, 5), '?');
  assert.strictEqual(lib.carteLaPlusProche(DECK, null), null);
  assert.strictEqual(lib.carteLaPlusProche([], 5), null);
});

test('affichage de la moyenne', () => {
  assert.strictEqual(lib.formatMoyenne('5.00'), '5');
  assert.strictEqual(lib.formatMoyenne('5.50'), '5.5');
  assert.strictEqual(lib.formatMoyenne('7.33'), '7.33');
  assert.strictEqual(lib.formatMoyenne(null), '—');
  assert.strictEqual(lib.formatMoyenne(''), '—');
});

// ─── Chrono ────────────────────────────────────────────────────────────────

test('chrono : décompte aligné sur l\'horloge du serveur', () => {
  const round = { timer_started_at: '2026-01-01T12:00:00.000Z', timer_seconds: 15 };
  const t0 = Date.parse('2026-01-01T12:00:00.000Z');
  assert.strictEqual(lib.chronoRestant(round, 0, t0), 15);
  assert.strictEqual(lib.chronoRestant(round, 0, t0 + 5000), 10);
  assert.strictEqual(lib.chronoRestant(round, 0, t0 + 15000), 0);
  assert.strictEqual(lib.chronoRestant(round, 0, t0 + 60000), 0);
});

test('chrono : un navigateur en retard de 30 s voit la même chose', () => {
  const round = { timer_started_at: '2026-01-01T12:00:00.000Z', timer_seconds: 15 };
  const t0 = Date.parse('2026-01-01T12:00:00.000Z');
  // Horloge locale 30 s en retard, donc décalage serveur − local = +30 s.
  assert.strictEqual(lib.chronoRestant(round, 30000, t0 - 30000 + 5000), 10);
});

test('chrono absent ou annulé', () => {
  assert.strictEqual(lib.chronoRestant(null, 0, Date.now()), null);
  assert.strictEqual(lib.chronoRestant({ timer_started_at: null, timer_seconds: 15 }, 0, Date.now()), null);
  assert.strictEqual(lib.chronoRestant({ timer_started_at: 'pas une date', timer_seconds: 15 }, 0, Date.now()), null);
});

// ─── Code de session dans l'URL ────────────────────────────────────────────

test('code lu dans le hash ou la query', () => {
  assert.strictEqual(lib.codeDeUrl('#ab3d', ''), 'AB3D');
  assert.strictEqual(lib.codeDeUrl('', '?code=xk7p'), 'XK7P');
  assert.strictEqual(lib.codeDeUrl('', '?demo=1&code=XK7P'), 'XK7P');
  assert.strictEqual(lib.codeDeUrl('#toolong', ''), null);
  assert.strictEqual(lib.codeDeUrl('', ''), null);
  assert.strictEqual(lib.codeDeUrl(null, null), null);
});

// ─── Collages mélangés (le cas qui a mordu) ────────────────────────────────

test('une ligne à point-virgule au milieu d\'un collage libre', () => {
  assert.deepStrictEqual(lib.lireTickets(
    'PROJ-101 Écran de connexion\nPROJ-102;Export CSV, avec en-tête\nPROJ-103 : Migration'), [
    { key: 'PROJ-101', title: 'Écran de connexion' },
    { key: 'PROJ-102', title: 'Export CSV, avec en-tête' },
    { key: 'PROJ-103', title: 'Migration' },
  ]);
});

test('une ligne à virgule au milieu d\'un collage libre', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1 Un\nPROJ-2,Deux et demi\nUn titre libre'), [
    { key: 'PROJ-1', title: 'Un' },
    { key: 'PROJ-2', title: 'Deux et demi' },
    { key: '', title: 'Un titre libre' },
  ]);
});

test('barre verticale (collage depuis un tableau Markdown)', () => {
  assert.deepStrictEqual(lib.lireTickets('PROJ-1 | Un titre'), [{ key: 'PROJ-1', title: 'Un titre' }]);
});
