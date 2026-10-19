// Calcule les bruitages hors du fil principal et renvoie les tampons au fur et à mesure.
import { renderSet } from './render.js';

self.onmessage = ({ data: { keys, sr } }) => {
  for (const key of keys) {
    const set = renderSet(key, sr);
    self.postMessage({ key, set }, set.map((x) => x.buffer));
  }
};
