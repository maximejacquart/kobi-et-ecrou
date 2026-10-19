// Worker de sculpture : reçoit des primitives préparées, renvoie les tableaux du maillage (transférés sans copie).
import { meshPrims } from './sculptCore.js';

self.onmessage = (ev) => {
  const { prims, pal, opts } = ev.data;
  const r = meshPrims(prims, pal, opts);
  self.postMessage(r, [r.position.buffer, r.normal.buffer, r.color.buffer, r.surf.buffer, r.coat.buffer, r.skinIndex.buffer, r.skinWeight.buffer, r.index.buffer]);
};
