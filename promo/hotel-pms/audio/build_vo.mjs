// Builds audio/vo.wav: each spoken line is trimmed to its speech, levelled, and placed so its first
// word lands on a chosen beat of the grid (beats.json). Also writes vo_phrases.json (when each line
// is actually being said), which the film uses to time its supers.
//   node hotel-pms/audio/build_vo.mjs        (from the promo folder)
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILM = path.dirname(HERE);
const TMP = path.join(HERE, '_tmp');
mkdirSync(TMP, { recursive: true });

const grid = JSON.parse(readFileSync(path.join(FILM, 'beats.json'), 'utf8'));
const script = JSON.parse(readFileSync(path.join(HERE, 'script.json'), 'utf8'));
const DURATION = JSON.parse(readFileSync(path.join(FILM, 'film.json'), 'utf8')).duration;

// beat number each line begins on (see docs/shotlist.md)
const ONSET_BEAT = { v1: 1, v2: 11, v3: 24, v4: 37, v5: 47, v6: 58, v7: 67, v8: 81 };

const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr); process.exit(1); }
  return r.stdout;
};

// trim silence at both ends, then a gentle voice chain: rumble out, a little presence, even level
const trim = (t) => `silenceremove=start_periods=1:start_threshold=-42dB:start_silence=${t}`;
const chain = [
  trim(0.02), 'areverse', trim(0.14), 'areverse',
  'highpass=f=90',
  'equalizer=f=3200:t=q:w=1.1:g=1.8',
  'acompressor=threshold=-22dB:ratio=2.6:attack=8:release=120:makeup=3',
  'loudnorm=I=-18:TP=-2.5:LRA=6',
  'aresample=48000',
].join(',');

const placed = [];
for (const line of script) {
  const out = path.join(TMP, `${line.id}.wav`);
  run('ffmpeg', ['-v', 'error', '-y', '-i', path.join(HERE, 'vo', `${line.id}.mp3`), '-af', chain, '-ac', '1', '-ar', '48000', out]);
  const len = Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).trim());
  const beat = ONSET_BEAT[line.id];
  const start = grid.beats[beat];
  placed.push({ id: line.id, text: line.text, beat, start: +start.toFixed(3), end: +(start + len).toFixed(3), length: +len.toFixed(3), file: out });
}

// gaps between lines, and how much room is left at the end
placed.forEach((p, i) => {
  const next = placed[i + 1];
  const gap = next ? next.start - p.end : DURATION - p.end;
  console.log(`${p.id}  beat ${String(p.beat).padStart(2)}  ${p.start.toFixed(2)}-${p.end.toFixed(2)} s  (${p.length.toFixed(2)} s)  ${next ? 'gap' : 'tail'} ${gap.toFixed(2)} s`);
  if (gap < 0.15) { console.error(`  ${p.id} runs into the next line`); process.exitCode = 1; }
});
if (process.exitCode) process.exit(1);

// put every line on a silent canvas at its start time
const inputs = placed.flatMap((p) => ['-i', p.file]);
const delays = placed.map((p, i) => `[${i}:a]adelay=${Math.round(p.start * 1000)}:all=1[d${i}]`);
const graph = `${delays.join(';')};${placed.map((_, i) => `[d${i}]`).join('')}amix=inputs=${placed.length}:normalize=0:duration=longest,apad=whole_dur=${DURATION},atrim=0:${DURATION},aformat=channel_layouts=stereo[out]`;
run('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-map', '[out]', '-ar', '48000', path.join(HERE, 'vo.wav')]);

writeFileSync(path.join(HERE, 'vo_phrases.json'), JSON.stringify(placed.map(({ file, ...p }) => p), null, 1));
console.log('wrote vo.wav and vo_phrases.json');
