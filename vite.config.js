import { defineConfig } from 'vite';

// version « fichier unique » (npm run release) : le script et le style sont inscrits dans la page, qui s'ouvre alors
// d'un double-clic, sans serveur
function singleFile() {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 'fichier-unique',
    enforce: 'post',
    generateBundle(_, bundle) {
      const html = bundle['index.html'];
      let src = html.source;
      for (const f of Object.values(bundle)) {
        if (f.type === 'chunk' && f.isEntry) {
          const code = f.code.replace(/<\/script/gi, '<\\/script');
          src = src.replace(new RegExp(`<script[^>]*src="[^"]*${esc(f.fileName)}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[f.fileName];
        } else if (f.fileName.endsWith('.css')) {
          src = src.replace(new RegExp(`<link[^>]*href="[^"]*${esc(f.fileName)}"[^>]*>`), () => `<style>${f.source}</style>`);
          delete bundle[f.fileName];
        }
      }
      html.source = src;
    },
  };
}

export default defineConfig(({ mode }) => ({
  // chemins relatifs : la version construite marche aussi dans un sous-dossier (GitHub Pages)
  base: './',
  resolve: { dedupe: ['three'] },
  optimizeDeps: { include: ['three', 'opentype.js'] },
  build: mode === 'release'
    ? { outDir: 'release', chunkSizeWarningLimit: 20000, target: 'es2022', cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } }
    : { chunkSizeWarningLimit: 3000, target: 'es2022' },
  plugins: mode === 'release' ? [singleFile()] : [],
  server: { port: 5173 },
}));
