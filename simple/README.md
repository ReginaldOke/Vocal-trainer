# Vocal Coach

A practice partner for singing: your voice drawn as a line, green when it sits on a note. Made to sit beside any lesson, with a teacher or alone.

- **Tap any note** on the screen to hear it on the piano.
- **Record** a take, then look at it closely: green on the note, amber close, red off, thicker where louder. Drag, pinch, tap to play from a spot.
- **Lesson**: warm up, pitch workout, long notes, match a note.
- **Song**: six songs, or import your own as a MIDI file.

Lessons and songs go a line at a time. The piano plays a chord, then the line; then the chord again and it is your turn, with nothing playing over your voice. The transport steps between lines, pauses, and repeats a line for as long as you like. Minus and plus move the key.

There are no scores, levels or characters. The only words on screen are the ones needed to use it.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5174. Add `?silent` to the address to mute every sound the app makes, and `?fakemic` to drive it without a microphone when testing.

## What is here

| File | What it does |
| --- | --- |
| `src/App.tsx` | The one screen, the three buttons, lessons, songs and the transport |
| `src/Stage.tsx` | The pitch picture, and tapping a note |
| `src/Review.tsx` | The zoomable look at a recording |
| `src/sing.ts` | Compares what was sung with the line |
| `src/songs.ts` | The songs and exercises, split into lines to hear and sing back |
| `src/midi.ts` | Reads a MIDI file into a song |
| `src/glide.ts` | Follows a slide of the voice |
| `src/audio/` | Microphone and pitch tracking, the noise gate, the piano |
| `public/piano/` | Recorded piano notes |

## Credits

The piano is the Salamander Grand Piano V3 by Alexander Holm, used under the Creative Commons Attribution 3.0 licence. See `public/piano/CREDITS.txt`.

The earlier, larger app is the parent folder, saved at the git tag `v1-full`.
