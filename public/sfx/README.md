# Custom Sound Files

## Bundled sounds & attribution

The sounds currently shipping in this folder come from Wikimedia Commons:

| File | Source | License |
|---|---|---|
| `goal.mp3` | "F1-Race-Crowd-Applause-Air-Horns" by **WebbFilmsUK** (Wikimedia Commons) | CC BY 4.0 |
| `whistle.mp3` | "referee-whistle-blow-gymnasium" by splicesound (Wikimedia Commons) | CC0 |
| `demo.mp3` | "Explosion 10" (Wikimedia Commons) | Public Domain |
| `save.mp3` | "Dull thud" (Wikimedia Commons) | Public Domain |
| `epic.mp3` | "Horn stab" (Wikimedia Commons) | CC0 |

All clips were trimmed / loudness-normalized. The CC BY 4.0 clip requires this
attribution to stay in the repo.

## Adding your own (optional)

The game plays synthesized sounds by default. To use real audio files instead,
put them in this folder and create a `manifest.json` that maps sound keys to
filenames. Every key is optional — anything missing falls back to the built-in synth.

⚠️ Only use audio you are allowed to publish (own recordings, CC0/royalty-free
sounds e.g. from freesound.org or pixabay.com). Do NOT upload ripped game audio
from Rocket League — the site is public and that's Psyonix/Epic's copyright.

## Example `manifest.json`

```json
{
  "goal": "goal.mp3",
  "shot": "shot.mp3",
  "save": "save.mp3",
  "epic": "epic-save.mp3",
  "demo": "demo.mp3",
  "boost": "boost-loop.mp3",
  "hit": "ball-hit.mp3",
  "bounce": "bounce.mp3",
  "pad-big": "pad-big.mp3",
  "pad-small": "pad-small.mp3",
  "count": "count-beep.mp3",
  "go": "go.mp3",
  "whistle": "whistle.mp3",
  "announce-shot": "voice-shot-on-goal.mp3",
  "announce-save": "voice-what-a-save.mp3",
  "announce-epic": "voice-epic-save.mp3",
  "announce-goal": "voice-goal.mp3",
  "announce-t30": "voice-30-seconds.mp3",
  "announce-ot": "voice-overtime.mp3",
  "announce-win-blue": "voice-blue-wins.mp3",
  "announce-win-orange": "voice-orange-wins.mp3",
  "announce-10": "voice-10.mp3",
  "announce-9": "voice-9.mp3",
  "announce-8": "voice-8.mp3",
  "announce-7": "voice-7.mp3",
  "announce-6": "voice-6.mp3",
  "announce-5": "voice-5.mp3",
  "announce-4": "voice-4.mp3",
  "announce-3": "voice-3.mp3",
  "announce-2": "voice-2.mp3",
  "announce-1": "voice-1.mp3"
}
```

## Notes

- Keys with `announce-` prefix are the announcer voice lines; they replace the
  browser text-to-speech when present.
- `boost` should be a short seamless loop (it plays while boosting).
- MP3, WAV and OGG all work (anything the browser can decode).
- After adding files: commit + push, Vercel redeploys automatically.
