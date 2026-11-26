# Darkroom

A reusable system for making photo-driven visual novels where **mood, motif and emotion direct the
piece**, and where each piece's moods grow out of its own material. You write passages in Twine (or
plain text in Twine's `.twee` format). Instead of naming a photo or song, you say what a scene *is about*
and what mood it is in, and the engine does the rest:

- `darkroom develop` measures your photographs, videos and recordings and develops the piece's own
  vocabulary from them: picture moods (tone, colour), qualities for every picture, an interface palette
  taken from the photos' colours, and names for the music and ambience by how they sound,
- passages ask for those moods; the engine picks a fitting photograph or video and how to show it,
- the player's feelings tip which picture appears and how it looks,
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
tenderness), placeholder photos, videos and music, moods developed from them (open `moodboard.html`),
a pool of drifting scenes, two threshold turns and three endings. Play it a few times to see how the
order changes with your choices. Then replace its media with your own, run `darkroom develop`, and
write with the moods your material gives you. `story/low-tide.twee` explains itself in its opening comment.

| Command | What it does |
| --- | --- |
| `darkroom new <folder>` | start a project from the example piece |
| `darkroom develop` | measure the pictures and sounds; write `moods.json` and `moodboard.html` |
| `darkroom serve` | live preview while writing; also prints a Wi-Fi address to test on your phone |
| `darkroom check` | broken links, missing or wrongly-cased files, motifs with no pictures, unknown moods, bad conditions, dead ends |
| `darkroom library` | add new photos/videos to `library.json` and list how many pictures each motif has (`--prune` drops deleted files) |
| `darkroom build [--lean]` | playable web folder in `dist/` |
| `darkroom package` | lean build + itch.io check + `release/*.zip` |
| `darkroom preview` | play the built `dist/` folder locally |
| `darkroom size` | which folders and files take the most space |
| `darkroom import <twine file or folder> <project>` | bring in an existing Twine story's text (see the end of this guide) |

## A project

```
my-piece/
  darkroom.json        title, feelings (meters), rules linking feelings to moods, lean and itch settings
  library.json         every photo and video, tagged with the subjects it shows
  moods.json           developed from the media by darkroom develop (don't edit: it is rewritten)
  moodboard.html       the developed moods, to look at in a browser
  story/               your writing: .twee files, and/or Twine .html files
  assets/
    bg/                photographs and looping videos the engine chooses from
    images/            pictures shown on top (a letter, an object), used by name
    music/  ambience/  sfx/  voice/
    video/             cut-scenes and interludes, used by name
  dist/                built piece (made by darkroom build)
  release/             zips ready for itch.io (made by darkroom package)
```

Back up or commit `darkroom.json`, `library.json`, `moods.json`, `story/` and `assets/`. Everything else is rebuilt.

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

## Developing moods from your material

```
darkroom develop
```

Run it whenever you add or change media. It measures every picture in the library (brightness,
contrast, colour, warmth, and for videos movement) and every track in `assets/music/` and
`assets/ambience/` (loudness, how low or bright it sounds, how busy, how much it swells). Everything is
measured **relative to this piece's own collection**, so "dark" means dark for these photographs.

From that it develops:

