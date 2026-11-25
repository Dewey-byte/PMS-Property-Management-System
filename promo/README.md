# Hotel PMS promo film

A 62 second, 16:9 film about the app: the hotel's desktop screens and the guest's phone screens, with a
female voice-over and a soft synthesized music bed. It is drawn in code (a canvas that is a pure
function of time) and rendered frame by frame. Every screen in it is a real capture of the running app.

```
promo/
  capture.mjs              drives the real app with Playwright and saves the screens + where things are (anchors.json)
  tools/sheet.mjs          contact sheets of captures or stills, for reviewing
  hotel-pms/
    film.js                the film: every shot on the beat grid (92 bpm), HITS = every accent that gets a sound
    beats.json             the measured beat grid
    audio/script.json      the narration, one line per clip
    audio/tts.py           speaks each line (Microsoft's online speech service, voice en-PH-RosaNeural)
    audio/build_vo.mjs     trims each clip and places its first word on a beat -> vo.wav, vo_phrases.json
    assets/shots/          the captures (31 screens) and anchors.json
    docs/shotlist.md       the approved shot list;  docs/critique.md  the review rounds
  out/hotel-pms/           renders (ignored by git): final.mp4, contact sheets, poster.png
```

## Rebuild

Needs Node 20+, Playwright's Chromium, ffmpeg and uv. Run everything from this folder. `<skill>` is the
motion-reel skill's `scripts` folder.

```bash
npm install

# 1. recapture the screens (start the app on a freshly seeded copy first; see the header of capture.mjs)
node capture.mjs

# 2. voice: speak each line, then place them on the beat grid
uv run hotel-pms/audio/tts.py
node hotel-pms/audio/build_vo.mjs

# 3. picture, sound, mix
node <skill>/render.mjs --film hotel-pms --format 16x9 --video-only
node <skill>/sfx.mjs hotel-pms
node <skill>/mix.mjs hotel-pms          # masters to -14 LUFS and writes out/hotel-pms/final.mp4
node <skill>/render.mjs --film hotel-pms --poster
```

To preview while editing, serve this folder and open `hotel-pms/index.html` (space plays, arrows step).
