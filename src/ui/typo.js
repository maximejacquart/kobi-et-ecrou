// Typographie française automatique : espaces insécables avant ; : ! ? », après «, entre les milliers, et avant %.
// On ne fait que remplacer des espaces existantes (la longueur du texte ne change pas : la machine à écrire
// des dialogues continue de compter juste).
const RULES = [
  [/ ([!?;»])/g, ' $1'],
  [/ :/g, ' :'],
  [/« /g, '« '],
  [/(\d) (?=\d{3}(?!\d))/g, '$1 '],
  [/(\d) %/g, '$1 %'],
];
function typo(s) {
  let t = s;
  for (const [r, w] of RULES) t = t.replace(r, w);
  return t;
}
function fixNode(n) {
  if (n.nodeType === 3) {
    const p = n.parentNode;
    if (p && (p.nodeName === 'STYLE' || p.nodeName === 'SCRIPT' || p.nodeName === 'TEXTAREA')) return;
    const v = n.nodeValue;
    if (v && v.length > 2) {
      const f = typo(v);
      if (f !== v) n.nodeValue = f;
    }
  } else if (n.nodeType === 1) {
    for (let c = n.firstChild; c; c = c.nextSibling) fixNode(c);
  }
}
export function installTypography(root = document.body) {
  fixNode(root);
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'characterData') fixNode(r.target);
      else for (const n of r.addedNodes) fixNode(n);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
