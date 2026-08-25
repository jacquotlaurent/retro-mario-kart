/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION
   ───────────────────────────────────────────────────────────────────────────
   Quand la page est servie par l'Edge Function Supabase, l'URL du projet et la
   clé anon sont injectées automatiquement (window.RETRO_ENV) : tu n'as RIEN à
   remplir ici. Les valeurs ci-dessous ne servent qu'en test local.

   ⚠️ Le barème des cartes n'est PAS ici : il vit dans la base (table
   retro_card, voir supabase/setup.sql) pour que personne ne puisse le trafiquer
   depuis la console du navigateur. Pour changer une valeur :
       update public.retro_card set delta = 4 where id = 'etoile';
   ═══════════════════════════════════════════════════════════════════════════ */

window.RETRO_CONFIG = {
  // Repli pour un test en local (npm start). Laisse vide en production.
  SUPABASE_URL: 'https://hgpenvitqfpeeqvdpupy.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhncGVudml0cWZwZWVxdmRwdXB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NTQ5MzQsImV4cCI6MjEwMzIzMDkzNH0.DygphAcK1BTSxsvmuKB9KYQ7p7EMteryv5CouZH66tc',

  // Fréquence de rafraîchissement des écrans, en millisecondes.
  // 800 ms = imperceptible pour l'œil, très loin des quotas Supabase.
  POLL_MS: 800,

  // Effets sur l'écran animateur
  SOUND: true,
  CONFETTI: true,
};

/* Le paquet de cartes utilisé UNIQUEMENT en mode démo hors-ligne (?demo=1),
   quand il n'y a pas de base pour le fournir. Doit rester aligné avec le bloc
   `insert into public.retro_card` de supabase/setup.sql. */
window.RETRO_DEMO_DECK = [
  { id: 'champignon',    label: 'Champignon',     emoji: '🍄',     delta:  1, hint: 'Un petit truc qui nous a fait avancer',            ordinal: 1 },
  { id: 'champignon_x3', label: 'Champignon ×3',  emoji: '🍄🍄🍄', delta:  2, hint: "Une vraie accélération pour l'équipe",             ordinal: 2 },
  { id: 'etoile',        label: 'Étoile',         emoji: '⭐',     delta:  3, hint: 'Le moment invincible du sprint, notre grande réussite', ordinal: 3 },
  { id: 'banane',        label: 'Peau de banane', emoji: '🍌',     delta: -1, hint: 'Un petit dérapage, vite rattrapé',                 ordinal: 4 },
  { id: 'carapace',      label: 'Carapace verte', emoji: '🐢',     delta: -2, hint: "On s'est pris un coup : on a perdu du temps",      ordinal: 5 },
  { id: 'bob_omb',       label: 'Bob-omb',        emoji: '💣',     delta: -3, hint: "Gros problème, ça a explosé en vol",               ordinal: 6 },
];
