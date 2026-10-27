// Un signal = une trace publique qui peut indiquer qu'une entreprise a besoin de l'offre du client.

export type SourceId = "linkedin_posts" | "linkedin_engagement" | "linkedin_plaintes" | "facebook_groupes" | "avis" | "emplois" | "actualites" | "marches" | "web" | "reddit" | "x" | "facebook_pages" | "youtube" | "hacker_news" | "stack_exchange" | "github" | "bluesky" | "app_store" | "forums";

export type TypeBrut = "post" | "reaction" | "commentaire" | "post_groupe" | "avis" | "offre_emploi" | "actualite" | "appel_offres" | "page_web";

export type Personne = { nom: string; poste: string | null; url: string | null };

export type Signal = {
  id: string; // `${source}:${identifiant externe}`, sert au dédoublonnage entre deux passages
  source: SourceId;
  plateforme: string; // LinkedIn, France Travail, Adzuna, Google News, BOAMP, Quora…
  type: TypeBrut;
  date: string | null; // ISO
  url: string | null;
  titre: string;
  texte: string;
  entreprise: string | null; // telle que la source la donne (peut être vide ou approximative)
  personne: Personne | null;
  requete: string; // mot-clé ou compte surveillé qui a fait remonter le signal
  contexte?: string; // ex. « a commenté le post de l'ARSEG : … »
  entrepriseLinkedin?: string; // lien de la page LinkedIn de l'entreprise, quand la source le donne
  fiche?: FicheEntreprise; // ajoutée avant la notation (entreprises.ts)
};

// Faits publics sur l'entreprise : registre officiel (API Recherche d'Entreprises) ou page LinkedIn.
export type FicheEntreprise = {
  source: "registre" | "linkedin";
  sur: boolean; // false = plusieurs entreprises portent ce nom : peut-être la mauvaise
  nom: string;
  siren: string | null;
  naf: string | null; // code NAF (registre)
  effectif: string | null; // tranche lisible : « 50 à 99 salariés »
  categorie: string | null; // PME / ETI / GE (registre)
  etablissements: number | null; // établissements ouverts (registre) ou adresses sur LinkedIn
  ville: string | null;
  secteur: string | null; // secteur LinkedIn
  linkedin: string | null;
};

export type Note = "A" | "B" | "X";

// Catalogue commun à toutes les campagnes. Chaque type a un délai pour agir (DELAIS) : passé ce délai,
// le signal n'est plus « chaud » (il descend dans le rapport).
export type TypeSignal =
  | "demande_recommandation" // « vous connaissez quelqu'un pour… »
  | "recherche_prestataire" // cherche activement un prestataire, un outil, évalue des offres
  | "insatisfaction_prestataire" // se plaint de son prestataire / outil actuel, veut changer
  | "douleur_exprimee" // décrit le problème que l'offre règle, sans rien demander
  | "recrutement" // recrute un rôle que l'offre remplace ou outille
  | "nouveau_decideur" // nouveau dirigeant ou responsable du budget concerné
  | "croissance" // levée de fonds, ouverture de sites, lancement, nouveau marché, rachat
  | "appel_offres"
  | "engagement_categorie" // réagit régulièrement au sujet ou aux concurrents
  | "autre"
  // anciens types, encore lus dans les anciens rapports
  | "recrutement_maintenance"
  | "ouverture_sites"
  | "decideur_actif";

export const TYPES_SIGNAL = [
  "demande_recommandation",
  "recherche_prestataire",
  "insatisfaction_prestataire",
  "douleur_exprimee",
  "recrutement",
  "nouveau_decideur",
  "croissance",
  "appel_offres",
  "engagement_categorie",
  "autre",
] as const;

// Heures pendant lesquelles un signal reste chaud, à partir de sa date.
export const DELAIS: Record<TypeSignal, number> = {
  demande_recommandation: 48,
  recherche_prestataire: 72,
  insatisfaction_prestataire: 72,
  douleur_exprimee: 120,
  recrutement: 14 * 24,
  nouveau_decideur: 45 * 24,
  croissance: 14 * 24,
  appel_offres: 14 * 24,
  engagement_categorie: 30 * 24,
  autre: 14 * 24,
  recrutement_maintenance: 14 * 24,
  ouverture_sites: 14 * 24,
  decideur_actif: 30 * 24,
};

