# Dracula's Guest

Bram Stoker's *Dracula's Guest* (1914, public domain), walked in first person in Godot 4.

You leave the Quatre Saisons in Munich on Walpurgis Night. At the crossroads Johann the coachman
refuses to take the road into the valley, and you go on alone: down through the desolate country,
the deserted village and the snowstorm, to the marble tomb of the Countess Dolingen of Gratz.

Built the Darkroom way: the story is written as passages tagged with moods, and **three feelings —
dread, cold and defiance —** steer it:

- **Threshold turns.** When cold crosses a line the snowstorm comes, wherever you are; when dread
  does, the wolves answer the lightning.
- **Drifting scenes.** The moments along the valley road come in the order that best fits how you
  feel; each walk is different.
- **The world follows the feelings.** Fog, colour, snow and the music's layers rise with dread and
  cold; cold creeps in while you walk, faster when you stand still and in the storm.
- **Three endings,** chosen by your strongest feeling. Each ends with Dracula's telegram.

## How it looks

Walking is first person; **every passage is a composed shot.** When the story speaks, the camera
cuts (through black) to a framed tableau for that passage — the horse's head and the day's card on
the hotel table, the stranger on the crest through a long lens, the tomb's doorway seen from inside
while the hail comes down — letterboxed to 2.39:1, drifting slowly, with the text set into the dark
side of the frame. When the text says *walk on*, you have the road back.

The look is **developed from the material**, not chosen: `tools/develop-look.mjs` measures every
scanned texture, every scan's own photograph and every sky (with Darkroom's `develop`) and writes
`godot/data/look.json` — the base grade (saturation, contrast, grain, the tint of the material's
darkest and lightest colours), the interface palette, and the picture moods the material falls into
(`muted-dark`, `dark`, `vivid-warm`, `cool-hard`, `hard-muted`, `bright-muted`). Story passages pick a
mood with `look-<mood>`; otherwise a passage takes the mood its sky was developed into. A film pass
(`godot/scripts/grade.gdshader`: halation, split-tone, grain, gate weave, vignette) puts it on screen,
and dread and cold pull it further. Swap the scans and re-run the tool, and the piece looks different.

Type: Old Standard TT for the text and IM Fell English small caps for titles and choices (both SIL
Open Font License, in `godot/fonts`).

## Material

| What | Where from | Licence |
| --- | --- | --- |
| Text | Bram Stoker, *Dracula's Guest* (1914), via Wikisource | public domain |
| 22 photogrammetry scans (rocks, boulders, stumps, dead trunks, roots, firs, ferns, a gothic statue, a modular stone fort — the village ruins and churchyard wall —, an oak castle door, an iron gate, a carved horse's head) | Poly Haven | CC0 |
| 11 scanned textures (marble, medieval blocks, mossy walls, plaster, slate, path, snow …) | Poly Haven | CC0 |
| 7 real photographed skies (a day at Kloppenheim, Germany, plus snow) | Poly Haven | CC0 |
| Film: British Pathé street traffic (1896–1903); Georges Méliès, *Le Chevalier des Neiges* (1913) | Wikimedia Commons | public domain |
| Fonts: Old Standard TT, IM Fell English SC | Google Fonts | SIL OFL 1.1 |
| Music | composed on the Darkroom groovebox (`../darkroom/lib/groovebox.mjs`) | ours |

`tools/fetch.mjs` writes the full list with authors to `CREDITS.md`.

## Setting it up

Needs Node 20+, ffmpeg and Godot 4.3+ (Windows: `winget install OpenJS.NodeJS.LTS Gyan.FFmpeg GodotEngine.GodotEngine`).

```
cd dracula-guest
node tools/fetch.mjs          # scans, textures, skies (~130 MB) and the film clips
node tools/render-music.mjs   # the score, from music/score.json
node tools/compile-story.mjs  # story/draculas-guest.twee -> godot/data/story.json
node tools/develop-look.mjs   # optional: re-develop the look from the scans (godot/data/look.json is committed)
```

Then open `godot/project.godot` in Godot and press Play (F5). The first open imports the scans,
which takes a minute.

**Controls:** W A S D or arrows to walk, mouse to look, Shift to hurry, click to choose; Esc releases
the mouse. A gamepad works too.

## Changing it

- **The story:** `story/draculas-guest.twee` (Darkroom format). Tags: `at-<station>` (where it happens),
  `music-<bed>`, `atmosphere-<weather>`, `look-<mood>` (a developed mood from `look.json`), `drift-road` + `feel-<feeling>` for the
  wayside moments, `@turn` for threshold turns. Recompile with `node tools/compile-story.mjs`.
- **The feelings:** `darkroom.json` (`meters`). How the world answers them: `godot/scripts/main.gd`
  (`WEATHER`, `_feel`, `_process`).
- **The shots:** `godot/data/shots.json` — for each passage: an anchor (a named place in the world),
  camera position and aim relative to it, lens (fov), a slow move, which side the text sits on, and
  things shown only in that shot. Anchors are set where the places are built in `main.gd`.
- **The music:** `music/score.json` — instruments and step patterns for the groovebox. Every loop is
  8 bars at 66 BPM so beds and feeling layers stay in sync. Re-render with `node tools/render-music.mjs`.
- **What's downloaded:** `sources.json`. Film clip start times and lengths are there too.
- **The route and places:** `ROUTE`, `_build_village`, `_build_cemetery` in `godot/scripts/main.gd`.

`godot/scripts/story.gd` is a general Darkroom runtime for Godot: it plays any compiled Darkroom story
(meters, conditions, turns, drift, endings) and only sends signals, so another piece can reuse it with a
different world.

## Playing it in a browser

```
godot --headless --path godot --export-release Web ../.cache/web/index.html
node tools/web-pack.mjs      # -> .cache/site/, the engine and game cut into 14 MB pieces
```

`.cache/site/` is a static site (single-threaded build, no special server headers needed). Its page
(`web/index.html`) fetches the pieces and hands them to Godot whole. The browser uses Godot's
Compatibility renderer, so the trees are baked cut-outs (`godot/tools/bake_trees.gd`, run once with a
GPU; the pictures in `godot/assets/trees` are committed) and textures are stored as lossy WebP.

## Testing

The game can play itself, headless, choosing at random:

```
godot --headless --path godot -- --autoplay --seed=3
```

It walks the route, prints each passage and the ending it reached, and exits 0 if the story completed.
Add `--shots=<folder>` (with a display) to save a screenshot of every passage.
`--views=<folder>` renders a still of every composed shot in its weather and look, with its text, and
quits; `--only=the_tomb,the_bier` limits it to those passages.
