import { build } from 'esbuild';
import fs from 'node:fs';
await build({entryPoints:['src/app.js'],bundle:true,format:'iife',outfile:'dist/app.js',minify:true,legalComments:'eof'});
const html=fs.readFileSync('dist/index.html','utf8');
const standalone=html.replace('<link rel="stylesheet" href="style.css">',()=>`<style>${fs.readFileSync('dist/style.css','utf8')}</style>`).replace('<script type="module" src="app.js"></script>',()=>`<script>${fs.readFileSync('dist/app.js','utf8').replaceAll('</script','<\\/script')}</script>`);
fs.writeFileSync('Ground Control.html',standalone);
console.log('Built static app and standalone offline game.');
