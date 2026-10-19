// Ciel : dégradé atmosphérique stylisé (horizon lumineux, halo de Mie autour du soleil), nuages éclairés
// (ombrage dans la masse, liseré à contre-jour, défilement), étoiles, nébuleuse, planète à anneaux, lune et
// aurore boréale facultative. La carte d'environnement (reflets) est calculée depuis ce même ciel.
import * as THREE from 'three';
import { QUALITY } from './frame.js';

// skyDetail : octaves et lectures d'éclairage des nuages ; seaSteps : pas de marche de la mer de nuages (Nimbara)
Object.assign(QUALITY.ultra, { skyDetail: 1, seaSteps: 40 });
Object.assign(QUALITY.haute, { skyDetail: 1, seaSteps: 28 });
Object.assign(QUALITY.moyenne, { skyDetail: 0, seaSteps: 16 });

// ------------------------------------------------------------- bruit raccordable (généré au lancement)
// r : bruit de valeur lisse (32 cellules par tuile) ; g : le même décalé de (37, 17) cellules (bruit 3D à une
// lecture : mix(r, g, fract(z)) avec uv décalé de (37, 17) × floor(z)) ; b : cellules de Worley (amas) ;
// a : bruit de valeur indépendant (16 cellules).
let _noise = null;
export function noiseTexture() {
  if (_noise) return _noise;
  const N = 256;
  let s = 12345;
  const rnd = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  const lattice = (n) => Float32Array.from({ length: n * n }, rnd);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const value = (L, n, x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = fade(x - ix), fy = fade(y - iy);
    const g = (i, j) => L[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
    const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  const L1 = lattice(32), L2 = lattice(16);
  // points de Worley (un par cellule, 16 cellules)
  const W = 16, pts = Float32Array.from({ length: W * W * 2 }, rnd);
  const worley = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    let d = 9;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = ix + i, cy = iy + j;
      const k = ((((cy % W) + W) % W) * W + (((cx % W) + W) % W)) * 2;
      d = Math.min(d, Math.hypot(cx + pts[k] - x, cy + pts[k + 1] - y));
    }
    return Math.max(0, 1 - d);
  };
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x / N) * 32, v = (y / N) * 32;
      const i = (y * N + x) * 4;
      data[i] = value(L1, 32, u, v) * 255;
      data[i + 1] = value(L1, 32, u + 37, v + 17) * 255;
      data[i + 2] = worley((x / N) * W, (y / N) * W) * 255;
      data[i + 3] = value(L2, 16, x / N * 16, y / N * 16) * 255;
    }
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  t.userData.shared = true;
  _noise = t;
  return t;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop, uHorizon, uBottom, uSunDir, uSunColor, uCloudColor;
