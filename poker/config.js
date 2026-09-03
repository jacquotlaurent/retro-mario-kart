/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION — Planning Poker
   ───────────────────────────────────────────────────────────────────────────
   La clé ci-dessous est une clé **publique** (publishable) : elle est faite
   pour vivre dans le JavaScript du navigateur. Ce qui protège les données,
   c'est la RLS activée sans aucune policy côté base, où seules les douze
   fonctions `security definer` de supabase/setup.sql sont exposées.

   ⚠️ Le barème des cartes n'est PAS ici : il vit dans la base (table
   poker_card) pour que personne ne puisse jouer une carte inventée depuis la
   console du navigateur.
   ═══════════════════════════════════════════════════════════════════════════ */

window.POKER_CONFIG = {
  SUPABASE_URL: 'https://vknfaclnrluhatdkpgfp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_d2k1q9AIc4-i7244DJcgjQ_wwRsVZOH',

  // Filet de sécurité derrière Supabase Realtime. Le temps réel passe par une
  // notification poussée par la base ; ce sondage ne sert qu'à rattraper une
  // notification perdue — et à dire « je suis toujours là » (au-delà de 35 s
  // de silence, on n'est plus compté parmi les votants attendus).
  POLL_MS: 5000,
  // Quand le websocket est tombé, on resserre le sondage.
  POLL_MS_HORS_LIGNE: 1200,

  // Durée par défaut du chrono, en secondes.
  CHRONO_S: 15,
};
