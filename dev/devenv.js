// Carte d'environnement des pages de développement (ciel en dégradé, sol chaud, tache de soleil) : sans elle, les
// reflets, le vernis et les métaux n'ont rien à refléter. ?env=0 pour s'en passer.
import * as THREE from 'three';

export function devEnvironment(R, sunPos = [4, 8, 5]) {
  if (new URLSearchParams(location.search).get('env') === '0') return;
  const s = new THREE.Scene();
  const sky = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP;
      void main() {
        float y = normalize(vP).y;
        vec3 c = y > 0.0 ? mix(vec3(0.8, 0.88, 1.0), vec3(0.3, 0.55, 1.0), pow(y, 0.6)) : mix(vec3(0.8, 0.62, 0.45), vec3(0.5, 0.32, 0.2), pow(-y, 0.5));
        gl_FragColor = vec4(c * 1.2, 1.0);
      }`,
  });
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), sky));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(14, 12, 9) }));
  sun.position.set(...sunPos).normalize().multiplyScalar(9);
  s.add(sun);
  const pm = new THREE.PMREMGenerator(R.renderer);
  R.scene.environment = pm.fromScene(s, 0.02).texture;
  R.scene.environmentIntensity = 0.7;
  pm.dispose();
}
