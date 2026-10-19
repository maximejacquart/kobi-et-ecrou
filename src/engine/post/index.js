// Post-traitement « objectif » : profondeur de champ, flou de mouvement, halo + exposition automatique, rendu des
// couleurs, étalonnage. Ordre : … → dof → motion → bloom → output → grade.
// Les passes nommées 'bloom', 'output' et 'grade' restent les points d'ancrage des autres modules ; dof et motion
// sont attachées au halo : R.addPost(x, 'bloom') s'insère avant elles.
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { QUALITY } from '../frame.js';
import { DofPass } from './dof.js';
import { MotionBlurPass } from './motion.js';
import { Exposure } from './exposure.js';
import { BloomPass } from './bloom.js';
import { LensOutputPass } from './output.js';
import { GradeShader } from './grade.js';

// Réglages par qualité (repli : Moyenne garde un flou de mouvement léger et l'exposition, sans salissure ni traînées)
Object.assign(QUALITY.ultra, { dofSamples: 43, motionSamples: 12, bloomLevels: 8, bloomStreaks: true, lensDirt: true, autoExposure: true });
Object.assign(QUALITY.haute, { dofSamples: 22, motionSamples: 8, bloomLevels: 8, bloomStreaks: true, lensDirt: true, autoExposure: true });
Object.assign(QUALITY.moyenne, { dofSamples: 16, motionSamples: 5, bloomLevels: 7, bloomStreaks: false, lensDirt: false, autoExposure: true });

export function installPost(R, tone) {
  const c = R.composer;
  R.dof = new DofPass(R);
  R.motion = new MotionBlurPass(R);
  R.exposure = new Exposure();
  R.bloom = new BloomPass(R, R.exposure);
  R.output = new LensOutputPass(R, R.bloom, R.exposure, tone);
  R.grade = new ShaderPass(GradeShader);
  R.grade.name = 'grade';
  R.gradeU = R.grade.uniforms;
  for (const p of [R.dof, R.motion, R.bloom, R.output, R.grade]) c.addPass(p);
  R.onFrame.push((dt) => {
    R.dof.update(dt);
    R.motion.track(dt);
  });
}
