# Darkroom

A reusable system for making photo-driven visual novels where **mood, motif and emotion direct the
piece**. You write passages in Twine (or plain text in Twine's `.twee` format). Instead of naming a
photo or song, you say what a scene *is about* (canal, threshold, night) and what it *feels like*
(mourning, dread), and the engine does the rest:

- it picks a fitting photograph or video from your tagged media library,
- the player's feelings tip which picture appears and how it looks (dimmed, ghostly, candlelit…),
- music and ambient sound follow the mood, and their volume follows the feelings,
- feelings steer the structure: **threshold turns** break in when a feeling crosses a line, and
  **drifting scenes** come in whichever order best fits how the player feels,
- the ending can be chosen by the strongest feeling.

It builds a game that plays in any browser and packages an itch.io-ready zip:

- **lean**: photos, audio and video are shrunk with ffmpeg (WebP photos, AAC audio, H.264 video), and
  only the files the piece can show are included.
- **itch-safe**: the zip is checked against itch.io's HTML5 rules (1,000 files, 500 MB total, 200 MB per
  file, `index.html` at the top, file-name case) *before* you upload it.
- **versioned**: every package lands in `release/` as `<piece>-itch-<date>-v<N>.zip`.

No npm packages to install. Needs **Node 20+** and, for lean builds, **ffmpeg**.

Windows (PowerShell):

```
winget install OpenJS.NodeJS.LTS Gyan.FFmpeg
cd darkroom
npm link                          # makes the `darkroom` command available everywhere
```

Close and reopen PowerShell after installing so it finds `node` and `ffmpeg`.
On macOS: `brew install node ffmpeg`, then `npm link` in the `darkroom` folder.
(Without `npm link`, run `node path\to\darkroom\bin\darkroom.mjs …` instead of `darkroom …`.)

## Quick start

```
darkroom new my-piece --title "My Piece"
cd my-piece
darkroom serve           # open the printed address; the page reloads every time you save
```

A new project starts as **Low Tide**, a short example piece with three feelings (longing, dread and
tenderness), a tagged library of placeholder photos and videos, mood music, a pool of drifting scenes,
two threshold turns and three endings. Play it a few times to see how the order changes with your
choices, then replace its text and media with your own. `story/low-tide.twee` explains itself in its
opening comment.

| Command | What it does |
| --- | --- |
| `darkroom new <folder>` | start a project from the example piece |
| `darkroom serve` | live preview while writing; also prints a Wi-Fi address to test on your phone |
| `darkroom check` | broken links, missing or wrongly-cased files, motifs with no pictures, unmapped moods, bad conditions, dead ends |
| `darkroom library` | add new photos/videos to `library.json` and list how many pictures each motif has (`--prune` drops deleted files) |
| `darkroom build [--lean]` | playable web folder in `dist/` |
| `darkroom package` | lean build + itch.io check + `release/*.zip` |
| `darkroom preview` | play the built `dist/` folder locally |
| `darkroom size` | which folders and files take the most space |
| `darkroom import <twine file or folder> <project>` | bring in an existing Twine story's text (see the end of this guide) |

## A project

```
my-piece/
  darkroom.json        title, feelings (meters), moods → music, looks, rules, lean and itch settings
  library.json         every photo and video, tagged with the motifs it can stand for
  story/               your writing: .twee files, and/or Twine .html files
  assets/
    bg/                photographs and looping videos the engine chooses from
    images/            pictures shown on top (a letter, an object), used by name
    music/  ambience/  sfx/  voice/
    video/             cut-scenes and interludes, used by name
  dist/                built piece (made by darkroom build)
  release/             zips ready for itch.io (made by darkroom package)
```

Back up or commit `darkroom.json`, `library.json`, `story/` and `assets/`. Everything else is rebuilt.

## Writing passages

A piece is a set of **passages**. In a `.twee` file each starts with `:: Name`, followed by its tags:

```
:: The Pier [drift-town feel-longing motif-pier sound-sea]
The pier is shorter than you remember.

"It comes back," he says, without turning round.

[[Wait with him for the water->@drift town else=The House][longing+15]]
[[Leave him to it->@drift town else=The House][tenderness+5]]
```

- With `"beat": "paragraph"` (the example), text is shown a paragraph at a time; with `"line"`, each line
  is one click. `"mode": "page"` shows the passage as a page over the photograph, as in Twine;
  `"mode": "vn"` puts the text in a box at the bottom.
- A line made only of links becomes **choices**. Links inside a sentence stay clickable words.
- `*italic*`, `**bold**` and HTML (including multi-line `<div>` blocks) all work. `/* comments */` are ignored.
- `Name: line` shows a name plate for names listed under `characters` in `darkroom.json`.

