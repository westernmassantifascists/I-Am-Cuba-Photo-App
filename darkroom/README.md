# Darkroom

A reusable system for making photo-driven visual novels: you write in Twine (or plain text in Twine's
`.twee` format), drop photos, music and video into folders, and Darkroom builds a game that plays in
the browser — and packages an itch.io-ready zip that stays within itch's limits.

It does by default what The Dead City's release needed by hand:

- **lean**: photos, audio and video are shrunk with ffmpeg (WebP photos, AAC audio, H.264 video), and only the files
  the story actually uses are included.
- **itch-safe**: the zip is checked against itch.io's HTML5 rules (1,000 files, 500 MB total, 200 MB per file, `index.html`
  at the top, file-name case) *before* you upload it.
- **versioned**: every package lands in `release/` as `<game>-itch-<date>-v<N>.zip`.

No npm packages to install. Needs **Node 20+** and, for lean builds, **ffmpeg**.

```
brew install node ffmpeg          # macOS (Homebrew)
cd darkroom && npm link           # makes the `darkroom` command available everywhere
```

(Without `npm link`, run `node path/to/darkroom/bin/darkroom.mjs …` instead of `darkroom …`.)

## Quick start

```
darkroom new my-game --title "My Game"
cd my-game
darkroom serve           # open the printed address; the page reloads every time you save
```

The new project contains a short sample story with placeholder pictures, music and video so you can see
every feature working. Replace them with your own.

| Command | What it does |
| --- | --- |
| `darkroom new <folder>` | start a project from the template |
| `darkroom import <twine file or folder> <project>` | bring in an existing Twine story (see below) |
| `darkroom serve` | live preview while writing; also prints a Wi-Fi address to test on your phone |
| `darkroom check` | broken links, missing or wrongly-cased files, bad conditions, dead ends, unreachable passages |
| `darkroom build [--lean]` | playable web folder in `dist/` |
| `darkroom package` | lean build + itch.io check + `release/*.zip` |
| `darkroom preview` | play the built `dist/` folder locally |
| `darkroom size` | which folders and files take the most space |

## A project

```
my-game/
  darkroom.json        title, characters, look, lean and itch settings
  story/               your writing: .twee files, and/or Twine .html files
  assets/
    bg/                background photos (or looping background videos)
    images/            pictures shown on top (letters, objects, people cut out as PNG)
    music/  ambience/  sfx/  voice/
    video/             cut-scenes
  dist/                built game (made by darkroom build)
  release/             zips ready for itch.io (made by darkroom package)
```

Back up or commit `darkroom.json`, `story/` and `assets/`. Everything else is rebuilt from them.

## Writing

A story is a set of **passages**. In a `.twee` file each starts with `:: Name`:

```
:: Harbor
@bg harbor move=in
@music night-theme
Rain on the black water.
Mara: You came back.

[[Follow her->Alley]]
[[Stay where you are->Wait]]
```

- **Every line of text is one click** (a "beat"). Set `"beat": "paragraph"` in `darkroom.json` to show
  lines together until a blank line instead (imported Twine stories use this).
- `Name: line` shows a name plate — for names listed under `characters` in `darkroom.json`.
- A line made only of links becomes **choices**. Links inside a sentence stay clickable words.
- `*italic*`, `**bold**`, and HTML all work.
- `/* comments */` are ignored.

### Links

| Write | Means |
| --- | --- |
| `[[Alley]]` | go to the passage `Alley` |
| `[[Follow her->Alley]]` or `[[Follow her\|Alley]]` | show "Follow her", go to `Alley` |
| `[[Follow her->Alley][$trust += 1]]` | …and change a variable when chosen |

### Variables and conditions

```
:: StoryInit
@set $trust = 0
@set $name = "Ana"

:: Alley
@if $trust > 2 and not $betrayed
Mara: I trust you, {$name}.
@elseif visited("Stranger")
Mara: You talked to him.
@else
Mara: Hmm.
@endif
```

- `StoryInit` runs once at the start of every new game — set your variables there.
  `darkroom check` warns about variables that are read but never set, which catches typos.
