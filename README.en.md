# MMLForge-8

[日本語](README.md) | **English**

[![GitHub Sponsors](https://img.shields.io/badge/GitHub%20Sponsors-Sponsor-EA4AAA?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/TakeshiMaeda)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/spsoft)
[![OFUSE](https://img.shields.io/badge/OFUSE-Support-FF6699)](https://ofuse.me/e73cbb5c/letter)

Write music as text (MML) and hear it right away. A retro-style BGM workbench and playback engine that runs entirely in the browser.

MML (Music Macro Language) is a traditional way of writing music as text, like `t120 l8 cdefgab`.
MMLForge-8 covers writing it, auditioning it, auto-composing it and putting it into games, all in
vanilla JavaScript (Web Audio API) with no build step and no dependencies. It uses no audio files at all.

## Using the editor

Just open `index.html` in a browser. No server, no install.

- **Player** — A line that starts at the left edge is one track (tracks play together for chords and accompaniment).
  A line that starts with a space continues the track above, so a track can span as many lines as you like. Loop playback. Your text is saved automatically.
  Comments are `;` (to the end of the line, also mid-line) and `/* ... */` (can span lines).
  Syntax errors show the line and column in the text area, like `Track 2, line 3, col 5: Unexpected character: "%"`
- **Display language** — Japanese / English. The first time, it follows your browser's language. Switch with the button at the top right (your choice is saved)
- **Channel on/off** — Checkboxes choose which tracks play.
  Switching during playback mutes or unmutes at once, without stopping the song
- **Optimize** — Tidies the selection (or the whole text) into a more readable form: `c8` → `c` where `l8` is in effect (dots stay),
  removes an `l` that repeats the current value, and turns absolute octaves `o5` → `>`
  (removed if it is the same octave; jumps of 3 octaves or more stay as `o`, which reads better than a row of `>`).
  If a part with no `l` has quarter notes, it puts `l4` at the head of the track and drops the numbers (`c4 d4 e4 f4` → `l4 c d e f`).
  **The first `o` in a track is kept** (so the track never leans on the implicit `o4`), and octaves before it are left alone.
  Inside repeats `[ ]` it rewrites only what stays the same on every pass, and at the end it checks that the notes
  have not changed, so the sound never changes
- **Copy for mml.js** — Removes comments, joins continuation lines and copies one line per track.
  For taking a song to `mml.js` in another project (see "Where the editor ends and mml.js begins" below)
- **Auto compose (gacha)** — Generates and plays a song from mood (calm / mystic / intense / dark / bright) × bars × seed.
  Scale (bright or dark), key, tempo, intensity, rhythm channel and harmony can each be overridden.
  The same seed and settings reproduce the same song. The main idea is to finish the result by hand
- **Add accompaniment** — Estimates the key and chord progression from the melody on the first line and generates bass, arpeggio and other accompaniment
- **Extend the melody** — Generates bars that continue the first line's melody and adds them at the end. The key, progression,
  range and intensity are estimated from the melody, and the new bars continue naturally from the last note (extend as often as you like).
  You can also switch to the parallel scale (darker or brighter), shift an octave up or down, build up (more intense each bar) or end with a cadence
- **Mini keyboard** — Play with the mouse or the PC keys (Z row and Q row). Wave, volume and envelope are adjustable
- **Record → MML** — Quantizes the rhythm and melody you play on the keyboard by BPM and shortest note into an MML string
- **Audio → MML (transcription)** — Detects a hummed, whistled or single-instrument melody from the mic or an audio file
  (WAV, MP3, ...) and converts it to MML. Shows the detected note names live while recording. Monophonic only
- **Rhythm pad** — Drumbit-style step input for rhythm. Click cells on a grid of 4 tracks × 16ths × up to 4 bars
  (each track gets an instrument preset such as kick, snare or hi-hat, with fine-tuning of o / v / @e).
  Check it with loop playback, then output MML or insert it into the main text. Tracks whose hits never overlap are merged
  into one channel, and channels split only where hits land on the same step

Note: because of browsers' autoplay rules, sound starts only after your first click or similar action.

## MML notation

| Syntax | Meaning |
|---|---|
| `c d e f g a b` | Notes. Add `#` / `+` for sharp or `-` for flat right after (e.g. `c#` `b-`) |
| Number, dot | Length. `c4` = quarter, `c8` = eighth, `c12` = triplet, `c4.` = dotted quarter (the `l` value when omitted) |
| `r` | Rest (lengths work as for notes) |
| `o4` / `>` / `<` | Set octave / up 1 / down 1 (`a` in `o4` = 440 Hz) |
| `l8` | Default length (default 4) |
| `t140` | Tempo in BPM (default 120; write it in every track) |
| `v0`-`v15` | Volume (default 10) |
| `q1`-`q8` | Gate time. 8 = full length, smaller = more staccato (default 8) |
| `@0`-`@4` | Wave: 0=sine 1=square 2=triangle 3=saw 4=noise (default 1) |
| `@e3,0,100,40` | Envelope: attack (ms), decay (ms), sustain (%), release (ms). Default `@e3,0,100,40` |
| `&` | Tie / slur. Joins to the previous note without a new attack. `c4&c8` = tie (longer), `c4&e4` = slur (only the pitch changes) |
| `m120,5,30` | LFO (vibrato): delay (ms), rate (Hz), depth (cents, ± around the center). Default `m0,0,0` = off |
| `p60` | Portamento. Glides over 60 ms at each `&` joint (no effect without `&`). Default `p0` = instant |
| `@b-200,60` | Bend. Starts 200 cents below (negative = below, positive = above; `@b+200,60` also works) and reaches the pitch in 60 ms. **Applies to the next note only** |
| `[ ... ]3` | Repeat 3 times (can nest). An error if one track expands to more than 1,000,000 notes and rests |
| `[ ... ]` / `[ ... ]0` | No number or 0 = infinite loop: from the second time on, playback repeats from here (for loops with an intro; only at the end of a track) |
| `\|` | Bar line (no effect on playback; for readability) |

- Values of `o` `v` `q` `@` outside the ranges in the table are errors (they are not silently clamped). So is going outside `o0`-`o8` with `>` `<`
- `@e` sustain is a percentage, so 0-100. Anything else is an error

- For noise (`@4`) the pitch moves a band-pass filter, so you can pick drum sounds such as `o3` = kick, `o5` = snare and `o7` = hi-hat
- Noise gets quieter the lower it goes. Gain makes up for the part of the band that the band-pass throws away, but the make-up has
  a limit, and **below about 375 Hz (around `f` in `o4`) it cannot fully compensate** (an `o3` kick is about 4.6 dB quieter,
  `o2` about 7.6 dB). If low drums sound thin, raise `v`
- Notes joined with `&` **sound only once** (the attack, volume and envelope of the first note apply to the whole).
  The `m` delay also counts from the start of the whole joined note, so the longer it is held, the more the vibrato grows
- `m` depth is in cents (100 = a semitone) because we hear pitch on a log scale. In Hz the wobble would sound shallow in the bass
  and deep in the treble; in cents it sounds the same in every octave.
  The rate is in Hz and does not follow the tempo (vibrato comes from the player's motion, not from the beat)
- `@b` and `m` are both in cents and add up on the same detune.
  `@b-100,60 m120,5,30` scoops up into the note and then starts to wobble
- Moves you can write as note names (a half or whole step, such as bending a harmonica note and releasing it) can be written with `p` and `&`:
  `p40 o4 e16&d16&e2.` — one attack, moving E→D→E in one breath
- An infinite loop example: `t120 intro [body]0` — the intro plays once, then the body repeats
  (with loop playback off, it stops after one pass of the body). If several tracks have one, the latest start point becomes the
  song's loop start, and short infinite loops (drum patterns and so on) are tiled automatically to the length of the song
- A loop start can come right after `&`: `c4& [d4 e4]0` plays c→d joined on the first pass, and plays d4 from its own start on later passes

## Using the engine in your own game or app

Just copy the single file `mml.js` and load it (no dependencies, about 560 lines).

```html
<script src="mml.js"></script>
<script>
  // Play (each array item is one track; they sound together)
  MMLPlayer.play([
    't120 l8 o5 @1 v11 cc gg aa g4',
    't120 l4 o3 @2 v9  c  e  g  e',
  ], { loop: true });

  MMLPlayer.stop();           // stop
  MMLPlayer.setVolume(0.5);   // master volume 0-1
  MMLPlayer.setTrackMute(0, true);  // mute track 0 at once (false to unmute; works while playing)
  MMLPlayer.playing;          // whether it is playing
  MMLPlayer.parse('t90 cde'); // parse only → { notes:[{time,dur,midi}], duration, tempo, loopStart }
                              // a track number (0-based) as the 2nd argument goes into the error's track
  MMLPlayer.MMLError;         // the error type (check with instanceof)
</script>
```

```js
// Handling syntax errors (mml.js has no message text, so build the message in your app's own words)
try {
  MMLPlayer.play(tracks);
} catch (e) {
  if (e instanceof MMLPlayer.MMLError) {
    console.log(e.code);    // 'BAD_CHAR' … the kind of error
    console.log(e.params);  // { char: '%' } … values to put in the message
    console.log(e.track);   // 0 … which track (null for errors about the whole song)
    console.log(e.pos);     // 4 … position in the string you passed (1-based)
  }
}
```

The `code` values (these 25 are the public contract; a dash in `params` means there are no values):

| Group | code | params |
|---|---|---|
| Characters, length | `BAD_CHAR` / `LEN_MIN` | `char` / — |
| Argument separators | `COMMA_REQUIRED` | `label` (`m` `@e` `@b`) |
| Repeat limit | `TOO_MANY_STEPS` | `max` |
| Tie `&` | `TIE_NO_PREV` / `TIE_NO_NEXT` / `TIE_REST` | — |
| Brackets, loops | `UNMATCHED_OPEN` / `UNMATCHED_CLOSE` / `LOOP_NOT_LAST` / `LOOP_EMPTY` | — |
| Single-value commands | `O_RANGE` / `OCT_OVER` / `OCT_UNDER` / `L_ARG` / `T_ARG` / `V_RANGE` / `Q_RANGE` / `P_ARG` | — |
| Multi-value commands | `M_ARGS` / `E_ARGS` / `E_SUSTAIN` / `B_ARGS` | — |
| Wave | `WAVE_RANGE` | `max` |
| Playback | `NO_NOTES` | — |

- Playback uses a lookahead scheduler, so the tempo does not wobble
- `play()` throws an `MMLError` when parsing fails (a song that is already playing is left alone). **It has no display text.**
  So that apps in any language can use it, it passes only a `code` for the kind of error and `params` for the values to put
  in the message (`message` is the same string as `code`). `pos` is the position in the string you passed; even after a
  repeat `[ ]n` it points to where you wrote it, not to the expanded text
- Your app builds the message from `code`. In this repository, `js/mml-messages.js` holds the Japanese and English tables,
  and `locateError` in `js/core.js` adds the line and column to make `Track 2, line 3, col 5: Unexpected character: "%"`
- Calling `play()` with no notes or rests gives an `MMLError` whose `code` is `NO_NOTES` (`track` and `pos` are `null`)
- With loop playback off, it stops by itself once the song and the last note's release are over. `stop()` fades out briefly
  before cutting the sound (to avoid clicks)

### Where the editor ends and mml.js begins

**Comments (`;` `/* */`) and track splitting (left edge / continuation lines) are features of `index.html`, not of `mml.js`.**
Before passing text to MMLPlayer, the editor blanks out the comments and splits the one text area into an array of track strings.

`mml.js` skips only **spaces, tabs, line breaks and `|`**; any other unknown character throws an `MMLError` whose `code` is
`BAD_CHAR` (`params.char` is that character, e.g. `;`). On the other hand, spaces and line breaks are free, so you can pass
nicely formatted template literals:

```js
MMLPlayer.play([`
  t120 l8 o5 @1 v11
  cc gg | aa g4
`]);
```

| Syntax / feature | mml.js alone | index.html |
|---|---|---|
| Notes, lengths, `o` `l` `t` `v` `q` `@` `@e` `&` `m` `p` `@b` `[ ]` | ○ | ○ |
| Spaces, tabs, line breaks, `\|` (ignored) | ○ | ○ |
| Comments `;` `/* ... */` | **×** | ○ |
| Left edge = new track / leading space = continuation | **×** (pass an array) | ○ |

To take a song written in the editor elsewhere, use **"Copy for mml.js"** next to the play button.
It copies the song with comments removed and continuation lines joined, one line per track, so each line can go straight into
the array for `MMLPlayer.play()`. If you also want the editor's notation, copy `stripComments()` / `parseTrackBlocks()` from
`js/core.js` as well (pure functions with no dependencies).

Note that around the numbers and commas of `@e3,0,100,40`, **only spaces are skipped** (a line break or tab there is an error).

## Auto composer (the internal engine MMLComposer)

This is what runs behind the editor's "gacha", "accompaniment" and "extend" features. It is internal to the tool and is not
meant to be taken out for other apps (the only piece offered for that is the sound engine `mml.js`). Below is the shape of
its API, kept as a record of the spec (`harmonize` / `extendMelody` depend on `MMLPlayer.parse`; mood names and comments
follow the display language).

```js
// Generate: mood × bars × seed → an array of MML tracks
const { tracks, comment } = MMLComposer.generate({
  mood: 'intense',   // mood preset: 'calm' | 'mystic' | 'intense' | 'dark' | 'bright'
  bars: 8,           // 4 | 8 | 16
  seed: 42,          // same seed + settings = same song
  // ↓ the rest are optional; each one overrides that part of the mood preset
  scale: 'minor',    // 'major' | 'minor' | 'dorian' (bright or dark)
  key: 'a',          // tonic note name 'c'-'b' ('f#' 'b-' allowed; chosen from the seed if omitted.
                     //   Setting only the key transposes the same song. The melody transposes exactly;
                     //   bass and arpeggio fold back by octaves to keep their range)
  tempo: 150,        // BPM (chosen from the mood's tempo range and the seed if omitted.
                     //   Setting only the tempo gives the same seed's song at another speed)
  density: 2,        // melody intensity 0 (gentle) - 2 (intense)
  drums: true,       // rhythm channel on/off
  drumStyle: 'soft', // 'hard' | 'soft'
  harm: false,       // harmony track (held fifths) on/off
});
MMLPlayer.play(tracks, { loop: true });

// Accompaniment: estimate the key and chord progression from a melody and generate an accompaniment
// opts are as for generate (except scale and tempo, which come from the melody)
const res = MMLComposer.harmonize('t90 l4 o4 a2 >c4< b4 a2 g2 ...', { mood: 'calm', seed: 1 });
MMLPlayer.play(['t90 ...melody...', ...res.tracks], { loop: true });

// Extend the melody: estimate the key, progression and range, then generate and append the next bars
// opts: { seed, bars: bars to add (default 1), density: 0-2 (estimated from the melody if omitted),
//         scale: 'major'|'minor'|'dorian' (parallel key: same tonic, different brightness),
//         octave: -1|0|1 (range shift for the new bars), build: true (more intense each bar),
//         cadence: true (end the last bar on a cadence) }
// The same melody and settings give the same result. Each extension makes the melody longer,
// so repeated runs give different bars
const ext = MMLComposer.extendMelody('t90 l4 o4 c e g e | d f a2', { seed: 1 });
// ext.mml = the whole text after extending, ext.added = only the added part, ext.warning = a fraction warning or null
```

The algorithm follows standard practice: a mood preset (scale, tempo range, pool of chord progressions, sounds)
→ pick a progression → bass = roots, arpeggio = broken chords, melody = chord tones on strong beats and scale tones on
weak beats (with smooth voice leading), and the last bar ends on the tonic. See the comments in `js/mml-composer.js` for details.

## Sample songs

They are in `songs/*.mml`. The app does not load them: open a file, select all, and paste it into the editor.
(The comments inside the files are in Japanese.)

| File | Contents |
|---|---|
| `elven-morning.mml` | Morning in an elven town in another world. A Celtic-style jig in 6/8, 6 tracks, 2:36 (the body loops forever) |
| `slow-blues-in-a.mml` | A 12-bar blues in A, a slow 12/8 shuffle backing. 6 tracks, 48 s |

## Tests

The app itself needs no build, but there are tests. With Node you need nothing else (no npm, no config files).

```
node test/run.js            # everything
node test/run.js parser     # filter by name
```

They check only **things that can be counted**.

- Normal cases of the MML notation (lengths, octaves, repeats, `&` `m` `p` `@b`)
- **Error codes and positions.** The `code` and `pos` that `mml.js` throws are a public contract, so they are pinned down.
  The position is always in the original text (it does not drift after repeats)
- **Error codes and message tables in sync.** Codes are collected from the `mml.js` source and checked against the messages in
  `js/mml-messages.js` (adding to only one side fails)
- The editor's text handling (comment removal, track splitting, the bar check and its report)
- **Display language.** No Japanese is visible in the English view (HTML and JS), Japanese and English come in pairs, and
  changing the language does not change the generated songs
- **The two READMEs in sync.** The notation table and the error code table match between Japanese and English, and the
  error codes match `mml.js`
- Lengths, bar counts and equal track lengths of `songs/*.mml`

Volume balance, tone and musical expression **can only be judged by ear**, so they are outside the tests.

## Bar check

The most common accident when writing by hand is putting the wrong number of notes in a bar. Nothing is wrong as MML, so the
parser lets it through, and you notice only when the tracks drift apart during playback.

"Check bars" on the player row checks whether each track is a whole number of bars and whether all tracks are the same length,
and if not, shows **the line and bar position where a track first drifts off the bar lines**. Set how many quarter notes make
one bar yourself (4 for 4/4, and 3 for 6/8, since six eighths = three quarters).

In a track with an infinite loop `[ ]0`, the body is tiled to the end of the song during playback. The bar check also counts
**the length actually played after tiling**, so `gggggggg` and `[c]` both count as 2 bars and pass as the same length (it also
shows the breakdown `intro N bars + body M bars × K`). An infinite loop is cut off at the end of the song, so **its length
always matches the song** and never fails the same-length check (a finite repeat `[ ]2` is not cut off, so it fails if it runs
over). If the body does not divide the loop section evenly, the seam jumps from the middle of the body back to its start, so
the breakdown adds `cut off at the end`; whether that is fine depends on what you intended, so it is not flagged as a problem.

A track whose tempo changes partway cannot have a single bar length, so it is **reported as not checkable** (rather than
showing a wrong bar count).

## Requirements

A modern browser (Chrome / Edge / Firefox / Safari). Uses the Web Audio API. Running the tests needs Node.

## Origin

Made to create BGM for browser games with no audio files, synthesized from code alone.

## Credits

There are no external library dependencies. The following existing work is built into the project.

- **mulberry32** (pseudo-random numbers, `js/mml-composer.js`) — a small PRNG by Tommy Ettinger. A public-domain (CC0) snippet,
  used for deterministic song generation (same seed and settings = same song).
- **YIN** (pitch detection, `js/mml-audio.js`) — the fundamental frequency estimator published in de Cheveigné, A. &
  Kawahara, H. (2002) "YIN, a fundamental frequency estimator for speech and music", implemented independently for this
  project (used for audio → MML transcription).

## License

MIT License — see [LICENSE](LICENSE).
