# Outils de développement

Ces outils ne servent pas à jouer : ils aident à tester le jeu et à en faire des captures pendant le développement.

## Prérequis

- Les dépendances de développement installées (`npm install`).
- Google Chrome installé sur la machine : les scripts le pilotent sans fenêtre, avec la vraie carte graphique.
- Le serveur de développement lancé dans un autre terminal : `npm run dev` (port 5173 ; `PORT=5174 node tools/…`
  pour viser un autre serveur).

Les scripts s'appuient sur les accès de débogage du jeu (`window.__game`, `window.__dbg`, `window.__stats`), qui
n'existent qu'avec le serveur de développement, jamais dans la version publiée. Ils se lancent depuis la racine du
projet et affichent les erreurs de la console du jeu.

## Scripts

### `tools/snap.mjs` : captures d'écran

```
node tools/snap.mjs <dossier> <nom>=<adresse>[@attente_ms] ...
```

Ouvre chaque adresse, attend (2,5 s par défaut), enregistre `<dossier>/<nom>.png` et affiche `window.__stats`.

```
node tools/snap.mjs captures titre=@6000 brikka=?niveau=brikka@9000 bestiaire=dev/bestiary.html?m=larbin
```

### `tools/play.mjs` : scénario joué

```
node tools/play.mjs <dossier> <niveau|title> "<étape>;<étape>;…"
```

Démarre un niveau (`brikka`, `nimbara`…), avec Kobi invincible, ou l'écran titre (`title`), puis enchaîne les étapes.
Elles sont séparées par `;`, ou par `;;` dès qu'un code en contient un.

| Étape | Effet |
| --- | --- |
| `hold:KeyW:1500` | maintient une touche (ou `KeyW+ShiftLeft`) pendant 1,5 s |
| `press:Space` | appui bref |
| `down:Mouse0` / `up:Mouse0` | enfonce / relâche (ici le tir) |
| `wait:500` | attend 500 ms |
| `shot:nom` | capture `<dossier>/nom.png` |
| `eval:code` | exécute du code dans la page et affiche le résultat |
| `evalfile:fichier.js` | idem avec le contenu d'un fichier (chemin relatif) |
| `click:sélecteur` | clique sur un élément de la page |
| `reload` | recharge la page (par exemple après avoir écrit une sauvegarde) |

```
node tools/play.mjs captures brikka "hold:KeyW:1200;press:Space;wait:400;shot:saut"
```

### `tools/strip.mjs` : planche-contact d'une animation

```
node tools/strip.mjs <sortie.png> <adresse> [images=12] [intervalle_ms=70] [attente_ms=2500] [x,y,l,h]
```

Prend une série d'images d'une zone de l'écran et les assemble en une planche numérotée. L'adresse peut se terminer
par `#eval:code`, exécuté juste avant la première image (par exemple pour déclencher une action).

```
node tools/strip.mjs course.png "dev/viewer.html?view=side&speed=8" 12 70
```

`tools/browser.mjs` est le module commun : il lance Chrome et donne l'adresse du serveur.

## Pages de développement (`dev/`)

Ouvertes avec le serveur de développement, par exemple <http://localhost:5173/dev/viewer.html>.

| Page | Contenu |
| --- | --- |
| `dev/viewer.html` | Kobi seul, sous plusieurs angles et dans plusieurs poses (paramètres en tête de `dev/viewer.js`) |
| `dev/bestiary.html` | modèles des ennemis : `?m=larbin`, `?m=grosbras,lunette`, `?m=all` |
| `dev/armurerie.html` | armes : `?w=riveteuse` (base, v2, Méga), `?w=all`, `&hand=1&aim=1` (en main de Kobi), `&ally=1` (allié déployé), `&icons=1` (icônes du Bazar) |
| `dev/fx.html` | bac à sable des effets (explosions, tirs…) sur chaque planète |
| `dev/water.html` | bac à eau : eau, acide, lave et glace, de jour ou de nuit |