- **Picture moods.** The pictures are grouped by what they have in common and each group is named after
  it, e.g. `soft-dark`, `warm-vivid`, `hard-cool`. Each mood gives you three things to use:
  `look-<mood>` (a filter that pulls *any* picture toward that mood's tone), `atmosphere-<mood>` (a tint
  made from those pictures' own colours) and `motif-<mood>` (pick one of the pictures in that mood).
- **Qualities** for each picture (`dark`, `soft`, `warm`, `cool`, `vivid`, `muted`, `hard`, `bright`,
  `restless`, `still`…). They work as motifs: `motif-warm` picks a warm picture. Black-and-white
  collections are recognised and described by tone only.
- **An interface palette**: background, text and accent colours taken from the photos.
- **Sound moods**: each music and ambience track is named by how it sounds, e.g. `music-low-slow`,
  `sound-busy-quiet`. A track's own file name works too (`music-longing` plays `assets/music/longing`).

`moodboard.html` shows it all: the palette, each mood with its pictures and its look and atmosphere tried
on other pictures, the sound moods with players, and every picture's qualities.

The developed names are the starting vocabulary. To give a mood your own name, or to adjust it, add it
in `darkroom.json` (which always wins over `moods.json`):

```json
"scene": {
  "looks": { "drowned": { "opacity": 0.8, "filter": "brightness(0.7) saturate(0.4)" } },
  "music": { "grief": "music/low-slow-take-2" }
},
"theme": { "accent": "#c33" }
```

If you replace media and develop again, the names may change; `darkroom check` lists any tag that no
longer matches, along with the moods that exist now.

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
| `motif-canal` | show a picture with the motif *canal*: a subject from `library.json`, a measured quality (`warm`), or a picture mood (`soft-dark`) |
| `shot-arch20` | a hand-picked picture (library id) for the first playthrough; later playthroughs vary by motif |
| `look-soft-dark` | how the picture is shown: a developed picture mood, or `neutral`. Without it, the feelings decide (`look_rules`). |
| `music-low-slow` | a developed music mood, a mood you named in `darkroom.json`, or a file in `assets/music/`; `music-silence` stops it |
| `sound-busy-quiet` | the same for ambient sound; `sound-silence` stops it |
| `atmosphere-warm-vivid` | a developed tint over the picture (or one you style yourself); fades between atmospheres |
| `overlay-rain` | drifting particles over the picture: `dust`, `snow`, `rain`, `embers`, `ash` |
| `drift-town` | this passage belongs to the drifting pool *town* |
| `feel-dread` | this passage suits dread (used to choose drifting scenes) |

Passages without these tags keep the current picture and sound.

### The media library (`library.json`)

Every photo and video the engine may choose, with the subjects it shows (the qualities and moods from
`darkroom develop` are added to these automatically):

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
- `darkroom develop` (or `darkroom library`) adds new photos for you, with empty subjects to fill in;
  `darkroom library` also counts pictures per motif, so thin motifs are easy to spot. Files in `assets/images/`
  and `assets/video/` are used by name and stay out of the library.
- A library id works anywhere a file name does: `@bg pier`, `@video tide`.

**How a picture is chosen:** all pictures with the motif are candidates. The feelings add weight to some
motifs or qualities (`scene.weights`), the best-scoring pictures form a pool, and the picture last shown
for that motif is avoided when there is any alternative. Linking feelings to *measured* qualities lets
the material answer the emotion:

```json
"weights": [
  { "when": "$dread > 50",      "favor": { "dark": 15, "soft": 10 } },
  { "when": "$tenderness > 50", "favor": { "warm": 15, "vivid": 10 } }
]
```

### Looks

A look sets how strongly the photo shows and its filter. The looks are the piece's developed picture
moods, plus `neutral` (the picture as it is) and any you add under `scene.looks`. When a passage has no
`look-` tag, the first matching rule decides:

```json
"look_rules": [
  { "when": "$dread >= 45",      "look": "soft-dark" },
  { "when": "$tenderness >= 45", "look": "warm-vivid" }
],
"look_floor": { "opacity": 0.8, "brightness": 0.85 }
```

`look_floor` stops any look from making photos too faint or too dark to see on players' screens.

### Mood music and sound

The developed sound moods are ready to use. Add your own names, or aliases, in `darkroom.json`:

```json
"music":    { "grief": "music/cello-take-3" },
"ambience": { "harbour": "ambience/gulls-and-rope" },
"aliases":  { "motif": { "room": "interior" }, "sound": { "water": "low-loud" } },
"volume":   { "music": 0.6, "ambience": 0.35 },
"mix": {
  "music": "0.45 + $longing * 0.003 - $dread * 0.001", "music_range": [0.2, 0.8],
  "ambience": "0.2 + $dread * 0.004",                   "ambience_range": [0.1, 0.7]
}
```

`music-grief` and `@music grief` both work. A new mood crossfades; the same mood keeps playing. With
`mix`, mood music gets louder or softer with the feelings on every passage.

### Threshold turns

A passage whose first lines include `@turn` happens on its own, once, the moment its condition is true,
whatever the player was about to do:

```
:: The Water Comes In [motif-sea music-low-loud look-soft-dark]
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

## Appearance

Darkroom's own look is deliberately plain; the colours come from your photos through `darkroom develop`.
`theme` in `darkroom.json` overrides any colour or font variable
(`"theme": { "font": "Georgia, serif", "accent": "#c33", "text-size": "1.3rem" }`), and a passage tagged
`[stylesheet]` can restyle anything, including your own atmospheres:

```css
#dr .dr-atmos[data-atmosphere="frost"] { background: linear-gradient(180deg, rgba(200, 220, 255, 0.12), rgba(0, 0, 0, 0.2)); }
```

## Directives

Lines starting with `@`. Options are `key=value`, times are in seconds.

| Directive | Does |
| --- | --- |
| `@motif warm` | show a picture for this motif or quality now (`look=warm-vivid`, `fade=2`) |
| `@look soft-dark` | change the look of the current picture |
| `@atmosphere soft-dark` / `@overlay snow` | change atmosphere or particles mid-passage (`none` clears) |
| `@nudge dread+10 longing-5` | change feelings |
| `@turn $dread >= 55` | make this passage a threshold turn (`once=false` to allow repeats) |
| `@when $longing > 25` | a drifting scene is only chosen while this holds |
| `@drift town else=Passage` | go to the best-fitting drifting scene now |
| `@resume` | continue to where the player was heading before the turn |
| `@bg pier` | a specific picture or video (library id or file). `fade=2`, `fit=contain`, `pos=top`, `move=in\|out\|left\|right` (slow drift), `time=30`, `filter="grayscale(1)"`. `@bg none` goes to black. |
| `@bgvideo rain` | looping, silent background video |
| `@image letter pos=middle` | picture on top (`pos=left\|center\|right\|middle\|full`, `id=x`, `width=40%`); `@image clear` |
| `@music low-slow` | a sound mood (developed or named in darkroom.json) or a file; `volume=0.7`, `fade=3`; `@music stop` |
| `@ambience busy-quiet` | second looping channel for room tone, rain, traffic |
| `@sfx door` / `@voice line-03` | play a sound once / a voice line |
| `@stop` | stop music and ambience (`@stop music`, `fade=4`) |
| `@video tide` | full-screen cut-scene; tap skips (`skip=false` to force watching); music dips meanwhile |
| `@wait 1.5` | pause |
| `@card "The River" kicker="Chapter Two"` | full-screen chapter card (an optional second quoted text is a subtitle) |
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
  "scene": {                     // the developed moods (moods.json) are added to these
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

More styling: a passage tagged `[stylesheet]` (style `#dr[data-look="soft-dark"]`, `body[data-passage="the-pier"]`, …).
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
tools/make-placeholders.sh   # regenerate the example piece's placeholder media (then: darkroom develop template)
```