- Show a value in text with `{$name}`, `{= $coins * 2}`, or just `$name`.
- Twine words work: `to`, `is`, `is not`, `and`, `or`, `not`, `gt`, `gte`, `lt`, `lte`.
- Helpers: `visited("Passage")` (times visited; no name = this passage), `random(1, 6)`, `either("a", "b")`,
  `ending("id")` (has this ending been found in any playthrough), `turns()`, `passage()`, `previous()`.
- Choices inside `@if` only appear when the condition is true.

### Directives

Lines starting with `@`. Options are `key=value`, times are in seconds.

| Directive | Does |
| --- | --- |
| `@bg harbor` | change the background photo. Options: `fade=2`, `fit=contain` (whole photo, letterboxed), `pos=top`, `move=in\|out\|left\|right` (slow Ken Burns drift), `time=30` (drift length), `filter="grayscale(1)"`. A video file here plays as a silent looping background. `@bg none` goes to black. |
| `@bgvideo rain-window` | looping, silent background video |
| `@image letter pos=middle` | picture on top of the background. `pos=left\|center\|right\|middle\|full`, `id=x`, `width=40%`. `@image clear` removes them (or `@image clear id=x`). |
| `@music theme` | loop music, crossfading from the last track. `volume=0.7`, `fade=3`, `loop=false`. `@music stop` |
| `@ambience rain` | a second looping channel for room tone, rain, traffic |
| `@sfx door` | play a sound once |
| `@voice mara-03` | voice line; cut off when the next voice line starts |
| `@stop` | stop music and ambience (`@stop music`, `@stop ambience`, `fade=4`) |
| `@video tram` | full-screen cut-scene; tap skips (`skip=false` to force watching). Music dips while it plays. |
| `@wait 1.5` | pause |
| `@card "Chapter Two" "The river"` | full-screen title card |
| `@fx flash` / `@fx shake` / `@fx fadeout` / `@fx fadein` | screen effects (`color=#600`, `time=2`) |
| `@textbox hide` | hide the text box for a picture-only moment (the next line brings it back) |
| `@set $x = 1` | change variables |
| `@if` / `@elseif` / `@else` / `@endif` | conditions (can be nested) |
| `@goto Passage` | jump immediately |
| `@include Passage` | run another passage's contents here (handy for shared choice lists; tag it `[widget]`) |
| `@ending id "Title"` | mark an ending. It is remembered across playthroughs and listed under Endings. |
| `@speed 15` | typewriter speed for the rest of this passage (0 = instant) |
| `@run js` | run JavaScript (`S` holds the variables) |
| `@todo note` | reminder that shows up as a warning in `darkroom check` |

### Media file names

Write the name without the folder or extension: `@bg harbor` finds `assets/bg/harbor.jpg` (or .webp,
.png, …). Subfolders work: `@bg night/harbor`. Names are **case-sensitive** — `Harbor.JPG` and
`harbor.jpg` are different files on itch.io even though they are the same on a Mac, so `darkroom check`
reports this as an error instead of letting it break online.

Formats that play everywhere: JPEG/PNG/WebP photos, MP3/M4A audio, MP4 (H.264) video. Lean builds
convert anything else (WAV, AIFF, FLAC, MOV, …) for you.

## Using Twine's editor

You can keep writing in Twine's visual editor:

- **Twee into Twine:** in Twine 2.6+, Library → Import, choose a `.twee` file from `story/`.
- **Twine into Darkroom:** put the story's `.html` in `story/` (Library → Archive, or Build → Publish to
  File). Darkroom reads `<tw-storydata>` from any Twine HTML, whatever story format it is set to.

Write the same `@directives` and `[[links]]` in Twine's passage editor. Keep only one copy of each
story in `story/` (a `.twee` *and* an `.html` of the same story would give duplicate passage names).

## Bringing The Dead City (or any Twine game) in

```
darkroom import ~/Desktop/the-dead-city ./dead-city
```

The source can be a published game (`.html`), a Twine archive, `.twee` files, or a whole folder. The importer:

