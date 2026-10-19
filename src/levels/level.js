// Niveau en cours : environnement (ciel, lumières, brouillard), terrain, géométrie statique fusionnée,
// déclencheurs, zones de vent, scripts, et nettoyage complet au déchargement.
import * as THREE from 'three';
import { BoxCollider, CylinderCollider, HeightfieldCollider } from '../engine/physics.js';
import { terrainMaterial, globalU, cloneMat } from '../engine/materials.js';
import { bake, G } from '../models/geo.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { natureU } from '../models/nature.js';
import { frameU, allLayers } from '../engine/frame.js';
import { lights } from '../engine/lightpool.js';
import { probes } from '../engine/probes.js';
import { sunShadows } from '../engine/shadows.js';
import { createSky, skyEnvironment, skyQuality } from '../engine/sky.js';
import { volumetrics } from '../engine/volumetrics.js';

const _v = new THREE.Vector3();
const _wv = new THREE.Vector3();
const WHITE = new THREE.Color('#ffffff');
const _m = new THREE.Matrix4();

export class Level {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.id = def.id;
    this.root = new THREE.Group();
    this.root.name = 'level-' + def.id;
    game.scene.add(this.root);
    this.rails = [];
    this.grapples = [];
    this.interactables = [];
    this.triggers = [];
    this.winds = [];
    this.updaters = [];
    this.batches = new Map();
    this.checkpoint = { pos: new THREE.Vector3(0, 1, 0), yaw: 0 };
    this.killY = -40;
    this.dustColor = '#e8c9a0';
    this.time = 0;
    this.lights = [];
    this.heightfield = null;
    this.timers = [];
  }
  // exécute fn après d secondes de jeu (annulé si le niveau est déchargé)
  after(d, fn) { this.timers.push({ t: this.time + d, fn }); }

  // ------------------------------------------------------------- environnement
  environment(o) {
    const g = this.game;
    const scene = g.scene;
    lights.attach(g);
    probes.attach(g);
    const c = (x) => new THREE.Color(x);
    const sunDir = new THREE.Vector3(...(o.sunDir || [0.5, 0.6, 0.3])).normalize();
    this.sunDir = sunDir;
    // ciel (sky.js) et carte d'environnement (reflets des métaux) calculée depuis lui
    const sky = createSky(o, sunDir);
    this.root.add(sky);
    this.sky = sky;
    const rt = skyEnvironment(g.R.renderer, sky, o.envGround || o.hemiGround || '#806050');
    scene.environment = rt.texture;
    scene.environmentIntensity = o.envIntensity ?? 0.7;
    this.envRT = rt;

    scene.fog = new THREE.Fog(o.fogColor || o.skyHorizon, o.fogNear ?? 60, o.fogFar ?? 450);
    // brume de hauteur (o.fogBase : altitude où elle est pleine, o.fogFall : décroissance, o.fogHeight : opacité max)
    globalU.uFogBase.value = o.fogBase ?? 0;
    globalU.uFogFall.value = o.fogFall ?? 0.08;
    globalU.uFogHeight.value = o.fogHeight ?? 0;
    globalU.uFogSunDir.value.copy(sunDir);
    globalU.uFogSunCol.value.set(o.fogSunColor || o.sunColor || '#fff1c8');
    globalU.uFogSun.value = o.fogSun ?? 0.55;
    scene.background = null;
    const hemi = new THREE.HemisphereLight(o.hemiSky || '#bfdcff', o.hemiGround || '#a07050', o.hemiIntensity ?? 1.1);
    this.root.add(allLayers(hemi));
    const sun = new THREE.DirectionalLight(o.sunColor || '#fff1c8', o.sunIntensity ?? 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(g.R.shadowSize, g.R.shadowSize);
    const S = 34;
    Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 1, far: 220 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2.5;
    this.root.add(allLayers(sun));
    this.root.add(sun.target);
    this.sun = sun;
    frameU.uSunDir.value.copy(sunDir);
    frameU.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
    // ombres en cascades (Ultra, Haute) ; la carte du soleil reste le repli de la Moyenne
    this.shadows = sunShadows(g.R);
    this.shadows.attach(this);
    // brouillard volumétrique (Ultra, Haute) : o.volumetric = { density, noise, anisotropy… } ou false
    this.volumetric = volumetrics(g.R);
    this.volumetric.configure(this, o);
    const fill = new THREE.DirectionalLight(o.fillColor || '#fff4ea', o.fill ?? 0.45);
    this.root.add(allLayers(fill));
    this.root.add(fill.target);
    this.fill = fill;
    this.glare = o.glare ?? 0.9;
    this.rays = o.rays ?? 0.5;
    // lumière d'appoint des personnages : part du soleil rendue côté caméra quand on regarde vers lui (contre-jour)
    this.charLight = o.charLight ?? 0.2;
    globalU.uRimColor.value.set(o.rimColor || '#ffd9a8');
    globalU.uRimStrength.value = o.rimStrength ?? 0.55;
    if (o.exposure) g.R.renderer.toneMappingExposure = o.exposure;
    else g.R.renderer.toneMappingExposure = 1.0;
    g.R.bloom.strength = o.bloom ?? 0.55;
    // seuil du halo (luminance exposée) : plus haut sur une planète au ciel très clair, qui sinon voile toute l'image
    g.R.bloom.threshold = o.bloomThreshold ?? 0.85;
    // exposition automatique : o.autoExposure = { key, amount, min, max, comp, up, down } (voir post/exposure.js)
    g.R.exposure.configure(o.autoExposure);
    // (réglages de saturation pensés pour ACES : le rendu neutre est déjà plus franc)
    g.R.gradeU.uSaturation.value = (o.saturation ?? 1.12) - 0.05;
    g.R.gradeU.uTint.value.set(...(o.tint || [1, 1, 1]));
    g.R.gradeU.uLift.value.set(...(o.lift || [0, 0, 0]));
    // étalonnage : o.grade = { shadows, highlights (couleurs), amount, contrast }
    const gr = o.grade || {};
    const chroma = (hex, k) => {
      if (!hex) return [0, 0, 0];
      const cc = c(hex);
      const l = cc.r * 0.299 + cc.g * 0.587 + cc.b * 0.114;
      return [(cc.r - l) * k, (cc.g - l) * k, (cc.b - l) * k];
    };
    g.R.gradeU.uShadowTint.value.set(...chroma(gr.shadows, (gr.amount ?? 0.2) * (gr.shadowAmount ?? 1)));
    g.R.gradeU.uHighTint.value.set(...chroma(gr.highlights, (gr.amount ?? 0.2) * (gr.highAmount ?? 1)));
    g.R.gradeU.uContrast.value = gr.contrast ?? 0.18;
    this.dustColor = o.dust || this.dustColor;
  }

  // ------------------------------------------------------------- terrain
  // o : { x0, z0, size, res, height(x,z), color(x,z,h,slope)→[r,g,b], mapA, mapB, normalA, normalB, surface }
  terrain(o) {
    const n = o.res + 1;
    const heights = new Float32Array(n * n);
    const step = o.size / o.res;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = o.height(o.x0 + i * step, o.z0 + j * step);
    }
    const hf = new HeightfieldCollider(o.x0, o.z0, o.size, o.res, heights, { surface: o.surface || 'sand' });
    this.game.world.add(hf);
    this.heightfield = hf;
    const pos = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const nrm = new THREE.Vector3();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const k = j * n + i;
        const x = o.x0 + i * step, z = o.z0 + j * step;
        pos[k * 3] = x; pos[k * 3 + 1] = heights[k]; pos[k * 3 + 2] = z;
        hf.normal(x, z, nrm);
        const cc = o.color ? o.color(x, z, heights[k], nrm.y) : [1, 1, 1];
        col[k * 3] = cc[0]; col[k * 3 + 1] = cc[1]; col[k * 3 + 2] = cc[2];
      }
    }
    const idx = [];
    for (let j = 0; j < o.res; j++) {
      for (let i = 0; i < o.res; i++) {
        const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, terrainMaterial({
      mapA: o.mapA, mapB: o.mapB, normalA: o.normalA, normalB: o.normalB,
      scaleA: o.scaleA ?? 0.11, scaleB: o.scaleB ?? 0.07, slopeLo: o.slopeLo ?? 0.62, slopeHi: o.slopeHi ?? 0.8,
    }));
    m.receiveShadow = true;
    m.castShadow = true;
    this.root.add(m);
    this.terrainMesh = m;
    return hf;
  }
  groundY(x, z) {
    const hit = this.game.world.groundBelow(x, 200, z, 400);
    return hit ? hit.point.y : 0;
  }

  // ------------------------------------------------------------- géométrie statique
  // Ajoute une géométrie à fusionner (par matériau)
  add(geo, material, matrix) {
    let list = this.batches.get(material);
    if (!list) { list = []; this.batches.set(material, list); }
    list.push([geo, matrix ? matrix.clone() : null]);
  }
  // Boîte solide : visuel fusionné + collision
  box(pos, size, material, o = {}) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx || 0, o.ry || 0, o.rz || 0));
    const p = new THREE.Vector3(...(pos.isVector3 ? pos.toArray() : pos));
    const s = new THREE.Vector3(...(size.isVector3 ? size.toArray() : size));
    if (material) {
      const geo = o.round ? G.rbox(s.x, s.y, s.z, o.round) : boxUV(s.x, s.y, s.z, o.uvScale ?? 0.5);
      this.add(geo, material, _m.compose(p, q, _v.set(1, 1, 1)));
    }
    if (o.collide !== false) {
      const col = new BoxCollider(p, s.clone().multiplyScalar(0.5), q, { surface: o.surface || 'metal', tag: o.tag, blocksCamera: o.blocksCamera });
      this.game.world.add(col);
      return col;
    }
    return null;
  }
  cylinder(pos, radius, height, material, o = {}) {
    const p = new THREE.Vector3(...(pos.isVector3 ? pos.toArray() : pos));
    if (material) {
      const geo = new THREE.CylinderGeometry(o.top ?? radius, radius, height, o.segments || 24);
      this.add(geo, material, _m.makeTranslation(p.x, p.y + height / 2, p.z));
    }
    if (o.collide !== false) {
      const col = new CylinderCollider(p.x, p.z, p.y, p.y + height, o.colRadius ?? radius, { surface: o.surface || 'rock' });
      this.game.world.add(col);
      return col;
    }
    return null;
  }
  // Maillage statique arbitraire (déjà positionné)
  mesh(geo, material, matrix) { this.add(geo, material, matrix); }

  // Fusion du décor statique. Les matériaux qui ne diffèrent que par leur couleur sont regroupés (la couleur passe
  // dans les sommets), puis chaque groupe est fusionné — découpé en cellules de 64 m quand il est gros, pour que le GPU
  // ne dessine que ce qui est visible (y compris dans la carte d'ombre). Chaque objet reçoit une teinte propre et une
  // base assombrie qui l'ancre au sol.
  finalizeBatches() {
    const CELL = 64;
    const groups = new Map();
    for (const [material, list] of this.batches) {
      if (material.transparent || material.isShaderMaterial || material.isMeshBasicMaterial || material.userData.isGlow) {
        this._addBatch(bake(list, !!material.vertexColors), material);
        continue;
      }
      const sig = materialSignature(material);
      let grp = groups.get(sig);
      if (!grp) { grp = { base: material, entries: [] }; groups.set(sig, grp); }
      for (const [g, m] of list) grp.entries.push([g, m, material.color]);
    }
    for (const grp of groups.values()) {
      // matériau commun : couleur blanche, couleurs de sommet (un matériau déjà à couleurs de sommet, comme
      // celui des rochers, reste tel quel)
      let vmat = grp.base;
      if (!grp.base.vertexColors) {
        vmat = cloneMat(grp.base);
        vmat.color.set(0xffffff);
        vmat.vertexColors = true;
        vmat.userData.shared = false;
        this._ownMaterials = (this._ownMaterials || []).concat(vmat);
      }
      const bakeColor = vmat !== grp.base;
      let verts = 0;
      for (const [g] of grp.entries) verts += g.index ? g.index.count : g.attributes.position.count;
      const split = verts > 60000;
      const cells = new Map();
      for (const entry of grp.entries) {
        const m = entry[1];
        const x = m ? m.elements[12] : 0, z = m ? m.elements[14] : 0;
        const key = split ? Math.floor(x / CELL) + ',' + Math.floor(z / CELL) : 'tout';
        let c = cells.get(key);
        if (!c) { c = []; cells.set(key, c); }
        c.push(entry);
      }
      for (const items of cells.values()) {
        const prepared = items.map(([g, m, color]) => {
          const c = g.index ? g.toNonIndexed() : g.clone();
          if (m) c.applyMatrix4(m);
          shadeObject(c, m, bakeColor ? color : null);
          return [c, null];
        });
        let geo = bake(prepared, true);
        for (const [c] of prepared) c.dispose();
        geo = mergeVertices(geo, 1e-4);
        this._addBatch(geo, vmat);
      }
    }
    this.batches.clear();
  }
  _addBatch(geo, material) {
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  // ------------------------------------------------------------- déclencheurs
  trigger(o) {
    const t = {
      box: o.box ? new THREE.Box3(new THREE.Vector3(...o.box[0]), new THREE.Vector3(...o.box[1])) : null,
      sphere: o.sphere ? { c: new THREE.Vector3(...o.sphere[0]), r: o.sphere[1] } : null,
      once: o.once !== false, fn: o.fn, done: false, inside: false, onExit: o.onExit,
    };
    this.triggers.push(t);
    return t;
  }
  wind(min, max, strength = 9) {
    this.winds.push({ box: new THREE.Box3(new THREE.Vector3(...min), new THREE.Vector3(...max)), strength });
  }
  windAt(p) {
    for (const w of this.winds) if (w.box.containsPoint(p)) return w.strength;
    return 0;
  }
  every(fn) { this.updaters.push(fn); }

  update(dt) {
    const g = this.game;
    this.time += dt;
    if (this.sky) {
      this.sky.position.copy(g.camera.cam.position);
      this.sky.material.uniforms.uTime.value = this.time;
      skyQuality(this.sky, g.R.Q);
    }
    const p = g.player;
    natureU.uPlayer.value.copy(p.pos);
    if (this.fill) {
      // lumière d'appoint décalée de l'axe caméra (évite les reflets « phare »)
      this.fill.position.copy(g.camera.cam.position).add(_v.set(0, 7, 0)).addScaledVector(g.camera.right, 4);
      this.fill.target.position.copy(p.pos).add(_v.set(0, 1, 0));
    }
    this._sunGlare(dt);
    if (this.sun) {
      // contre-jour : la caméra regarde vers le soleil, Kobi lui tourne le dos → appoint (part du soleil, sans pi)
      const f = g.camera.cam.getWorldDirection(_v).setY(0).normalize().dot(_wv.copy(this.sunDir).setY(0).normalize());
      const k = this.charLight * (0.3 + 0.7 * THREE.MathUtils.smoothstep(f, -0.2, 0.7)) / Math.PI;
      globalU.uCharLight.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * k);
      // ombre centrée sur Kobi, accrochée à la grille de texels dans le repère de la lumière (pas de scintillement)
      const center = _v.copy(p.pos);
      const texel = (34 * 2) / this.sun.shadow.mapSize.x;
      if (!this._lightX) {
        this._lightX = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.sunDir).normalize();
        this._lightY = new THREE.Vector3().crossVectors(this.sunDir, this._lightX);
      }
      const lx = center.dot(this._lightX), ly = center.dot(this._lightY);
      center.addScaledVector(this._lightX, Math.round(lx / texel) * texel - lx).addScaledVector(this._lightY, Math.round(ly / texel) * texel - ly);
      this.sun.target.position.copy(center);
      this.sun.position.copy(center).addScaledVector(this.sunDir, 100);
    }
    if (p.alive) {
      for (const t of this.triggers) {
        if (t.done) continue;
        const inside = t.box ? t.box.containsPoint(p.pos) : t.sphere.c.distanceTo(p.pos) < t.sphere.r;
        if (inside && !t.inside) {
          t.fn && t.fn();
          if (t.once) t.done = true;
        } else if (!inside && t.inside && t.onExit) t.onExit();
        t.inside = inside;
      }
    }
    for (const u of this.updaters) u(dt, this.time);
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].t) { const tm = this.timers[i]; this.timers.splice(i, 1); tm.fn(); }
    }
    // courants ascendants visibles
    for (const w of this.winds) {
      if (Math.random() < dt * 30) {
        const b = w.box;
        const q = _v.set(THREE.MathUtils.lerp(b.min.x, b.max.x, Math.random()), b.min.y + Math.random() * 3, THREE.MathUtils.lerp(b.min.z, b.max.z, Math.random()));
        if (q.distanceTo(g.camera.cam.position) < 70) g.fx.puff(q, _wv.set(0, w.strength * 1.6, 0), { life: 1.6, size: 0.4, size1: 0.1, color: WHITE, alpha: 0.5, tile: 0 });
      }
    }
  }

  // Reflet du soleil : position écran + occultation par le décor
  _sunGlare(dt) {
    const g = this.game;
    const gu = g.R.gradeU;
    if (!this.sunDir || this.noGlare) { gu.uSunVis.value = 0; g.R.raysU.uStrength.value = 0; return; }
    const cam = g.camera.cam;
    const p = _v.copy(cam.position).addScaledVector(this.sunDir, 900).project(cam);
    let target = 0;
    if (p.z < 1 && Math.abs(p.x) < 1.3 && Math.abs(p.y) < 1.3) {
      target = this.glare ?? 0.9;
      this._glareT = (this._glareT || 0) - dt;
      if (this._glareT <= 0) {
        this._glareT = 0.1;
        this._glareHit = !!g.world.raycast(cam.position, this.sunDir, 400);
      }
      if (this._glareHit) target = 0;
      target *= 1 - Math.min(1, Math.hypot(p.x, p.y) * 0.45);
    }
    if (p.z < 1) gu.uSunUV.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    gu.uSunVis.value += (target - gu.uSunVis.value) * Math.min(1, dt * 6);
    gu.uSunCol.value.copy(this.sun.color);
    // rayons volumétriques : même position, visibilité plus large (le soleil peut être hors champ)
    const ru = g.R.raysU;
    ru.uSunUV.value.copy(gu.uSunUV.value);
    const off = Math.max(0, Math.hypot(p.x, p.y) - 1) ;
    const rv = p.z < 1 ? (this.rays ?? 0.5) * Math.max(0, 1 - off * 0.8) * (this._glareHit ? 0.75 : 1) : 0;
    ru.uStrength.value += (rv - ru.uStrength.value) * Math.min(1, dt * 4);
    ru.uColor.value.copy(this.sun.color);
  }

  // fn appelée quand le niveau est déchargé (rendre ce qu'on a emprunté au joueur, par exemple)
  onDispose(fn) { (this._onDispose || (this._onDispose = [])).push(fn); }
  dispose() {
    const g = this.game;
    for (const f of this._onDispose || []) f();
    if (this.shadows) this.shadows.detach(this);
    if (this.volumetric) this.volumetric.detach(this);
    g.scene.remove(this.root);
    // libère géométries, matériaux et textures propres au niveau (les ressources en cache sont conservées)
    const geos = new Set(), mats = new Set(), texs = new Set();
    this.root.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) geos.add(o.geometry);
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) {
        if (m.userData && m.userData.shared) continue;
        mats.add(m);
        for (const k of ['map', 'emissiveMap']) if (m[k] && !m[k].userData.shared) texs.add(m[k]);
      }
      if (o.isLight && o.dispose) o.dispose();
    });
    for (const x of geos) x.dispose();
    for (const x of mats) x.dispose();
    for (const x of texs) x.dispose();
    lights.clear();
    probes.clear();
    g.scene.fog = null;
    g.scene.environment = null;
    if (this.envRT) this.envRT.dispose();
  }
}

