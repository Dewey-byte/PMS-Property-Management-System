// Builds a labelled-by-order contact sheet of screenshots, for studying where things are.
//   node tools/sheet.mjs <out.png> <tile height> <tiles per row> <name> <name> ...   (names from hotel-pms/assets/shots)
import { spawnSync } from 'node:child_process';

const [out, height, perRow, ...names] = process.argv.slice(2);
const per = Number(perRow);
const inputs = names.flatMap((n) => ['-i', `hotel-pms/assets/shots/${n}.png`]);
const scale = names.map((_, i) => `[${i}:v]scale=-1:${height}[a${i}]`);
const rows = [];
for (let r = 0; r < names.length; r += per) {
  const idx = names.map((_, i) => i).slice(r, r + per);
  rows.push(`${idx.map((i) => `[a${i}]`).join('')}hstack=inputs=${idx.length}[r${r / per}]`);
}
// every row padded to the widest so vstack accepts them
const stack = rows.length > 1 ? `;${rows.map((_, i) => `[r${i}]`).join('')}vstack=inputs=${rows.length}:shortest=0[final]` : '';
const graph = `${scale.join(';')};${rows.join(';')}${stack}`;
const last = rows.length > 1 ? '[final]' : '[r0]';
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', last, out], { encoding: 'utf8' });
if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
console.log('wrote', out);
