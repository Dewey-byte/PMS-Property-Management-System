# /// script
# requires-python = ">=3.10"
# dependencies = ["edge-tts"]
# ///
"""Speaks each line of script.json with a female neural voice, one mp3 per line, into audio/vo/.

Run from the project folder:  uv run hotel-pms/audio/tts.py [voice]
The text of each line is sent to Microsoft's online speech service (that is how edge-tts works).
"""
import asyncio
import json
import sys
from pathlib import Path

import edge_tts

HERE = Path(__file__).parent
VOICE = sys.argv[1] if len(sys.argv) > 1 else "en-PH-RosaNeural"
RATE = "+0%"  # the voice's natural pace; shorten the script rather than speeding the voice up


async def main() -> None:
    voices = {v["ShortName"]: v for v in await edge_tts.list_voices()}
    if VOICE not in voices:
        near = sorted(n for n in voices if n.startswith("en-") and voices[n]["Gender"] == "Female")
        raise SystemExit(f"voice {VOICE!r} not found. Female English voices: {', '.join(near)}")
    print(f"voice: {VOICE} ({voices[VOICE]['Gender']}, {voices[VOICE]['Locale']})")

    out = HERE / "vo"
    out.mkdir(exist_ok=True)
    for line in json.loads((HERE / "script.json").read_text(encoding="utf-8")):
        path = out / f"{line['id']}.mp3"
        await edge_tts.Communicate(line["text"], VOICE, rate=RATE).save(str(path))
        print("saved", path.name)


asyncio.run(main())