export type Notation = {
  note: Note;
  score: number; // 0-100, pour trier dans une même note
  entreprise_cible: string; // l'entreprise à démarcher (vide si aucune)
  secteur: string;
  sites_estimes: string; // taille connue : « ~80 magasins en France », « 15 salariés », « inconnu »
  type_signal: TypeSignal;
  urgence?: string; // mots du texte qui disent le délai (« ce trimestre », « urgent »), sinon vide
  pourquoi: string;
  qui_contacter: string;
  accroche?: string; // 1re phrase du message, qui cite ce qui s'est passé (absente des anciens signaux)
  message: string;
  commentaire_public?: string; // réponse utile, sans pitch, à poster sous le post (vide si non adapté)
};

export type SignalNote = Signal & { notation: Notation; note_le: string };

export type Campagne = {
  id: string;
  nom: string;
  budget: { usdParJour: number; usdParMois: number }; // plafonds de dépense (Apify, Serper, OpenAI)
  rythmes?: Partial<Record<SourceId, number>>; // heures minimum entre deux lectures d'une source (sinon RYTHMES)
  sources?: SourceId[]; // sources utiles pour ce client (sinon toutes celles qui sont configurées)
  comptesCibles?: string[]; // entreprises que le client vise en priorité : leurs signaux passent en tête
  vendeur: string; // qui vend quoi, à qui : lu par l'IA
  icp: string; // l'entreprise cible idéale, critères A / B / X : lu par l'IA
  decideurs: string[]; // intitulés de poste à contacter
  exclure: RegExp; // entreprises jamais cibles (concurrents, intérim, cabinets) : filtre avant l'IA
  linkedin: {
    requetes: { q: string; auteur?: string }[]; // auteur = mots-clés dans le titre du profil de l'auteur
    postsParRequete: number;
    comptesSurveilles: { nom: string; url: string }[]; // on regarde qui réagit à leurs posts
    postsParCompte: number;
    reactionsParPost: number; // 0 = pas de réactions (les commentaires suffisent, beaucoup moins cher)
    commentairesParPost: number;
    titresEngagement: RegExp; // garde seulement les personnes dont le titre correspond
    plaintes: {
      requetes: string[]; // posts dont on lit les commentaires (sujets où un client parle de son prestataire)
      postsParRequete: number; // posts de la semaine, par requête
      postsCommentes: number; // seuls les N posts les plus commentés sont ouverts (les commentaires coûtent)
      commentairesParPost: number;
      texte: RegExp; // le commentaire doit exprimer un problème ou une recherche
    };
  };
  facebook: {
    groupes: { nom: string; url: string }[]; // groupes PUBLICS uniquement (npm run groupes pour en découvrir)
    postsParGroupe: number;
    filtre: RegExp; // garde les posts qui parlent du besoin (le reste n'est pas envoyé à l'IA)
    decouverte: string[]; // recherches Google pour trouver de nouveaux groupes
  };
  avis: {
    enseignes: string[]; // réseaux dont on lit les avis Google Maps récents
    enseignesDepuisHistorique: number; // + les N meilleures entreprises A/B déjà trouvées
    lieuxParEnseigne: number;
    avisParLieu: number;
    probleme: RegExp; // un avis qui correspond = un problème que l'offre du vendeur règle
    minAvisProblemes: number; // nombre d'avis concernés pour faire un signal
  };
  // apifyLinkedIn : offres LinkedIn Jobs via Apify (valig/linkedin-jobs-scraper, 0,0004 $ l'offre) en plus de France Travail et Adzuna.
  emplois: { motsCles: string[]; apifyLinkedIn: boolean; linkedinParMotCle?: number };
  fichesLinkedinMax?: number; // fiches LinkedIn payantes par passage (0,004 $ l'une) pour les entreprises absentes du registre ; défaut 20
  actualites: { requetes: string[] };
  marches: { requetes: string[] };
  web: { requetes: string[] };
  // Plateformes sociales lues directement (src/sources/social.ts). Optionnelles : à configurer seulement quand les acheteurs
  // du client y parlent (logiciel, SaaS, clients anglophones), pas pour un métier de terrain en France. `filtre` = le texte
  // doit exprimer une recherche ou un problème, sinon il n'est pas envoyé à l'IA (ces recherches ramènent beaucoup de bruit).
  reddit?: { requetes: string[]; postsParRequete: number; filtre: RegExp }; // 0,004 $ le post + 0,02 $ par passage
  x?: { requetes: string[]; tweetsParRequete: number; langue?: string; filtre: RegExp }; // 0,00025 $ le tweet
  facebookPages?: {
    pages: { nom: string; url: string }[]; // pages PUBLIQUES (souvent des concurrents)
    postsParPage: number; // 0,005 $ le post
    postsCommentes: number; // seuls les N posts les plus commentés sont ouverts
    commentairesParPost: number; // 0,0025 $ le commentaire
    filtre: RegExp;
  };
  // YouTube Data API v3 (gratuite, quota de 10 000 unités par jour et par clé) : commentaires récents sous des vidéos du sujet.
  // Une recherche coûte 100 unités, une page de commentaires 1 unité. Les vidéos anciennes et populaires (« meilleur CRM »,
  // « avis <concurrent> ») reçoivent encore des questions : on ne garde que les commentaires écrits depuis le dernier passage.
  youtube?: {
    requetes: string[]; // recherches de vidéos (« avis Pipedrive », « meilleur logiciel de devis »)
    videosParRequete: number; // vidéos les plus pertinentes par recherche (max 50)
    videos?: { nom: string; id: string }[]; // vidéos suivies en plus (concurrents, tutos), 1 unité chacune
    commentairesParVideo: number; // commentaires les plus récents lus par vidéo (max 100 = 1 unité)
    langue?: string; // relevanceLanguage, ex. "fr"
    region?: string; // regionCode, ex. "FR"
    filtre: RegExp;
  };
  // Communautés publiques (src/sources/communautes.ts), gratuites sauf l'App Store. Surtout anglophones et techniques :
  // pour un logiciel, une appli ou un client qui vend en anglais.
  hackerNews?: { requetes: string[]; parRequete: number; filtre: RegExp }; // gratuit
  stackExchange?: { requetes: string[]; sites: string[]; parRequete: number; filtre: RegExp }; // gratuit ; sites : softwarerecs, webapps, superuser…
  github?: { requetes: string[]; parRequete: number; filtre: RegExp }; // gratuit ; syntaxe GitHub (repo:x/y is:issue)
  bluesky?: { requetes: string[]; parRequete: number; langue?: string; filtre: RegExp }; // gratuit
  appStore?: { apps: { nom: string; id: string }[]; pays: string; avisParApp: number; noteMax: number }; // 0,0001 $ l'avis
  // Forums Discourse publics (src/sources/forums.ts), gratuits : tous les nouveaux messages depuis le dernier passage.
  // Un forum = une ligne (ex. { nom: "Growthhacking.fr", url: "https://www.growthhacking.fr" }).
  forums?: { sites: { nom: string; url: string }[]; filtre: RegExp };
};

// depuis = date du dernier passage réussi de la source ; jours = cette fenêtre arrondie au jour supérieur.
export type OptionsScan = { depuis: Date; jours: number; test: boolean };

// Heures minimum entre deux lectures d'une source. Relire plus souvent ne trouve presque rien de plus
// mais peut repayer les mêmes résultats (fenêtres de 24 h côté LinkedIn, Google, Facebook).
export const RYTHMES: Record<SourceId, number> = {
  linkedin_posts: 6,
  linkedin_plaintes: 24,
  linkedin_engagement: 24,
  emplois: 24,
  actualites: 6,
  marches: 24,
  web: 24,
  facebook_groupes: 168,
  avis: 720,
  reddit: 24,
  x: 24,
  facebook_pages: 168,
  youtube: 24,
  hacker_news: 24,
  stack_exchange: 24,
  github: 24,
  bluesky: 24,
  app_store: 168,
  forums: 24,
};

export type Source = {
  id: SourceId;
  nom: string;
  collecter: (c: Campagne, o: OptionsScan) => Promise<Signal[]>;
};