uniform float uTime, uCloud, uStars, uCloudHeight, uCloudSpeed;
uniform vec3 uPlanetDir, uPlanetA, uPlanetB, uRingColor;
uniform float uPlanetSize, uRing;
uniform vec3 uMoonDir; uniform float uMoonSize; uniform vec3 uMoonColor;
uniform float uNebula; uniform vec3 uNebulaA, uNebulaB;
uniform float uAurora, uAuroraDist; uniform vec3 uAuroraA, uAuroraB;
uniform float uHalo, uGlow, uSunDisc, uDetail;
uniform sampler2D tNoise;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.03; a*=0.5; } return s; }
// bruit lu dans la texture (p en tuiles) : bien moins cher que le bruit calculé
float tfbm(vec2 p) {
  float s = texture2D(tNoise, p).r * 0.5 + texture2D(tNoise, p * 2.03 + 0.17).r * 0.25 + texture2D(tNoise, p * 4.07 + 0.41).r * 0.125;
  if (uDetail > 0.5) s += texture2D(tNoise, p * 8.13 + 0.73).r * 0.0625; else s += 0.031;
  return s / 0.9375;
}
vec3 body(vec3 d, vec3 dir, float size, vec3 a, vec3 b, float bands, out float mask) {
  float cd = dot(d, dir);
  float ang = acos(clamp(cd, -1.0, 1.0));
  mask = smoothstep(size, size * 0.985, ang);
  vec3 up = abs(dir.y) > 0.9 ? vec3(1,0,0) : vec3(0,1,0);
  vec3 r = normalize(cross(up, dir)); vec3 u = cross(dir, r);
  vec2 q = vec2(dot(d, r), dot(d, u)) / sin(size);
  float z = sqrt(max(0.0, 1.0 - dot(q, q)));
  float lit = clamp(dot(vec3(q, z), normalize(vec3(-0.5, 0.4, 0.6))) * 0.9 + 0.25, 0.08, 1.2);
  float band = sin(q.y * bands + fbm(q * 3.0) * 3.0) * 0.5 + 0.5;
  vec3 col = mix(a, b, band) * lit;
  if (bands < 4.0) {
    float cr = fbm(q * 7.0 + 3.0);
    col *= 0.78 + 0.3 * smoothstep(0.32, 0.62, cr);
    col *= 1.0 - 0.25 * smoothstep(0.62, 0.7, fbm(q * 13.0)) ;
  }
  col += pow(1.0 - z, 3.0) * a * 0.6;
  return col;
}
// densité des nuages sur leur plan (p en tuiles de bruit) : amas de Worley sur deux échelles, creusés par un
// bruit fin (bords en chou-fleur), le tout déformé par un bruit lent
float cloudField(vec2 p) {
  vec2 w = vec2(texture2D(tNoise, p * 0.31).a, texture2D(tNoise, p * 0.31 + 0.5).a) - 0.5;
  p += w * 0.07;
  float b = texture2D(tNoise, p * 0.55).b * 0.62 + texture2D(tNoise, p * 1.37 + 0.21).b * 0.3;
  float f = b + tfbm(p * 1.6) * 0.35 - 0.12;
  // érosion fine des bords (le cœur reste plein)
  float e = texture2D(tNoise, p * 4.3 + 0.6).b * 0.6 + texture2D(tNoise, p * 9.1 + 0.3).r * 0.4;
  return f - (1.0 - smoothstep(0.55, 0.85, f)) * (e - 0.45) * 0.16;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  float up = clamp(h, 0.0, 1.0);
  vec2 az = normalize(d.xz + 1e-5);
  vec2 saz = normalize(uSunDir.xz + 1e-5);
  float side = dot(az, saz) * 0.5 + 0.5;
  float sd = dot(d, uSunDir);
  float sdp = max(sd, 0.0);
  // dégradé : horizon, bande intermédiaire plus saturée, zénith ; en dessous de l'horizon, couleur du sol
  vec3 mid = mix(uHorizon, uTop, 0.5);
  mid = mix(vec3(dot(mid, vec3(0.299, 0.587, 0.114))), mid, 1.2);
  vec3 col = mix(uHorizon, mid, smoothstep(0.0, 0.22, up));
  col = mix(col, uTop, smoothstep(0.15, 0.85, up));
  if (h < 0.0) col = mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.35));
  // côté soleil, le bas du ciel se réchauffe et s'éclaire ; côté opposé il reste plus froid
  float low = 1.0 - smoothstep(0.0, 0.55, abs(h));
  col *= mix(vec3(0.96, 0.98, 1.03), vec3(1.06, 1.0, 0.94), side * side) * low + (1.0 - low);
  // horizon éclatant (diffusion multiple), plus fort vers le soleil
  float band = exp(-abs(h) * 16.0);
  col += (uHorizon * 0.22 + uSunColor * 0.16 * side * side * side) * band * uGlow;
  // étoiles (scintillantes, de tailles et de teintes variées), masquées par le jour près de l'horizon
  if (uStars > 0.0) {
    vec3 sp = floor(d * 300.0);
    float s = hash3(sp);
    float tw = 0.55 + 0.45 * sin(uTime * (1.5 + s * 3.0) + s * 50.0);
    float big = step(0.9993, s) * 2.0;
    vec3 tint = mix(vec3(1.0, 0.85, 0.7), vec3(0.75, 0.85, 1.0), hash3(sp + 7.0));
    col += tint * (step(0.9975, s) + big) * tw * uStars * smoothstep(-0.05, 0.3, h);
  }
  // nébuleuse
  if (uNebula > 0.0) {
    float n1 = fbm(d.xz * 2.0 / (abs(d.y) + 0.6) + vec2(3.0, 1.0));
    float n2 = fbm(d.xy * 3.0 + vec2(n1 * 2.0));
    float n3 = tfbm(d.xz * 0.6 / (abs(d.y) + 0.6) + n2 * 0.1);
    col += mix(uNebulaA, uNebulaB, n2) * pow(n1, 2.5) * uNebula * (0.7 + 0.6 * n3);
  }
  // aurore boréale : rideaux suspendus. Chaque couche est une tranche horizontale du rideau (de son bord bas, vif,
  // à son sommet, violet) ; le rideau suit une ligne ondulante qui dérive, strié verticalement. uAuroraDist éloigne
  // les rideaux (plus bas sur l'horizon) ; les stries sont lues au pied du rideau (mêmes pour toutes les couches).
  if (uAurora > 0.0 && h > 0.04) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 12; i++) {
      float k = float(i) / 12.0;
      vec2 q = d.xz / h * (1.0 + k * 1.6);
      for (int c = 0; c < 2; c++) {
        float fc = float(c);
        float x = q.x * (0.8 + fc * 0.3) + fc * 7.0;
        float curve = (texture2D(tNoise, vec2(x * 0.045 + uTime * 0.0012, 0.31 + fc * 0.4)).a - 0.5) * 3.2 + sin(x * 0.42 + uTime * 0.06 + fc * 2.0) * 0.45;
        float dz = q.y / uAuroraDist - (1.6 + fc * 1.3 + curve);
        float ribbon = exp(-abs(dz) * (5.0 - k * 2.5));
        float x0 = d.x / h * (0.8 + fc * 0.3) + fc * 7.0;
        float rays = texture2D(tNoise, vec2(x0 * 0.5 + curve * 0.4 - uTime * 0.006, 0.7 + fc * 0.2)).r;
        float edge = smoothstep(0.0, 0.12, k) * (1.0 - k);
        acc += mix(uAuroraA, uAuroraB, smoothstep(0.15, 0.85, k)) * ribbon * (0.25 + rays * rays * 2.2) * edge * (1.0 - fc * 0.35);
      }
    }
    col += acc * uAurora * 0.16 * smoothstep(0.04, 0.25, h);
  }
  // planète géante + anneaux
  // masque des astres : les nuages ne les voilent qu'en partie (ils restent lisibles)
  float bodies = 0.0;
  if (uPlanetSize > 0.0) {
    float m;
    vec3 pc = body(d, uPlanetDir, uPlanetSize, uPlanetA, uPlanetB, 9.0, m);
    col = mix(col, pc, m);
    bodies = m;
    if (uRing > 0.0) {
      vec3 nrm = normalize(vec3(0.25, 1.0, 0.1));
      vec3 r = normalize(cross(nrm, uPlanetDir)); vec3 u = cross(uPlanetDir, r);
      vec2 q = vec2(dot(d, r), dot(d, u)) / sin(uPlanetSize);
      float rr = length(vec2(q.x, q.y * 4.0));
      float ring = smoothstep(1.35, 1.4, rr) * smoothstep(2.3, 2.2, rr) * (0.6 + 0.4 * sin(rr * 40.0));
      float front = step(0.0, q.y) + (1.0 - m);
      col = mix(col, uRingColor, ring * uRing * clamp(front, 0.0, 1.0) * 0.8);
    }
  }
  if (uMoonSize > 0.0) {
    float m;
    vec3 mc = body(d, uMoonDir, uMoonSize, uMoonColor, uMoonColor * 0.7, 3.0, m);
    col = mix(col, mc, m);
    bodies = max(bodies, m);
  }
  // soleil : disque au bord adouci, couronne, halo de Mie (Henyey-Greenstein) et grand voile
  float g = 0.8;
  float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * sd, 1.5) * 0.011;
  float disc = smoothstep(0.99968, 0.99984, sd);
  col += uSunColor * (disc * 14.0 * uSunDisc + pow(sdp, 900.0) * 1.5 * uSunDisc + hg * uHalo + pow(sdp, 5.0) * 0.12 * uHalo);
  // nuages : couche plane vue en perspective, éclairée depuis le soleil
  if (uCloud > 0.0 && h > -0.02) {
    vec2 p = d.xz / (max(h, 0.0) + uCloudHeight) * 0.05 + vec2(0.00019, 0.00006) * uTime * uCloudSpeed;
    float f = cloudField(p);
    float thr = mix(0.8, 0.52, uCloud);
    float cov = smoothstep(thr, thr + 0.06, f);
    if (cov > 0.001) {
      float dens = max(f - thr, 0.0);
      // ombrage dans la masse : densité lue vers le soleil ; bord tourné vers lui éclairé
      vec2 sdir = saz * 0.01;
      float f1 = cloudField(p + sdir);
      float f2 = f1, fu = f;
      if (uDetail > 0.5) {
        f2 = cloudField(p + sdir * 2.5);
        // « haut » apparent du nuage (vers le zénith sur le plan) : sommets ronds éclairés par le ciel
        fu = cloudField(p - az * 0.008 / (max(h, 0.0) + uCloudHeight));
      }
      float occ = max(f1 - thr, 0.0) * 2.5 + max(f2 - thr, 0.0) * 1.2;
      float lit = max(exp(-occ * 3.0), clamp((f - f1) * 8.0, 0.0, 1.0) * 0.8);
      float top = clamp((f - fu) * 7.0, 0.0, 1.0);
      vec3 skyAmb = mix(uHorizon, uTop, 0.45);
      vec3 shade = skyAmb * 0.78 + uCloudColor * 0.14;
      vec3 litC = uCloudColor * (0.62 + uSunColor * 0.6);
      vec3 cc = mix(shade, litC, lit);
      cc += uCloudColor * top * 0.16;
      // dessous des nuages au-dessus de soi, plus sombre où ils sont épais
      cc *= 1.0 - smoothstep(0.02, 0.3, dens) * 0.2 * smoothstep(0.2, 0.8, h);
      // contre-jour : bords minces illuminés, cœur plus sombre
      float fw = pow(sdp, 5.0);
      float edge = 1.0 - smoothstep(0.0, 0.1, dens);
      cc += uSunColor * fw * edge * 2.2;
      cc *= 1.0 - fw * smoothstep(0.05, 0.3, dens) * 0.3;
      // au ras de l'horizon, les nuages se fondent dans la brume du ciel
      cc = mix(col * 1.04, cc, smoothstep(0.0, 0.32, h));
      float a = cov * min(1.0, uCloud * 1.4) * 0.95 * smoothstep(-0.02, 0.12, h) * (1.0 - bodies * 0.55);
      col = mix(col, cc, a);
    }
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// o : réglages de L.environment (skyTop, skyHorizon, skyBottom, sunColor, clouds, cloudColor, cloudHeight, stars,
// nebula*, planet*, ring*, moon*, aurora { a, b, strength, dist }, skyGlow, sunHalo, cloudSpeed)
export function createSky(o, sunDir) {
  const c = (x) => new THREE.Color(x);
  const au = o.aurora || null;
  const uniforms = {
    uTop: { value: c(o.skyTop) }, uHorizon: { value: c(o.skyHorizon) }, uBottom: { value: c(o.skyBottom || o.skyHorizon) },
    uSunDir: { value: sunDir }, uSunColor: { value: c(o.sunColor || '#fff1c8') }, uCloudColor: { value: c(o.cloudColor || '#ffffff') },
    uTime: { value: 0 }, uCloud: { value: o.clouds ?? 0.6 }, uStars: { value: o.stars ?? 0 }, uCloudHeight: { value: o.cloudHeight ?? 0.2 },
    uCloudSpeed: { value: o.cloudSpeed ?? 1 },
    uPlanetDir: { value: new THREE.Vector3(...(o.planetDir || [0, 0.3, 1])).normalize() }, uPlanetSize: { value: o.planetSize || 0 },
    uPlanetA: { value: c(o.planetA || '#c08060') }, uPlanetB: { value: c(o.planetB || '#f0c090') }, uRing: { value: o.ring || 0 }, uRingColor: { value: c(o.ringColor || '#e8d0b0') },
    uMoonDir: { value: new THREE.Vector3(...(o.moonDir || [0.5, 0.5, -1])).normalize() }, uMoonSize: { value: o.moonSize || 0 }, uMoonColor: { value: c(o.moonColor || '#d0d8f0') },
    uNebula: { value: o.nebula || 0 }, uNebulaA: { value: c(o.nebulaA || '#ff4fa0') }, uNebulaB: { value: c(o.nebulaB || '#4f7fff') },
    uAurora: { value: au ? au.strength ?? 1 : 0 }, uAuroraDist: { value: (au && au.dist) || 1 }, uAuroraA: { value: c((au && au.a) || '#3affb0') }, uAuroraB: { value: c((au && au.b) || '#b05aff') },
    uHalo: { value: o.sunHalo ?? 1 }, uGlow: { value: o.skyGlow ?? 1 }, uSunDisc: { value: 1 }, uDetail: { value: 1 },
    tNoise: { value: noiseTexture() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

// Carte d'environnement (reflets) calculée depuis le ciel : sans le disque du soleil (la lumière directe s'en
// charge), avec un sol de la couleur de la planète
export function skyEnvironment(renderer, sky, groundColor) {
  const u = sky.material.uniforms;
  const disc = u.uSunDisc.value;
  u.uSunDisc.value = 0;
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), sky.material);
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(49, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(groundColor).multiplyScalar(0.6) }));
  ground.position.y = -6;
  envScene.add(ground);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(envScene, 0.04, 0.1, 200);
  pm.dispose();
  envSky.geometry.dispose();
  ground.geometry.dispose();
  ground.material.dispose();
  u.uSunDisc.value = disc;
  return rt;
}

// Réglage par qualité (détail des nuages)
export function skyQuality(sky, Q) {
  sky.material.uniforms.uDetail.value = Q.skyDetail ?? 1;
}
