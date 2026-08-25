# 🏁 Rétro Mario Kart — pages hébergées

Le front-end de la rétrospective de sprint sur le thème Mario Kart : un circuit
projeté au mur, que chaque participant fait avancer depuis son smartphone en
jouant une carte pendant son tour de parole.

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
