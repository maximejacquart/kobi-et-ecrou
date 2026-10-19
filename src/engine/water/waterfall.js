// Cascade : rideau d'eau courbe (trajectoire balistique depuis la lèvre) qui défile en stries de plus en plus
// rapides et blanches, deux nappes pour l'épaisseur ; au pied, un disque d'écume qui bouillonne vers le large,
// des ondes, des embruns et une brume persistante.
import * as THREE from 'three';
import { LAYERS } from '../frame.js';
import { waterU } from './surface.js';

const VERT = /* glsl */ `
attribute float aT;
varying vec2 vUv;
varying float vT;
varying vec3 vWPos;
varying vec3 vWNrm;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vT = aT;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWPos = w.xyz;
  vWNrm = normalize(mat3(modelMatrix) * normal);
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform sampler2D tWaves, tWFoam, tSceneColor;
uniform vec2 uRes;
uniform float uWTime, uLen, uWidth, uFall, uShade, uSeed;
uniform vec3 uWSunDir, uWSunColor, uLight, uTint;
varying vec2 vUv;
varying float vT;
varying vec3 vWPos;
varying vec3 vWNrm;
#include <fog_pars_fragment>
void main() {
  float x = vUv.x * uWidth;
  // coordonnée attachée à l'eau (temps de chute) : les motifs s'étirent d'eux-mêmes en accélérant
  float y = vT * uFall - uWTime;
  // bandes larges et stries fines, très étirées dans le sens de la chute
  float sA = texture2D(tWaves, vec2(x * 0.45 + uSeed, y * 0.3)).b;
  float sB = texture2D(tWaves, vec2(x * 1.1 + uSeed * 3.0, y * 0.7) + 0.37).b;
  float sC = texture2D(tWFoam, vec2(x * 0.35 + uSeed * 2.0, y * 1.1)).g;
  float streak = smoothstep(0.35, 0.72, sA * 0.6 + sB * 0.55 - 0.05);
  // blanchit en tombant (air entraîné) ; lèvre lisse et vitreuse
  float aer = smoothstep(0.0, 0.6, vT);
  float white = clamp(aer * (streak * 0.85 + sC * 0.3) + smoothstep(0.7, 1.0, vT) * 0.35, 0.0, 1.0);
  // bords effilochés, nappe qui se déchire en filets
  float nl = texture2D(tWFoam, vec2(0.13, y * 0.35)).g;
  float nr = texture2D(tWFoam, vec2(0.61, y * 0.35 + 0.4)).g;
  float wob = 0.05 + vT * 0.16;
  float edge = smoothstep(0.0, 0.06 + nl * wob * 2.0, vUv.x - nl * wob) * smoothstep(1.0, 0.94 - nr * wob * 2.0, vUv.x + nr * wob);
  float tear = smoothstep(0.1, 0.35, streak + sC * 0.3 + (1.0 - vT) * 0.6);
  float a = edge * tear * smoothstep(0.0, 0.02, vT) * smoothstep(1.0, 0.93, vT) * mix(0.62, 0.95, white);
  // lumière : face au soleil, diffusion à travers la nappe (contre-jour)
  vec3 V = normalize(cameraPosition - vWPos);
  vec3 N = faceforward(vWNrm, -V, vWNrm);
  float ndl = max(dot(N, uWSunDir), 0.0) * 0.5 + 0.5;
  float back = pow(max(dot(-V, uWSunDir), 0.0), 4.0);
  vec3 lit = uLight * 1.2 + uWSunColor * (ndl * 0.14 + back * 0.16);
  // lèvre vitreuse : le décor derrière, déformé et teinté d'eau, reflets en bandes ; liseré clair au bord
  vec2 suv = gl_FragCoord.xy / uRes + (vec2(sA, sB) - 0.5) * 0.03;
  vec3 refr = texture2D(tSceneColor, suv).rgb * uTint * 0.5;
  float gloss = smoothstep(0.55, 0.8, sA) * (1.0 - aer) + smoothstep(0.06, 0.0, vT) * 0.8;
  vec3 body = refr + uTint * lit * (0.28 + gloss * 0.6);
  vec3 col = mix(body, lit * mix(0.85, 1.05, sC), white) * uShade;
  gl_FragColor = vec4(col, a);
  #include <fog_fragment>
}`;

const FOOT_FRAG = /* glsl */ `
uniform sampler2D tWFoam;
uniform float uWTime;
uniform vec3 uWSunDir, uWSunColor, uLight;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float th = atan(p.y, p.x) / 6.2831853;
  // l'écume naît sous la chute et s'étale vers le large en se déchirant
  float brk = texture2D(tWFoam, vec2(th * 3.0, r * 0.6 - uWTime * 0.05)).g;
  float rr = r + (brk - 0.5) * 0.45;
  float f1 = texture2D(tWFoam, vec2(th * 5.0, r * 1.2 - uWTime * 0.3)).r;
  float f2 = texture2D(tWFoam, vec2(th * 9.0 + 0.3, r * 2.2 - uWTime * 0.5)).r;
  float thr = mix(0.12, 1.0, smoothstep(0.0, 0.9, rr));
  float foam = smoothstep(thr, thr + 0.16, f1 * 0.7 + f2 * 0.55) * smoothstep(1.0, 0.5, rr);
  vec3 lit = uLight * 1.2 + uWSunColor * (max(uWSunDir.y, 0.0) * 0.2 + 0.04);
  gl_FragColor = vec4(lit * 0.9, foam * 0.85);
  #include <fog_fragment>
}`;