- writes the passages to `story/<name>.twee`, keeping their positions on Twine's map,
- converts the common **SugarCube** (`<<set>>`, `<<if>>`/`<<elseif>>`/`<<else>>`, `<<goto>>`, `<<include>>`,
  `<<print>>`, `[img[…]]`) and **Harlowe** (`(set:)`, `(if:)[…](else-if:)[…](else:)[…]`, `(go-to:)`,
  `(display:)`, `(link-goto:)`, `(print:)`, `''bold''`, `//italic//`) macros into Darkroom directives,
- copies every picture, sound and video the story refers to into `assets/`, keeping the folder layout,
- keeps the old stylesheet, and saves the old Story JavaScript to `IMPORTED-SCRIPT.js.txt` (it is not run,
  because it was written for the old story format),
- writes `IMPORT-REPORT.md`, listing what was converted and every passage that still uses a macro to
  rewrite by hand (for example custom audio macros, `(click:)` hooks or timed text).

Then `darkroom check ./dead-city` lists exactly what is left to fix.

## Releasing on itch.io

```
darkroom package
```

1. Builds a lean copy, converting new or changed media (results are cached in `.darkroom/cache`, so
   later packages are fast). A conversion that comes out larger than the original is discarded.
2. Checks it against itch.io's limits. If it doesn't fit, nothing is written and you get the largest
   files and what to turn down in `darkroom.json` (`lean.image_max`, `lean.image_quality`, `lean.video_crf`).
3. Writes `release/<id>-itch-<date>-v<N>.zip`.

On the itch.io page: **Kind of project: HTML** → upload the zip → tick **This file will be played in the
browser** → viewport e.g. **1280 × 720** → tick **Mobile friendly** and **Fullscreen button**.

The limits live in `darkroom.json` under `itch`; if itch.io raises them for your page, change them there.

## darkroom.json

```jsonc
{
  "title": "The Dead City",
  "id": "the-dead-city",        // used for file names and save slots; don't change after release
  "author": "",
  "start": "Start",              // first passage
  "mode": "vn",                  // "vn": text box over the photo, click to advance
                                 // "page": Twine-style scrolling page over the photo
  "beat": "line",                // "line" or "paragraph"
  "typewriter": 40,              // letters per second, 0 = instant
  "bg_fade": 1,                  // default background crossfade, seconds
  "bg_fit": "cover",             // "cover" fills the screen, "contain" shows the whole photo
  "characters": { "Mara": { "color": "#d9b382" }, "Stranger": { "name": "???", "color": "#9fb4c7" } },
  "title_screen": { "background": "title", "music": "theme", "subtitle": "" },
  "theme": { "font": "Georgia, serif", "accent": "#c33", "text-size": "20px" },  // any --dr-* CSS variable
  "lean": { "image_max": 1920, "image_format": "webp", "image_quality": 80,
            "audio_bitrate": 128, "video_max_height": 720, "video_crf": 26 },
  "itch": { "max_files": 1000, "max_total_mb": 500, "max_file_mb": 200 }
}
```

More styling: add a passage tagged `[stylesheet]`. Custom code: a passage tagged `[script]` can use
`Darkroom.state`, `Darkroom.go("Passage")`, `Darkroom.on("passage", fn)`, `Darkroom.on("ending", fn)`,
and add helpers for conditions with `Darkroom.helpers.myHelper = …`.

## What players get

- Title screen with Continue, New game, Load, Endings and Settings.
- Autosave on every passage plus 6 save slots (with a thumbnail of the photo), Back (← key) to the
  previous passage, a text log, auto-advance and skip.
- **View** (H) hides the text so the photograph can be seen whole.
- Settings for music volume, sound volume, text speed and auto speed — remembered between visits.
- Keyboard: Space/Enter/→ next, 1–9 choose, ← back, H view, A auto, S skip, L log, F fullscreen, Esc menu.
- Works on iPhone/iPad Safari (sound plays even with the ringer switch off, volume control works),
  desktop browsers, and inside itch.io's frame. The next passages' photos are loaded in advance.

While using `darkroom serve`, press <code>`</code> (backtick) in the game to jump to any passage or edit variables.

## Development

```
node test/run.mjs      # compiler, build/package, importer and (with Playwright) browser playthroughs
tools/make-placeholders.sh   # regenerate the template's placeholder media
```
