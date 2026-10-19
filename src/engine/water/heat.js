// Brume de chaleur au-dessus de la lave : un volume (boîte, faces arrière) sur la couche des effets ; le long du
// rayon de vue, la « chaleur » (dense au ras de la lave, nulle à quelques mètres) est intégrée jusqu'au décor,
// et l'image opaque est redessinée déformée en proportion, avec un frémissement qui monte.
import * as THREE from 'three';
import { frameU, LAYERS } from '../frame.js';
import { waterU } from './surface.js';

const FRAG = /* glsl */ `
uniform sampler2D tSceneColor, tSceneDepth, tWaves;
uniform vec2 uRes;
uniform float uCamNear, uCamFar, uWTime, uStrength;
uniform vec3 uMin, uMax;
varying vec3 vWPos;
float kLin(float d) { return (uCamNear * uCamFar) / (uCamFar - (uCamFar - uCamNear) * d); }
void main() {
  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWPos - ro);
  // entrée et sortie de la boîte
  vec3 inv = 1.0 / rd;
  vec3 ta = (uMin - ro) * inv, tb = (uMax - ro) * inv;
  vec3 tmin = min(ta, tb), tmax = max(ta, tb);
  float t0 = max(max(max(tmin.x, tmin.y), tmin.z), 0.0);
  float t1 = min(min(tmax.x, tmax.y), tmax.z);
  // le décor arrête le rayon
  float vz = kLin(texture2D(tSceneDepth, suv).x);
  vec3 fw = normalize((viewMatrix * vec4(rd, 0.0)).xyz);
  t1 = min(t1, vz / max(-fw.z, 1e-3));
  if (t1 <= t0) discard;
  // chaleur intégrée (4 échantillons) : décroît avec la hauteur au-dessus de la lave
  float h = uMax.y - uMin.y, heat = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 p = ro + rd * mix(t0, t1, (float(i) + 0.5) / 4.0);
    float e = min(min(p.x - uMin.x, uMax.x - p.x), min(p.z - uMin.z, uMax.z - p.z));
    heat += exp(-(p.y - uMin.y) / (h * 0.35)) * smoothstep(0.0, 2.0, e);
  }
  heat *= (t1 - t0) / 4.0;
  float amt = clamp(heat * 0.06, 0.0, 1.0) * uStrength;
  if (amt < 0.002) discard;
  vec3 c = ro + rd * mix(t0, t1, 0.3);
  vec2 w = texture2D(tWaves, vec2(c.x * 0.15, c.z * 0.15 - uWTime * 0.12) + vec2(0.0, -c.y * 0.2)).rg - 0.5;
  w += (texture2D(tWaves, vec2(c.x * 0.37 + 0.3, c.y * 0.3 - uWTime * 0.35)).rg - 0.5) * 0.6;
  vec3 col = texture2D(tSceneColor, suv + w * amt * 0.018).rgb;
  gl_FragColor = vec4(col, smoothstep(0.0, 0.15, amt));
}`;

export function heatHaze(L, rect, y, height = 4, strength = 1) {
  const [x0, z0, w, d] = rect;
  const u = {
    tSceneColor: frameU.tSceneColor, tSceneDepth: frameU.tSceneDepth, tWaves: waterU.tWaves, uRes: frameU.uRes,
    uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar, uWTime: waterU.uWTime, uStrength: { value: strength },
    uMin: { value: new THREE.Vector3(x0, y, z0) }, uMax: { value: new THREE.Vector3(x0 + w, y + height, z0 + d) },
  };
  const m = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: 'varying vec3 vWPos; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: FRAG,
    transparent: true, depthWrite: false, depthTest: false, side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), m);
  mesh.position.set(x0 + w / 2, y + height / 2, z0 + d / 2);
  mesh.layers.set(LAYERS.FX);
  mesh.renderOrder = -5;
  mesh.userData.noAO = true;
  mesh.name = 'brume-de-chaleur';
  L.root.add(mesh);
  return mesh;
}