const _l = new THREE.Color();

// o : { from: [x, y, z] (milieu de la lèvre), to: y du pied, width, dir (angle, 0 = vers +z), speed (jet, m/s),
//       pool (plan d'eau du pied), tint, spray, footR (rayon du disque d'écume) }
export function buildWaterfall(L, o, R) {
  const [fx, fy, fz] = o.from;
  const to = o.to ?? fy - 10;
  const width = o.width ?? 4;
  const dir = new THREE.Vector3(Math.sin(o.dir ?? 0), 0, Math.cos(o.dir ?? 0));
  const right = new THREE.Vector3(dir.z, 0, -dir.x);
  const vh = o.speed ?? 1.8;
  const G = 9.8;
  const T = Math.sqrt((2 * (fy - to)) / G);
  const footX = fx + dir.x * vh * T, footZ = fz + dir.z * vh * T;
  const group = new THREE.Group();
  group.name = 'cascade';
  const tint = new THREE.Color(o.tint || '#bfeff0');
  const sheets = [];
  const makeSheet = (wk, back, shade, seed) => {
    const cols = 20, rows = 36;
    const pos = [], uv = [], at = [], idx = [];
    let len = 0, prev = null;
    const arc = [];
    for (let j = 0; j <= rows; j++) {
      const t = (j / rows) * T;
      const c = new THREE.Vector3(fx + dir.x * (vh * t - back), fy - 0.5 * G * t * t, fz + dir.z * (vh * t - back));
      if (prev) len += c.distanceTo(prev);
      arc.push(len);
      prev = c;
    }
    for (let j = 0; j <= rows; j++) {
      const t = (j / rows) * T;
      const spread = 1 + Math.pow(j / rows, 1.5) * 0.45;
      for (let i = 0; i <= cols; i++) {
        const u = i / cols;
        const lat = (u - 0.5) * width * wk * spread;
        // nappe légèrement bombée vers l'avant
        const bulge = Math.sin(u * Math.PI) * 0.22 * wk;
        const s = vh * t - back + bulge;
        pos.push(fx + dir.x * s + right.x * lat, fy - 0.5 * G * t * t, fz + dir.z * s + right.z * lat);
        uv.push(u, arc[j] / Math.max(len, 0.01));
        at.push(j / rows);
      }
    }
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const u = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uLen: { value: len }, uWidth: { value: width * wk }, uFall: { value: T * 1.6 }, uShade: { value: shade },
      uSeed: { value: seed }, uLight: { value: new THREE.Color(0.3, 0.3, 0.3) }, uTint: { value: tint },
    }]);
    for (const k of ['tWaves', 'tWFoam', 'tSceneColor', 'uRes', 'uWTime', 'uWSunDir', 'uWSunColor']) u[k] = waterU[k];
    const m = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.layers.set(LAYERS.WATER);
    mesh.renderOrder = 6 - back;
    mesh.userData.noAO = true;
    group.add(mesh);
    sheets.push(m);
    return mesh;
  };
  makeSheet(0.82, 0.35, 0.72, 0.37);
  makeSheet(1, 0, 1, 0);
  // pied : disque d'écume posé sur le plan d'eau
  const poolY = o.pool ? o.pool.y : to;
  const footR = o.footR ?? width * 1.1 + 2;
  const fu = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uLight: { value: new THREE.Color(0.3, 0.3, 0.3) } }]);
  for (const k of ['tWFoam', 'uWTime', 'uWSunDir', 'uWSunColor']) fu[k] = waterU[k];
  const footM = new THREE.ShaderMaterial({
    uniforms: fu,
    vertexShader: 'varying vec2 vUv;\n#include <fog_pars_vertex>\nvoid main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;\n#include <fog_vertex>\n}',
    fragmentShader: FOOT_FRAG,
    transparent: true, depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const foot = new THREE.Mesh(new THREE.PlaneGeometry(footR * 2, footR * 2).rotateX(-Math.PI / 2), footM);
  foot.position.set(footX, poolY + 0.03, footZ);
  foot.layers.set(LAYERS.WATER);
  foot.renderOrder = 4;
  group.add(foot);
  L.root.add(group);

  let impT = 0;
  const fall = {
    group, foot: new THREE.Vector3(footX, poolY, footZ), width,
    get alive() { let p = group; while (p.parent) p = p.parent; return p === R.scene; },
    update(dt, S) {
      // lumière du ciel (calculée par le système)
      _l.copy(S.ambient);
      for (const m of sheets) m.uniforms.uLight.value.copy(_l);
      fu.uLight.value.copy(_l);
      const cp = R.camera.position;
      const d = Math.hypot(cp.x - footX, cp.z - footZ);
      if (d > 90) return;
      // embruns et brume (moins quand on est loin)
      S.splash.spray(footX, poolY, footZ, width * 0.55, (o.spray ?? 1) * (d < 40 ? 50 : 14), dt, { mistAlpha: 0.32, mistSize: width * 0.45 });
      impT -= dt;
      if (impT <= 0) {
        impT = 0.07;
        const a = Math.random() * Math.PI * 2, rr = Math.random() * width * 0.45;
        S.ripple.impulse(footX + Math.cos(a) * rr, footZ + Math.sin(a) * rr, 0.35, 0.03);
      }
    },
  };
  return fall;
}
