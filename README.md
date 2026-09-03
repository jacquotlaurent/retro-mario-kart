# Pages hébergées

Deux outils d'équipe servis par GitHub Pages, sans compte ni installation :

- **[🏁 Rétro Mario Kart](#-rétro-mario-kart)** — la rétrospective de sprint
- **[🃏 Planning Poker](poker/)** — l'estimation de tickets *(`/poker/`)*

---

## 🏁 Rétro Mario Kart

Le front-end de la rétrospective de sprint sur le thème Mario Kart : un circuit
projeté au mur, que chaque participant fait avancer depuis son smartphone en
jouant une carte pendant son tour de parole.

Est nécessaire à son utilisation : un téléphone par participant. Pas de création de compte. Faire reset après export pour éviter d'encombrer la base (dette technique assumée sur ce point : pas de vrai retrait des tickets à la fermeture de la session).

- `index.html` — l'écran de course, à projeter
- `play.html` — la manette des participants
- `config.js` — l'adresse du projet Supabase et sa clé publique

Ce dépôt ne sert qu'à héberger les fichiers sur GitHub Pages : Supabase
neutralise le HTML servi depuis `*.supabase.co`, une page ne peut donc pas y
être rendue. La base de données, elle, reste sur Supabase.

La clé présente dans `config.js` est une clé **publique** : elle est faite pour
vivre dans le JavaScript du navigateur. Ce qui protège les données, c'est la
RLS activée sans aucune policy côté base, où seules six fonctions
`security definer` sont exposées.

Le code source complet, le schéma SQL et la documentation d'animation vivent
dans le dépôt principal.

---

## 🃏 Planning Poker

Estimer des tickets à plusieurs, sans se laisser influencer : un prénom, un
rôle, un code de session. Les votes restent cachés **côté serveur** jusqu'à ce
que tout le monde ait voté, et la synchronisation passe par Supabase Realtime.

Tout vit dans [`poker/`](poker/) — application, feuille de style, schéma SQL et
tests. Voir [`poker/README.md`](poker/README.md) pour les règles, l'architecture
et le modèle de sécurité. Le projet Supabase est distinct de celui de la rétro.
