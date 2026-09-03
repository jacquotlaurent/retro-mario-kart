# 🃏 Planning Poker

Estimer des tickets à plusieurs, sans se laisser influencer. Pas de compte, pas
de mot de passe : un prénom, un rôle, un code de session à quatre caractères.

Servi par GitHub Pages avec le reste du dépôt :
**`https://<compte>.github.io/retro-mario-kart/poker/`**

## Comment ça se joue

1. **Le facilitateur** ouvre la page, saisit son prénom et crée une session.
   Il obtient un code (`LU8A`) et un lien à partager — avec QR code, pour les
   téléphones.
2. **Chacun** ouvre le lien, saisit son prénom et son rôle :
   *Participant* (je vote) ou *Spectateur* (je regarde).
3. Le facilitateur **colle la liste des tickets**, ou choisit un CSV.
4. Tout le monde **choisit une carte** : `1 · 2 · 3 · 5 · 8 · 13 · 21 · 34 · 55 · ?`
   Chacun ne voit que sa propre carte, et le fait que les autres ont voté.
5. Dès que **tous les participants présents** ont voté, les cartes se retournent :
   chaque vote apparaît, la moyenne s'affiche au centre. Le `?` reste hors
   moyenne. Si tous les votes chiffrés sont identiques : 🎉 **Consensus !**
6. Le facilitateur peut **relancer un tour** sur le même ticket (les votes
   repartent de zéro), **valider le chiffrage**, puis **passer au suivant**.

Deux détails qui comptent en réunion :

- **Les spectateurs ne bloquent pas la révélation** ; ils ne votent pas.
- **Le chrono de 15 s est facultatif**, visible de tous, et ne révèle rien tout
  seul quand il arrive à zéro. C'est un signal, pas un couperet.

## Le vote est réellement secret

Ce n'est pas un vote « envoyé puis masqué à l'écran ». Le navigateur n'a le
droit de lire **aucune table** :

- RLS activée sur toutes les tables, et **aucune policy** : rien ne sort par
  l'API REST ni par Realtime « postgres_changes » ;
- le front n'appelle que **douze fonctions `security definer`** (les seules à
  porter un `grant execute to anon`) ;
- `poker_state` ne renvoie, avant révélation, que `has_voted` — plus la carte de
  l'appelant, pour qu'il voie son propre choix. Aucune autre valeur ne traverse
  le réseau.

Le barème lui-même vit dans la base (`poker_card`) : impossible de jouer une
carte inventée depuis la console du navigateur.

## Le temps réel

Deux temps, pour ne pas trahir le secret :

1. à chaque changement, la base pousse une notification Realtime `maj` sur le
   canal `poker:<CODE>` — elle ne contient qu'un **numéro de révision** ;
2. chaque écran rappelle alors `poker_state`, qui décide de ce qu'il a le droit
   de voir.

Derrière, un sondage lent (5 s) rattrape une notification perdue et sert de
« je suis toujours là » : au-delà de **35 s de silence**, on n'est plus compté
parmi les votants attendus — un onglet fermé ne bloque donc pas la révélation.
Si le websocket tombe, le sondage se resserre à 1,2 s et l'expérience continue.

## Les fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | l'application entière : entrée, vote, résultats |
| `styles.css` | la feuille de style (clair et sombre, du téléphone au vidéoprojecteur) |
| `lib.js` | les fonctions pures : lecture des tickets, arrondi au barème, chrono |
| `api.js` | les appels RPC, l'écoute Realtime, le sondage de repli |
| `app.js` | l'écran : dessin de l'état, actions du facilitateur |
| `config.js` | l'adresse du projet Supabase et sa clé publique |
| `supabase/setup.sql` | le schéma et les douze fonctions — la source de vérité des règles |
| `tests/lib.test.js` | les tests des fonctions pures |
| `vendor/supabase.min.js` | `@supabase/supabase-js` 2.114.0, uniquement pour le websocket Realtime |

Le QR code réutilise `../vendor/qrcode.min.js` et `../qr.js` de la rétro.

## Configuration

`config.js` porte l'URL du projet et la clé **publishable** : elle est faite
pour vivre dans le JavaScript du navigateur. Aucune variable d'environnement,
aucun secret, aucune étape de build — les fichiers sont servis tels quels.

Pour pointer vers un autre projet Supabase, il suffit d'y appliquer
`supabase/setup.sql` et de remplacer les deux valeurs.

## Tests

```sh
node --test poker/tests/*.test.js   # les fonctions pures, sans réseau ni navigateur
```

Les règles du jeu, elles, vivent dans PostgreSQL : `supabase/setup.sql` est
idempotent, on peut le rejouer sur un projet neuf pour retrouver exactement le
même comportement.
