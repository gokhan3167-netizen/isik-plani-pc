// Kütüphaneleri ve yazı tiplerini uygulamanın içine kopyalar (internetsiz çalışma için).
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
const out = 'www/vendor';
mkdirSync(out + '/fonts/files', { recursive: true });
cpSync('node_modules/jspdf/dist/jspdf.umd.min.js', out + '/jspdf.umd.min.js');
cpSync('node_modules/jszip/dist/jszip.min.js', out + '/jszip.min.js');
let css = '';
for (const [pkg, weights] of [['barlow', [400, 500, 600]], ['barlow-condensed', [500, 600, 700]]]) {
  const base = `node_modules/@fontsource/${pkg}`;
  for (const w of weights) css += readFileSync(`${base}/${w}.css`, 'utf8') + '\n';
  cpSync(`${base}/files`, out + '/fonts/files', { recursive: true });
}
writeFileSync(out + '/fonts/fonts.css', css);
console.log('vendor: kütüphaneler ve yazı tipleri kopyalandı');
