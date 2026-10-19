// Rayons de soleil (crépusculaires) : flou radial, à demi-résolution, d'un disque solaire masqué par la profondeur
// de la scène (celle de la passe d'occlusion ambiante) — le décor découpe les rayons, les néons n'en émettent pas.
// La passe ne coûte rien quand le soleil n'est pas visible (aucune copie d'image).
import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export class SunRaysPass extends Pass {
  constructor() {
    super();
    // réglés par le niveau : position du soleil à l’écran, force (selon sa visibilité) et couleur
    this.uniforms = {
      uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
      uStrength: { value: 0 },
      uColor: { value: new THREE.Color(1, 0.9, 0.7) },
    };
    this.depthTexture = null;
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.raysMat = new THREE.ShaderMaterial({
      uniforms: {
        tDepth: { value: null }, uSunUV: this.uniforms.uSunUV, uAspect: { value: 1 },
        uDecay: { value: 0.955 }, uDensity: { value: 0.9 }, uDisc: { value: 0.1 },
      },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform vec2 uSunUV;
        uniform float uAspect, uDecay, uDensity, uDisc;
        varying vec2 vUv;
        const int SAMPLES = 40;
        float source(vec2 uv) {
          float sky = step(0.99999, texture2D(tDepth, uv).x);
          vec2 q = (uv - uSunUV) * vec2(uAspect, 1.0);
          return sky * exp(-dot(q, q) / (uDisc * uDisc));
        }
        void main() {
          vec2 delta = (vUv - uSunUV) * (uDensity / float(SAMPLES));
          float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
          vec2 uv = vUv - delta * jitter;
          float illum = 1.0, acc = 0.0;
          for (int i = 0; i < SAMPLES; i++) {
            uv -= delta;
            acc += source(clamp(uv, 0.0, 1.0)) * illum;
            illum *= uDecay;
          }
          gl_FragColor = vec4(vec3(acc / float(SAMPLES)), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.compMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, tRays: { value: this.rt.texture }, uStrength: this.uniforms.uStrength, uColor: this.uniforms.uColor, uSunUV: this.uniforms.uSunUV, uAspect: { value: 1 } },
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse, tRays;
        uniform float uStrength, uAspect;
        uniform vec3 uColor;
        uniform vec2 uSunUV;
        varying vec2 vUv;
        void main() {
          vec4 base = texture2D(tDiffuse, vUv);
          float r = texture2D(tRays, vUv).r;
          float fall = 1.0 - smoothstep(0.0, 1.2, length((vUv - uSunUV) * vec2(uAspect * 0.9, 1.0)));
          gl_FragColor = vec4(base.rgb + uColor * r * uStrength * (0.9 + 1.4 * fall), base.a);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.fsq = new FullScreenQuad(null);
  }
  setSize(w, h) {
    this.rt.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    this.raysMat.uniforms.uAspect.value = this.compMat.uniforms.uAspect.value = w / Math.max(1, h);
  }
  render(renderer, writeBuffer, readBuffer) {
    if (this.uniforms.uStrength.value < 0.002 || !this.depthTexture) { this.needsSwap = false; return; }
    this.needsSwap = true;
    this.raysMat.uniforms.tDepth.value = this.depthTexture;
    renderer.setRenderTarget(this.rt);
    this.fsq.material = this.raysMat;
    this.fsq.render(renderer);
    this.compMat.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.material = this.compMat;
    this.fsq.render(renderer);
  }
  dispose() {
    this.rt.dispose();
    this.raysMat.dispose();
    this.compMat.dispose();
    this.fsq.dispose();
  }
}
