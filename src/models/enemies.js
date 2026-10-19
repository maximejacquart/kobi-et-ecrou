// Modèles des ennemis : corps sculptés d'un seul tenant (SDF + peau sur squelette) et accessoires rigides
// (yeux, blindages, canons), un fichier par famille dans enemies/. Les articulations gardent les noms attendus
// par les comportements (enemies.js du jeu).
import { grignoteur } from './enemies/grignoteur.js';
import { larbin, larbinBouclier } from './enemies/larbin.js';
import { bourdon } from './enemies/bourdon.js';
import { boumboule } from './enemies/boumboule.js';
import { pinceur } from './enemies/pinceur.js';
import { tourelleV } from './enemies/tourelle.js';
import { grosbras } from './enemies/grosbras.js';
import { canard } from './enemies/canard.js';
import { goinfrotron } from './enemies/goinfrotron.js';
import { lunette } from './enemies/lunette.js';
import { fouisseur } from './enemies/fouisseur.js';
import { moustique } from './enemies/moustique.js';
import { phaseur } from './enemies/phaseur.js';
import { pingouin } from './enemies/pingouin.js';
import { champi } from './enemies/champi.js';
import { mammouth } from './enemies/mammouth.js';
import { reineSpore, bulbe } from './enemies/reineSpore.js';

export { grignoteur, larbin, larbinBouclier, bourdon, boumboule, pinceur, tourelleV, grosbras, canard, goinfrotron, lunette, fouisseur, moustique, phaseur, pingouin, champi, mammouth, reineSpore, bulbe };

// Toutes les fabriques à pré-calculer au chargement (géométries sculptées en Workers)
export const SCULPT_FACTORIES = [
  () => grignoteur(0), () => grignoteur(1), () => grignoteur(2), larbin, bourdon, boumboule,
  () => pinceur(false), () => pinceur(true), tourelleV, grosbras, canard, goinfrotron,
  larbinBouclier, lunette, fouisseur, moustique, phaseur,
  pingouin, champi, mammouth, reineSpore, bulbe,
];
