// Se ejecuta en cada despliegue (npm run build). Genera un identificador único del despliegue y lo
// escribe en common.js, version.json y en los <script src="common.js?v=..."> de los HTML.
// Así la app detecta sola que hay una versión nueva, sin tener que subir números a mano.
import fs from 'node:fs';
const build = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 12) || String(Date.now());

let common = fs.readFileSync('common.js', 'utf8');
if (!/const HVAC_BUILD = '[^']*';/.test(common)) throw new Error('common.js no tiene HVAC_BUILD');
common = common.replace(/const HVAC_BUILD = '[^']*';/, `const HVAC_BUILD = '${build}';`);
fs.writeFileSync('common.js', common);

const v = JSON.parse(fs.readFileSync('version.json', 'utf8'));
v.build = build;
fs.writeFileSync('version.json', JSON.stringify(v, null, 2) + '\n');

for (const f of ['index.html', 'tecnico.html']) {
  if (!fs.existsSync(f)) continue;
  const h = fs.readFileSync(f, 'utf8').replace(/common\.js\?v=[^"']*/g, `common.js?v=${build}`);
  fs.writeFileSync(f, h);
}
console.log('[stamp-build] build =', build);
