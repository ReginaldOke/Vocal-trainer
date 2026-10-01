# Vocal Coach, simplified

One screen: your voice drawn as a line, green when it sits on a note. Three buttons.

- **Record** a take, then look at it closely: green on the note, amber close, red off, thicker where louder. Zoom and scrub.
- **Lesson** opens four short lessons: warm up, pitch workout, long notes, hear it and sing it back.
- **Song** opens six example songs to sing along with, plus "Import a song" for any tune you have as a MIDI file.

Songs and exercises run in time with a count-in while the piano plays the tune, so nothing waits on the app guessing when a note was sung. The key follows where your voice sits and can be nudged lower or higher; there is a slow speed and a listen-first option.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5174. Add `?silent` to the address to mute every sound the app makes, and `?fakemic` to drive it without a microphone when testing.

## What is here

| File | What it does |
| --- | --- |
| `src/App.tsx` | The one screen, the three buttons, lessons and songs |
| `src/Stage.tsx` | The pitch picture |
| `src/Review.tsx` | The zoomable look at a recording |
| `src/sing.ts` | Scores a run through a song |
| `src/songs.ts` | The songs, the exercises, and laying them out in time |
| `src/midi.ts` | Reads a MIDI file into a song |
| `src/glide.ts` | Judges a siren slide |
| `src/audio/` | Microphone and pitch tracking, the noise gate, the piano |

The full earlier app is the parent folder, saved at the git tag `v1-full`.
