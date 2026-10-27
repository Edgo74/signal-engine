import type { Source } from "../types.js";
import { actualites } from "./actualites.js";
import { avis } from "./avis.js";
import { appStore, bluesky, github, hackerNews, stackExchange } from "./communautes.js";
import { forums } from "./forums.js";
import { emplois } from "./emplois.js";
import { facebookGroupes } from "./facebook.js";
import { linkedinEngagement, linkedinPlaintes, linkedinPosts } from "./linkedin.js";
import { marches } from "./marches.js";
import { facebookPages, reddit, x } from "./social.js";
import { web } from "./web.js";
import { youtube } from "./youtube.js";

// Ajouter une source = écrire un connecteur qui renvoie des Signal[] et le déclarer ici.
// `avis` passe en dernier dans la liste mais tourne en parallèle : il lit l'historique des passages précédents.
export const sources: Source[] = [linkedinPosts, linkedinEngagement, linkedinPlaintes, facebookGroupes, emplois, actualites, marches, web, reddit, x, facebookPages, youtube, hackerNews, stackExchange, github, bluesky, appStore, forums, avis];
