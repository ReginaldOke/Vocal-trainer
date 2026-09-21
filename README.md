# Vocal Coach

A real-time singing coach that runs entirely in the browser. It listens through the microphone, tracks pitch, volume, register and effort, and gives short teacher-style tips while you sing.

You land straight on the **Sing** stage: tap once to open the mic, sing anything, and the line, the note readout and Pip the songbird follow your voice. A "Next up" card suggests the easiest song you have not yet cleared. Four tabs (Sing, Songs, Review, You) hold everything else; settings live in a sheet, and play, results, the assessment and the take review take over the whole screen. The look is a dark take on Brilliant: a modern serif for headlines, Inter for everything else, pill buttons with a pressed edge, tinted illustration tiles, and as little text on screen as possible.

The main event is the **arcade**: songs and drills scroll along a Guitar Hero style highway, your voice is a glowing puck at the hit line, and notes light up green as you sing them in tune. Combos, a score multiplier, a fever mode, star ratings, XP levels and badges reward clean pitch. Everything is saved in the browser.

Two ways to play:

- **Your pace** (default). The song follows your voice, whatever you sing. Each note ends when you start the next one, at any pitch and any volume: a clear jump in pitch, or a breath and a fresh attack. A note you simply hold completes after most of its written length, and the last note ends when you stop. Pitch only affects the score, never whether the song moves on.
- **In tempo.** Notes scroll at the song's speed with a count-in and click track, for singers with headphones.

**Piano chords** play under you by default: a small additive piano (`src/audio/piano.ts`) strikes a diatonic chord chosen for each melody note (`src/game/harmony.ts`, I, IV, V, vi or ii), voiced with your note on top so the pitch is still given. In "your pace" mode the chords follow you, striking when the note changes and pulsing softly while a note waits. Through speakers the backing ducks under your voice and turns itself down if the microphone starts to hear it (`src/audio/backing.ts`); the old single guide tone is still available in Settings, and with headphones either can play at full volume.

**Pip the songbird.** A 3D bird (Three.js, `src/ui/SingerAvatar.tsx`) sings along beside the highway and in the studio: his beak opens with your volume and gapes wider for bright vowels, he stretches up and raises his crest for high notes, flaps his wings when you sing out, frowns and flushes when you push, and a glow ring lights up when you are on target. With headphones on, "Pip sings along" gives him a formant-synth voice that follows your pitch (`src/audio/buddyVoice.ts`).

**Record and review.** Hit Record in free practice (or "Review this take" after a song, or upload any recording) to get a zoomable pitch map of the take: green where it was in tune, amber where it was close, red where it was pitchy, and a ribbon that thickens with volume. Scroll to zoom, drag to pan, click to seek, and jump straight to the worst stretches.

A guided assessment measures your range, then runs a held note, "Happy Birthday" and a five-note scale on the same self-paced highway, and ends with a short practice plan. The report opens with a verdict ("You're a baritone"), five famous singers whose voices sit where yours does, and a chart of your range against about seventy well-known singers (`src/coach/singers.ts`, approximate reported extremes). The measured range also sets the key of every arcade song.

## Run and deploy

```
npm install
npm run dev        # http://localhost:5173 (microphones need localhost or https)
npm run build      # static output in dist/, built for the GitHub Pages path
```

Live at https://reginaldoke.github.io/Vocal-trainer/. Every push to `main` builds and deploys through `.github/workflows/deploy.yml`. There is no backend: audio never leaves the device, so there are no server costs and no privacy or consent work beyond the microphone prompt. (The Vite `base` is set for that path in production; `npm run dev` still serves from `/`.)

## How it is put together

