# signal-engine

Trouve des **signaux d'achat publics** pour un vendeur B2B : quelqu'un qui demande un prestataire sur LinkedIn, une entreprise qui recrute un poste que l'offre remplace, une plainte contre un concurrent, une question sur un forum, un appel d'offres public, une actualité.

Chaque signal est noté par l'IA selon le client idéal de la campagne, puis regroupé par entreprise dans un rapport.

Collecte → dédoublonnage → filtre rapide (sans IA) → notation IA (A / B / X, qui contacter, message proposé) → regroupement par entreprise → rapport HTML + CSV et fiches d'appel.

**L'outil n'envoie rien.** Pas de message ni de commentaire automatique : c'est le commercial qui relit et qui contacte.

Stack : TypeScript (Node, tsx), OpenAI (gpt-5.4-mini), Apify, Serper.

## Sources (19)

| Id | Ce qu'elle lit | Comment |
|---|---|---|
| `linkedin_posts` | Posts LinkedIn par mots-clés, filtrables par titre de l'auteur | Apify (sans compte LinkedIn) |
| `linkedin_engagement` | Qui commente les posts de comptes surveillés | Apify |
| `linkedin_plaintes` | Commentaires de décideurs qui se plaignent de leur prestataire ou en cherchent un | Apify |
| `facebook_groupes` | Posts des groupes Facebook **publics** listés dans la campagne | Apify |
| `facebook_pages` | Commentaires sous les posts de pages Facebook publiques | Apify |
| `avis` | Avis Google Maps récents d'un réseau de sites, quand plusieurs parlent du même problème | Apify (sans nom d'auteur) |
| `app_store` | Avis App Store | Apify |
| `emplois` | Offres d'emploi | API France Travail, Adzuna, LinkedIn Jobs (Apify, en option) |
| `actualites` | Presse : ouvertures, levées de fonds, nominations | Flux RSS Google News |
| `marches` | Appels d'offres publics | Open data BOAMP |
| `web` | Quora, Trustpilot, forums, pages indexées | Google via l'API Serper |
| `reddit` | Posts Reddit | Apify |
| `x` | Posts X | Apify |
| `youtube` | Commentaires de vidéos | YouTube Data API |
| `hacker_news` | Posts et commentaires | API Algolia (sans clé) |
| `stack_exchange` | Questions (ex. Software Recommendations) | API Stack Exchange |
| `github` | Issues | API GitHub |
| `bluesky` | Posts | API Bluesky |
| `forums` | Forums Discourse lus en entier (ex. growthhacking.fr) | API Discourse (sans clé) |

Aucun compte personnel ni cookie n'est utilisé pour lire. Seules des données publiques sont collectées.

## Lancer

```bash
cp .env.example .env.local     # puis remplir les clés soi-même
npm install
npm run scan -- --test                      # petit échantillon de chaque source
npm run scan -- --campagne agence           # passage normal : seulement ce qui est nouveau
npm run scan -- --sources emplois,marches   # seulement certaines sources
npm run scan -- --jours 7 --forcer          # impose une fenêtre de 7 jours
npm run rapport -- agence 30                # refait le rapport des 30 derniers jours
npm run groupes -- agence                   # propose des groupes Facebook publics à ajouter
npm run fiches -- agence 30 10              # fiches d'appel par entreprise, triées par chance (+ top 10)
```

Le rapport est écrit dans `out/`. Les fiches ajoutent un 2e passage IA, sur les entreprises A et B seulement : ce qui s'est passé, pourquoi maintenant, qui appeler, phrase d'ouverture, chance (haute / moyenne / faible). La note A/B juge un signal ; la chance juge l'entreprise pour le commercial.

## Coût

Chaque appel payant (Apify, Serper, OpenAI) est compté dans `data/<campagne>/couts.jsonl`, et le total s'affiche en fin de passage.

- **Plafonds** : `budget: { usdParJour, usdParMois }` dans la campagne. Avant chaque appel, son coût estimé est réservé ; s'il dépasse ce qui reste, l'appel n'a pas lieu.
- **Seulement le nouveau** : chaque source repart de son dernier passage réussi ; 7 jours au premier passage.
- **Rythme par source** (`RYTHMES` dans `src/types.ts`, réglable par campagne) : par exemple les posts LinkedIn toutes les 6 h, les appels d'offres chaque jour, les avis Google Maps chaque mois. Lancer le scan plus souvent ne relit que les sources dues.
- **Filtre avant l'IA** : ce qui ne peut jamais être une cible (concurrents, cabinets de recrutement…) est écarté par une règle de texte, sans payer d'appel IA.
- **Signaux non notés** (limite `--max`, erreur IA) : gardés pour le passage suivant.

## Ce que les tests ont montré

- Pour un métier de terrain en France, les **offres d'emploi** sont le signal qui marche le mieux.
- Sur LinkedIn, pour un logiciel de niche, ce sont surtout les **vendeurs** qui parlent du sujet, pas les acheteurs.
- YouTube et les communautés anglophones (Stack Exchange, Bluesky…) ne donnent presque rien en B2B français. Elles restent disponibles, mais chaque campagne choisit ses sources.

## Ajouter une campagne

Copier `src/campagnes/agence.ts` : décrire le vendeur, le client idéal (critères A / B / X), les mots-clés par source, le budget. Puis la déclarer dans `src/campagnes/index.ts`.