### Links

| Write | Means |
| --- | --- |
| `[[Alley]]` | go to the passage `Alley` |
| `[[Follow her->Alley]]` or `[[Follow her\|Alley]]` | show "Follow her", go to `Alley` |
| `[[Look up->Hotel][dread+20 longing-5]]` | …and change feelings when chosen |
| `[[Follow her->Alley][$met = true]]` | …or change any variable |
| `[[Walk on->@drift town else=The House]]` | go to the drifting scene that best fits the current feelings |
| `[[Go on->@resume]]` | (in a threshold turn) continue to where the player was heading |

## Emotion-led structure

### Feelings (meters)

Declare the feelings of your piece in `darkroom.json`:

```json
"meters": {
  "longing":    { "start": 20, "min": 0, "max": 100 },
  "dread":      { "start": 10 },
  "tenderness": { "start": 10 }
}
```

They behave as variables (`$dread`) and are kept within their range. Change them with link setters
(`[[…][dread+20]]`) or a line `@nudge dread+10 longing-5`. In conditions, `dominant()` is the name of the
strongest feeling right now.

### Moods and motifs: passage tags

Tags on a passage describe its scene. None of them names a file.

| Tag | Meaning |
| --- | --- |
| `motif-canal` | show a picture from the library that has the motif *canal* |
| `shot-arch20` | a hand-picked picture (library id) for the first playthrough; later playthroughs vary by motif |
| `look-mourning` | how the picture is shown (see Looks). Without it, the feelings decide. |
| `music-mourning` | music for the mood *mourning* (mapped to a track in `darkroom.json`); `music-silence` stops it |
| `sound-water` | ambient sound for *water*; `sound-silence` stops it |
| `atmosphere-fog`, `overlay-rain` | set `data-atmosphere` / `data-overlay` on the page, for your own CSS effects |
| `drift-town` | this passage belongs to the drifting pool *town* |
| `feel-dread` | this passage suits dread (used to choose drifting scenes) |

Passages without these tags keep the current picture and sound.

### The media library (`library.json`)

Every photo and video the engine may choose, with the motifs it can stand for:

```json
{ "assets": [
  { "id": "pier",  "file": "bg/pier.jpg",  "type": "image", "motifs": ["pier", "sea", "distance", "waiting"] },
  { "id": "waves", "file": "bg/waves.mp4", "type": "video", "motifs": ["sea", "water", "motion"], "still": "shore" },
  { "id": "cliff", "file": "bg/cliff.jpg", "type": "image", "motifs": ["path", "edge"], "focal": "left center" },
  { "id": "kitchen", "file": "bg/kitchen.jpg", "type": "image", "motifs": ["interior", "warmth"], "repeatAllowed": false }
] }
```

- `still`: a picture to show if the video can't play. `focal`: which part of the photo to keep on narrow
  screens. `repeatAllowed: false`: show it at most once per playthrough.
- Run `darkroom library` after adding photos: new files are added with empty motifs for you to fill in,
  and you get a count of pictures per motif, so thin motifs are easy to spot. Files in `assets/images/`
  and `assets/video/` are used by name and stay out of the library.
- A library id works anywhere a file name does: `@bg pier`, `@video tide`.

**How a picture is chosen:** all pictures with the motif are candidates. The feelings add weight to some
motifs (`scene.weights`), the best-scoring pictures form a pool, and the picture last shown for that
motif is avoided when there is any alternative.

```json
"weights": [
  { "when": "$dread > 50",      "favor": { "shadow": 15, "night": 10, "empty": 10 } },
  { "when": "$tenderness > 50", "favor": { "light": 15, "warmth": 10 } }
]
```

### Looks

A look sets how strongly the photo shows and its filter. Twenty-one are built in: `neutral`, `quiet`,
`mourning`, `shadowed`, `dimmed`, `desaturated`, `ghostly`, `candlelit`, `luminous`, `windswept`, `vast`,
`duplicated`, `uncanny`, `chaotic`, `fading`, `warped`, `doorway`, `ethereal`, `waiting`, `intimate`,
`empty`. Add or change them under `scene.looks`:

```json
"looks": { "drowned": { "opacity": 0.7, "filter": "saturate(0.2) hue-rotate(160deg)" } }
```

When a passage has no `look-` tag, the first matching rule decides:

```json
"look_rules": [
  { "when": "$dread >= 70",  "look": "shadowed" },
  { "when": "$longing >= 60", "look": "mourning" }
],
"look_floor": { "opacity": 0.8, "brightness": 0.85 }
```

`look_floor` stops any look from making photos too faint or too dark to see on players' screens.

### Mood music and sound