```
src/audio/   pure TypeScript signal processing, no DOM except engine.ts
  pitch.ts     YIN pitch detector with octave-error guards
  spectrum.ts  FFT and harmonic measurements (H1-H2, harmonic weight)
  frame.ts     samples in, one Frame out (pitch, clarity, dB, voice quality)
  analysis.ts  Tracker: held notes, scoops, end-of-note sag, vibrato vs wobble, register, strain, cracks
  engine.ts    Web Audio: microphone or <audio> element into the analyser, plus MediaRecorder
  synth.ts     guide tones
  guide.ts     the adaptive guide tone: follows the target, ducks under the singer, backs off when the mic hears it
  offline.ts   the same analysis over a whole clip, evenly spaced; analysis.worker.ts runs it off the main thread
src/coach/   rules.ts (live tips), exercises.ts (targets and scoring), voiceType.ts, report.ts
src/game/    songs.ts (the library, transposable), scoring.ts (GameRun: flow and tempo modes, combos, fever), progress.ts (localStorage)
src/ui/      Home (the live stage), GameCanvas (the highway), GameScreen (songs, play, results), SettingsSheet, You (level, range, badges), SingerAvatar (Pip), TakeReview (zoomable pitch map), PitchCanvas, Panels
test/        offline.ts runs the same pipeline over a WAV in Node; synth.ts checks vibrato, register and crack detection
```

Development without a microphone: open `http://localhost:5173/?fakemic`. An oscillator stands in for the singer and is exposed as `window.__vc.engine.fake` (set `osc.frequency.value` and `gain.gain.value` from the console).

The per-frame path never touches React state. The canvas draws from refs at 60 fps and the readouts update about 12 times a second.

Check the analysis against any recording:

```
ffmpeg -i take.m4a -ar 48000 -ac 1 -c:a pcm_s16le take.wav
npx tsx test/offline.ts take.wav
npx tsx test/synth.ts
```

## What is measured and what is estimated

Measured directly: pitch, cents from the target, steadiness, slides into notes, sagging note ends, vibrato rate and depth, volume and its evenness.

Estimated from indirect evidence, and labelled as such in the interface:

- **Register (chest, mix, head).** A microphone cannot see the vocal folds. The estimate combines how dominant the fundamental is over the harmonics, compared with the singer's own low chest sound from the range exercise, with where the note sits in their range. Vowels shift the same measurement, so it is most reliable on "ah" and least reliable on closed vowels ("oo", "ee") in the middle of the range.
- **Strain.** Flags the pattern a teacher listens for: high in the range, louder than usual, harmonic-heavy (pressed) tone, and a pitch that turns rough. It is a prompt to check in with your body, not a medical reading.
- **Voice type.** From the comfortable range, weighted toward the low note. Range alone cannot settle it and the report says so.

The microphone is opened with echo cancellation, noise suppression and automatic gain switched off. With them on, browsers flatten the volume and smear the pitch.

Guide tones played through speakers would be picked up by the microphone, so pitch tracking is paused while the starting note sounds. With the headphones option ticked the whole line plays along.

## On a phone

The layout is phone-first below 720px: a bottom tab bar, the stage filling the screen with Pip tucked into a corner, two-column song tiles, and every control at least 44px tall. Safe-area insets and the dynamic viewport height are respected, double-tap zoom is off, and the screen stays awake while the mic is open (where the Wake Lock API exists). The highway and Pip render at a lower pixel ratio with fewer glows on small screens to keep 60 fps. Add it to the home screen and it runs full-screen as a web app.

## Towards iOS

- Quickest: wrap this build with Capacitor (`npx cap add ios`). Add `NSMicrophoneUsageDescription` to Info.plist. WKWebView supports getUserMedia and Web Audio from iOS 14.3.
- A web manifest is included, so "Add to Home Screen" already gives a full-screen app. Add a service worker (for example vite-plugin-pwa) for offline use.
- For a fully native app, `src/audio` (except engine.ts) and `src/coach` have no browser dependencies. Feed `FrameAnalyser.analyse()` 4096-sample blocks from AVAudioEngine through a JS runtime or port the ~500 lines to Swift.

## Ideas for later

- More songs in `src/game/songs.ts`: melodies are semitones from the tonic with beat lengths and syllables, so adding one is a few lines.
- A history screen charting accuracy and scores over time from the saved progress.
- Move analysis to an AudioWorklet for evenly spaced frames if you want finer vibrato analysis.
- A classifier trained on labelled chest and head recordings would beat the hand-tuned register estimate.
