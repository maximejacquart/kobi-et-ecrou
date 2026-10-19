// Mise en scène de l'objectif selon l'état du jeu (appelée à chaque image par la boucle du jeu) :
//  - pause, Bazar, bilan de planète : arrière-plan fortement flou derrière l'interface ;
//  - écran titre, cinématiques et intros de boss : mise au point sur le sujet du plan, arrière-plan modérément flou ;
//  - dialogues : mise au point sur Kobi (Écrou, qui parle le plus, est sur son dos), arrière-plan doucement flou ;
//  - roue des armes : flou progressif pendant le ralenti ;
//  - Longue-Vue : mise au point sur ce que vise la lunette, léger flou de l'arrière-plan.
// Flou de mouvement : coupé en visée et dans les menus ; Kobi reste net quand la caméra le suit.
import * as THREE from 'three';

// focus suivi en continu ; range (m), aperture (% de hauteur), near / far (part du flou devant / derrière), t (s)
const LOOKS = {
  menu: { range: 1.2, aperture: 2.4, near: 1, far: 1, t: 0.45 },
  title: { range: 2, aperture: 1.2, near: 0.6, far: 1, t: 0.8 },
  cine: { range: 3, aperture: 1.0, near: 0.7, far: 1, t: 0.6 },
  talk: { range: 8, aperture: 0.45, near: 0, far: 1, t: 1.5 },
  wheel: { range: 1.6, aperture: 1.6, near: 0.5, far: 1, t: 0.35 },
  scope: { range: 14, aperture: 0.4, near: 0.4, far: 1, t: 0.4 },
};

const _focus = new THREE.Vector3();
const _subject = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export function lensDirector(g) {
  const { dof, motion } = g.R;
  const p = g.player, cam = g.camera, st = g.state;
  let mode = null;
  if (st === 'paused' || st === 'vendor' || st === 'complete' || st === 'map' || st === 'credits') mode = 'menu';
  else if (st === 'title') mode = 'title';
  else if (st === 'cutscene') mode = 'cine';
  else if (st === 'playing') {
    if (g.hud.wheelOpen) mode = 'wheel';
    else if ((cam.zoomBlend || 0) > 0.5) mode = 'scope';
    // dialogue affiché (une interface masquée, captures comprises, n'en déclenche pas)
    else if (g.hud.dialogCur && g.hud.root.style.display !== 'none') mode = 'talk';
  }
  // sujet du plan
  if (mode === 'cine' && cam.script) _focus.copy(cam.script.look);
  else if (mode === 'scope') {
    // mise au point sur ce que vise la lunette : le premier ennemi sur la ligne, sinon le décor
    cam.cam.getWorldDirection(_fwd);
    const hit = g.world.raycast(cam.cam.position, _fwd, 250);
    const foe = g.enemies.raycast(cam.cam.position, _fwd, hit ? hit.t : 250, 0.3);
    _focus.copy(cam.cam.position).addScaledVector(_fwd, foe ? foe.t : hit ? hit.t : 250);
  } else if (p) _focus.set(p.pos.x, p.pos.y + 1, p.pos.z);
  // R.dof.manual : un autre système (mode photo) a pris la main ; la mise en scène reprendra à sa sortie
  if (dof.manual) g._lensMode = 'manuel';
  else if (mode !== g._lensMode) {
    g._lensMode = mode;
    if (mode) {
      const { t, ...look } = LOOKS[mode];
      dof.set({ ...look, focus: _focus }, t);
    } else dof.off(0.6);
  }
  motion.amount = st === 'playing' ? 1 - Math.min(1, (cam.aimBlend || 0) * 1.5) : st === 'cutscene' ? 1 : 0;
  motion.subject = p && st === 'playing' ? _subject.set(p.pos.x, p.pos.y + 0.8, p.pos.z) : null;
}