// Boîte avec UV proportionnels à la taille (textures répétées sans étirement)
const boxCache = new Map();
export function boxUV(w, h, d, s = 0.5) {
  const key = `${w}|${h}|${d}|${s}`;
  if (boxCache.has(key)) return boxCache.get(key);
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const n = g.attributes.normal;
  for (let i = 0; i < uv.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let su, sv;
    if (nx > 0.5) { su = d; sv = h; } else if (ny > 0.5) { su = w; sv = d; } else { su = w; sv = h; }
    uv.setXY(i, uv.getX(i) * su * s, uv.getY(i) * sv * s);
  }
  g.userData.shared = true;
  boxCache.set(key, g);
  return g;
}
// Teinte propre à l'objet (petite variation de valeur et de chaleur) et base assombrie (occlusion de contact)
// Signature d'un matériau, couleur exclue : deux matériaux de même signature peuvent être fusionnés
function materialSignature(m) {
  const u = m.userData;
  return [m.type, m.roughness, m.metalness, m.emissive && m.emissive.getHex(), m.emissiveIntensity, m.map && m.map.uuid, m.normalMap && m.normalMap.uuid,
    m.side, m.flatShading, m.vertexColors, m.sheen, m.sheenColor && m.sheenColor.getHex(), u.rimMul && u.rimMul.value, m.customProgramCacheKey ? m.customProgramCacheKey() : '',
    m.alphaTest, m.opacity, u.sig || ''].join('|');
}
function shadeObject(geo, m, baseColor) {
  const pos = geo.attributes.position;
  const n = pos.count;
  let col = geo.attributes.color;
  if (!col) { col = new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3); geo.setAttribute('color', col); }
  const x = m ? m.elements[12] : 0, y = m ? m.elements[13] : 0, z = m ? m.elements[14] : 0;
  const h1 = fract(Math.sin(x * 12.9898 + y * 4.1414 + z * 78.233) * 43758.5453);
  const h2 = fract(Math.sin(x * 39.346 + z * 11.135 + y * 7.77) * 24634.6345);
  const v = 0.92 + h1 * 0.12;
  const warm = (h2 - 0.5) * 0.05;
  const br = baseColor ? baseColor.r : 1, bg = baseColor ? baseColor.g : 1, bb = baseColor ? baseColor.b : 1;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { const py = pos.getY(i); if (py < minY) minY = py; if (py > maxY) maxY = py; }
  const hgt = maxY - minY;
  const span = Math.min(hgt, 2.5);
  for (let i = 0; i < n; i++) {
    let ao = 1;
    if (hgt > 0.45) {
      const t = Math.min(1, (pos.getY(i) - minY) / span);
      ao = 0.62 + 0.38 * t * t * (3 - 2 * t);
    }
    const k = v * ao;
    col.setXYZ(i, col.getX(i) * br * k * (1 + warm), col.getY(i) * bg * k, col.getZ(i) * bb * k * (1 - warm));
  }
  col.needsUpdate = true;
}
const fract = (v) => v - Math.floor(v);