```json
"music":    { "mourning": "music/le-cygne", "dread": "music/low-drone", "silence": null },
"ambience": { "sea": "ambience/waves", "bells": "ambience/bells", "silence": null },
"aliases":  { "motif": { "room": "interior" }, "sound": { "water": "sea" } },
"volume":   { "music": 0.6, "ambience": 0.35 },
"mix": {
  "music": "0.45 + $longing * 0.003 - $dread * 0.001", "music_range": [0.2, 0.8],
  "ambience": "0.2 + $dread * 0.004",                   "ambience_range": [0.1, 0.7]
}
```

`music-mourning` and `@music mourning` both use the map. A new mood crossfades; the same mood keeps
playing. With `mix`, mood music gets louder or softer with the feelings on every passage.

### Threshold turns

A passage whose first lines include `@turn` happens on its own, once, the moment its condition is true,
whatever the player was about to do:

```
:: The Water Comes In [motif-sea music-dread look-shadowed]
@turn $dread >= 55
@video tide
Somewhere a siren starts…
[[Go on->@resume]]
```

`@resume` continues to where the player was heading. `@turn … once=false` lets a turn happen again.

### Drifting scenes

Passages tagged with the same `drift-<pool>` form a pool. `@drift town else=The House` (as a link target
or a line) goes to the unvisited scene in the pool whose `feel-` tags add up to the most feeling right
now, picking at random between equals. Each playthrough visits them in a different order. A scene with
`@when $longing > 25` among its first lines is only available while that holds. When the pool is used up,
`else=` says where to go next.

### Endings

```
@if dominant() is "dread"
You catch the last bus out.
@ending leave "The Last Bus"
@elseif dominant() is "longing"
…
@endif
```

Endings are remembered across playthroughs and listed under Endings. `runs()` is the number of
finished playthroughs, e.g. to change the opening on a second visit.

## Directives

Lines starting with `@`. Options are `key=value`, times are in seconds.

| Directive | Does |
| --- | --- |
| `@motif canal` | show a picture for this motif now (`look=quiet`, `fade=2`) |
| `@look mourning` | change the look of the current picture |
| `@nudge dread+10 longing-5` | change feelings |
| `@turn $dread >= 55` | make this passage a threshold turn (`once=false` to allow repeats) |
| `@when $longing > 25` | a drifting scene is only chosen while this holds |
| `@drift town else=Passage` | go to the best-fitting drifting scene now |
| `@resume` | continue to where the player was heading before the turn |
| `@bg pier` | a specific picture or video (library id or file). `fade=2`, `fit=contain`, `pos=top`, `move=in\|out\|left\|right` (slow drift), `time=30`, `filter="grayscale(1)"`. `@bg none` goes to black. |
| `@bgvideo rain` | looping, silent background video |
| `@image letter pos=middle` | picture on top (`pos=left\|center\|right\|middle\|full`, `id=x`, `width=40%`); `@image clear` |
| `@music mourning` | mood (from the map) or file; `volume=0.7`, `fade=3`; `@music stop` |
| `@ambience sea` | second looping channel for room tone, rain, traffic |
| `@sfx door` / `@voice line-03` | play a sound once / a voice line |
| `@stop` | stop music and ambience (`@stop music`, `fade=4`) |
| `@video tide` | full-screen cut-scene; tap skips (`skip=false` to force watching); music dips meanwhile |
| `@wait 1.5` | pause |
| `@card "Chapter Two" "The river"` | full-screen title card |
| `@fx flash` / `shake` / `fadeout` / `fadein` | screen effects (`color=#600`, `time=2`) |
| `@textbox hide` | hide the text box for a picture-only moment |
| `@set $x = 1` / `@unset $x` | change variables |
| `@if` / `@elseif` / `@else` / `@endif` | conditions (can be nested) |
| `@goto Passage` / `@goto = $next` | jump (to a fixed passage, or one worked out from variables) |
| `@include Passage` | run another passage's contents here |
| `@ending id "Title"` | mark an ending |
| `@speed 15` | typewriter speed for this passage (0 = instant) |
| `@run js` | run JavaScript (`S` holds the variables) |
| `@todo note` | reminder that shows up as a warning in `darkroom check` |

### Variables and conditions

- `StoryInit` runs at the start of every new game; set your own variables there. `darkroom check` warns about
  variables that are read but never set, which catches typos.
- Show a value in text with `{$name}`, `{= $coins * 2}`, or just `$name`.
- Twine words work: `to`, `is`, `is not`, `and`, `or`, `not`, `gt`, `gte`, `lt`, `lte`.
- Helpers: `dominant()`, `visited("Passage")`, `runs()`, `random(1, 6)`, `either("a", "b")`, `ending("id")`,
  `clamp(x, 0, 100)`, `turns()`, `passage()`, `previous()`.

