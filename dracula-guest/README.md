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

## Material

| What | Where from | Licence |
| --- | --- | --- |
| Text | Bram Stoker, *Dracula's Guest* (1914), via Wikisource | public domain |
| 18 photogrammetry scans (rocks, boulders, stumps, dead trunks, roots, firs, ferns, a gothic statue) | Poly Haven | CC0 |
| 11 scanned textures (marble, medieval blocks, mossy walls, plaster, slate, path, snow …) | Poly Haven | CC0 |
| 7 real photographed skies (a day at Kloppenheim, Germany, plus snow) | Poly Haven | CC0 |
| Film: British Pathé street traffic (1896–1903); Georges Méliès, *Le Chevalier des Neiges* (1913) | Wikimedia Commons | public domain |
| Music | composed on the Darkroom groovebox (`../darkroom/lib/groovebox.mjs`) | ours |

`tools/fetch.mjs` writes the full list with authors to `CREDITS.md`.

## Setting it up

Needs Node 20+, ffmpeg and Godot 4.3+ (Windows: `winget install OpenJS.NodeJS.LTS Gyan.FFmpeg GodotEngine.GodotEngine`).

```
cd dracula-guest
node tools/fetch.mjs          # scans, textures, skies (~130 MB) and the film clips
node tools/render-music.mjs   # the score, from music/score.json
node tools/compile-story.mjs  # story/draculas-guest.twee -> godot/data/story.json
```

Then open `godot/project.godot` in Godot and press Play (F5). The first open imports the scans,
which takes a minute.

**Controls:** W A S D or arrows to walk, mouse to look, Shift to hurry, click to choose; Esc releases
the mouse. A gamepad works too.

## Changing it

- **The story:** `story/draculas-guest.twee` (Darkroom format). Tags: `at-<station>` (where it happens),
  `music-<bed>`, `atmosphere-<weather>`, `look-<grade>`, `drift-road` + `feel-<feeling>` for the
  wayside moments, `@turn` for threshold turns. Recompile with `node tools/compile-story.mjs`.
- **The feelings:** `darkroom.json` (`meters`). How the world answers them: `godot/scripts/main.gd`
  (`WEATHER`, `LOOKS`, `_feel`, `_process`).
- **The music:** `music/score.json` — instruments and step patterns for the groovebox. Every loop is
  8 bars at 66 BPM so beds and feeling layers stay in sync. Re-render with `node tools/render-music.mjs`.
- **What's downloaded:** `sources.json`. Film clip start times and lengths are there too.
- **The route and places:** `ROUTE`, `_build_village`, `_build_cemetery` in `godot/scripts/main.gd`.

`godot/scripts/story.gd` is a general Darkroom runtime for Godot: it plays any compiled Darkroom story
(meters, conditions, turns, drift, endings) and only sends signals, so another piece can reuse it with a
different world.

## Testing

The game can play itself, headless, choosing at random:

```
godot --headless --path godot -- --autoplay --seed=3
```

It walks the route, prints each passage and the ending it reached, and exits 0 if the story completed.
Add `--shots=<folder>` (with a display) to save a screenshot of every passage and stretch of road.
