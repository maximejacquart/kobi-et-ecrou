// Sous l'eau : quand la caméra passe sous une surface, l'image prend la teinte du plan d'eau, se noie dans un
// brouillard bleu selon la distance (jusqu'au décor ou jusqu'à la surface vue d'en dessous) et ondule.
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { frameU } from '../frame.js';

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tSceneDepth;
uniform mat4 uInvProj, uInvView;
uniform float uCamNear, uCamFar, uTime, uLevel, uDensity;
uniform vec3 uColor, uAbsorb;
varying vec2 vUv;
void main() {
  vec2 uv = vUv + vec2(sin(vUv.y * 22.0 + uTime * 2.1), cos(vUv.x * 18.0 + uTime * 1.7)) * 0.0025;
  vec3 col = texture2D(tDiffuse, uv).rgb;
  float d = texture2D(tSceneDepth, uv).x;
  vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vp.xyz /= vp.w;
  vec3 wp = (uInvView * vec4(vp.xyz, 1.0)).xyz;
  vec3 cam = (uInvView * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 ray = wp - cam;
  float dist = length(ray);
  vec3 dir = ray / max(dist, 1e-4);
  // la surface, vue d'en dessous, arrête aussi le brouillard
  if (dir.y > 0.0) dist = min(dist, (uLevel - cam.y) / dir.y);
  vec3 T = exp(-uAbsorb * dist * 0.35);
  float fog = 1.0 - exp(-dist * uDensity);
  col = mix(col * T, uColor, fog);
  // lumière qui tombe de la surface : plus clair vers le haut
  col *= 0.8 + 0.4 * smoothstep(-0.3, 0.6, dir.y);
  gl_FragColor = vec4(col, 1.0);
}`;

export class UnderwaterPass extends Pass {
  constructor() {
    super();
    this.name = 'sous-eau';
    this.enabled = false;
    this.needsSwap = true;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tSceneDepth: frameU.tSceneDepth, uInvProj: frameU.uInvProj, uInvView: frameU.uInvView,
        uCamNear: frameU.uCamNear, uCamFar: frameU.uCamFar, uTime: { value: 0 }, uLevel: { value: 0 }, uDensity: { value: 0.08 },
        uColor: { value: new THREE.Color('#0a4050') }, uAbsorb: { value: new THREE.Vector3(0.4, 0.1, 0.06) },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false, depthWrite: false,
    });
    this.fsq = new FullScreenQuad(this.mat);
  }
  render(renderer, writeBuffer, readBuffer) {
    this.mat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }
  dispose() { this.mat.dispose(); this.fsq.dispose(); }
}