### Media file names

Write names without folder or extension: `@sfx door` finds `assets/sfx/door.m4a`. Names are
**case-sensitive**: `Pier.JPG` and `pier.jpg` are different files on itch.io even though they are the same
on Windows and Mac, so `darkroom check` reports a mismatch as an error instead of letting it break online.

Formats that play everywhere: JPEG/PNG/WebP photos, MP3/M4A audio, MP4 (H.264) video. Lean builds convert
anything else (WAV, OGG, FLAC, MOV, …) for you.

## Using Twine's editor

- **Twee into Twine:** in Twine 2.6+, Library → Import, choose a `.twee` file from `story/`. Tags show as
  passage tags, so you can see the moods and pools on Twine's map.
- **Twine into Darkroom:** put the story's `.html` in `story/` (Library → Archive, or Build → Publish to File).

Keep only one copy of each story in `story/`.

## Releasing on itch.io

```
darkroom package
```

1. Builds a lean copy, converting new or changed media (cached in `.darkroom/cache`, so later packages are
   fast). A conversion that comes out larger than the original is discarded. Phone photos keep their rotation.
2. Checks it against itch.io's limits. If it doesn't fit, nothing is written and you get the largest files
   and what to turn down in `darkroom.json` (`lean.image_max`, `lean.image_quality`, `lean.video_crf`).
3. Writes `release/<id>-itch-<date>-v<N>.zip`.

On the itch.io page: **Kind of project: HTML** → upload the zip → tick **This file will be played in the
browser** → viewport e.g. **1280 × 720** → tick **Mobile friendly** and **Fullscreen button**.

## darkroom.json

```jsonc
{
  "title": "Low Tide",
  "id": "low-tide",              // file names and save slots; don't change after release
  "author": "",
  "start": "Arrival",
  "mode": "page",                // "page" (text over the photo, like Twine) or "vn" (text box)
  "beat": "paragraph",           // "paragraph" or "line"
  "typewriter": 0,               // letters per second, 0 = instant
  "bg_fade": 1.5, "bg_fit": "cover",
  "meters": { … },               // the feelings
  "scene": {
    "music": { … }, "ambience": { … }, "aliases": { … }, "volume": { … }, "mix": { … },
    "weights": [ … ], "look_rules": [ … ], "looks": { … }, "look_floor": { … },
    "first_run_shots": true      // shot- tags only on the first playthrough
  },
  "characters": { "Mara": { "color": "#d9b382" } },
  "title_screen": { "background": "title", "music": "music/longing", "subtitle": "" },
  "theme": { "font": "Georgia, serif", "accent": "#c33" },   // any --dr-* CSS variable
  "lean": { "image_max": 1920, "image_format": "webp", "image_quality": 80,
            "audio_bitrate": 128, "video_max_height": 720, "video_crf": 26 },
  "itch": { "max_files": 1000, "max_total_mb": 500, "max_file_mb": 200 }
}
```

More styling: a passage tagged `[stylesheet]` (style `#dr[data-atmosphere="fog"]`, `body[data-passage="the-pier"]`, …).
Custom code: a passage tagged `[script]` can use `Darkroom.state`, `Darkroom.media`, `Darkroom.go("Passage")`,
`Darkroom.on("passage" | "turn" | "meters" | "ending", fn)`, and add helpers with `Darkroom.helpers.name = …`.

## What players get

- Title screen with Continue, New game, Load, Endings and Settings.
- Autosave on every passage plus 6 save slots (with a thumbnail of the photo), Back (← key), a text log,
  auto-advance and skip.
- **View** (H) hides the text so the photograph can be seen whole.
- Settings for music volume, sound volume, text speed and auto speed, remembered between visits.
- Keyboard: Space/Enter/→ next, 1–9 choose, ← back, H view, A auto, S skip, L log, F fullscreen, Esc menu.
- Works in Windows, Mac and Android browsers, iPhone/iPad Safari and inside itch.io's frame. The photos of
  the next possible scenes are loaded in advance.

While using `darkroom serve`, press <code>`</code> (backtick) in the game to jump to any passage or edit
feelings and variables.

## Bringing in an existing Twine story

```
darkroom import "C:\path\to\story-folder" my-piece
```

Reads published games, Twine archives or `.twee` files; converts common SugarCube and Harlowe macros to
directives; copies the media the story refers to; and writes `IMPORT-REPORT.md` listing whatever is left to
convert by hand. Passage tags come across unchanged, so mood tags written in Twine keep working.

## Development

```
node test/run.mjs            # compiler, build/package, importer and browser playthroughs (with Playwright)
tools/make-placeholders.sh   # regenerate the example piece's placeholder media
```
