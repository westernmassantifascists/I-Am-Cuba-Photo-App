# THE SURVEY: "Station Zero"

A single 15-second shot for *The Survey*, built entirely by a Blender Python script.

## The shot

It's night on open moorland in fog. A surveyor's theodolite stands on its wooden tripod
with a lantern hanging from the head. Nobody is with it. A steel chain tape runs through
the grass to the first stake. From there a line of white-flagged laths, one every 10 m,
runs straight away over a low rise.

On the crest stands something tall and thin, almost lost in the fog.

The camera creeps in over the instrument's shoulder. The lantern flickers. Four times it
gutters and goes out for a few frames. Each time it comes back, the figure is standing
further down the line, closer. It never moves while the light is on. On the last relight
it is at the first stake, ten metres away. Focus racks slowly off the instrument onto it.
A strip of the same white flagging tape is tied around its wrist.

| Frames | Beat |
|---|---|
| 1–95 | Establish: instrument, lantern, the line, a shape on the crest (110 m) |
| 96 · 168 · 232 · 292 | Blackouts (4 frames each). The figure moves to 81 → 56 → 34 → 19 m |
| 330 | Last blackout. The figure is at the first stake (10 m) |
| 340–356 | Focus racks from the theodolite to the figure. Hold to 360 |

Blackouts are marked on the timeline as `Dark 1` to `Dark 5`, which makes them easy cut points
or sound sync points (lantern hiss, a step in wet grass, nothing at all).

## The look

The shot is graded black and white, after the gothic looks in the Soy Cuba app
(NOCTURNE/ESPECTRO). The compositor converts to grey with a blue-leaning channel mix,
then adds fog glow around the lantern, crushed blacks, capped highlights, a soft vignette,
midtone-weighted grain that changes every frame, and a touch of lens barrel. The frame is
2.39:1 at 2048 × 858.

Lighting has two sources: a low moon behind the far end of the line that backlights the
fog and throws the figure's shadow toward camera, and the lantern, which lights only the
instrument and the first few metres.

## Running it

Requirements: **Blender 5.0 or later**. On 4.2–4.5 the scene still builds, but the
black-and-white compositor is skipped because the compositor API changed in 5.0.

- **In Blender**: open the *Scripting* workspace, open `the_survey_station_zero.py`, and
  click **Run Script**. It replaces everything in the current file.
- **Build and save a .blend from a terminal**:
  `blender --background --python the_survey_station_zero.py`
- **Render a quick test frame**:
  `blender -b --python the_survey_station_zero.py -- --still 200 --samples 64 --percent 50`
- **Render the shot** to `render/` as a PNG sequence:
  `blender -b --python the_survey_station_zero.py -- --animation`

Other flags: `--grass N` sets the number of grass parents, `--no-grade` renders the raw colour
pass, `--no-save` skips writing the .blend, and `--out path.png` sets the still's filename.

Cycles is used throughout because the volumetric fog needs it. The two preview PNGs here
were rendered at 40% size with 64 samples and reduced grass, so they are noisier than a
full render. A final render at 256 samples is heavy on CPU because of the fog and grass, so
use a GPU if you have one.

## Tuning

All the dials are at the top of the script in the `TUNING` block:

- `FIGURE_STEPS`: when the figure moves and where to. Blackouts are generated from it, so
  adding or removing a step changes the lantern too.
- `FOG_DENSITY`, `GROUND_FOG`, `MOON_STRENGTH`, `LANTERN_WATTS`: how much you can see.
- `BW_WEIGHTS`, `GRAIN`, `VIGNETTE`, `GLOW`: the film look.
- `GRASS_PARENTS`, `GRASS_CHILDREN`: grass density, which affects render time.
- `SEED`: re-rolls stake tilt, flag shapes and the lantern flicker.

## Known gaps / next passes

- **The figure is a blockout** made of primitives. Its proportions are right: 2.75 m tall,
  arms hanging past the knees, a small head tilted to one side. But close up it reads as
  jointed, so sculpt a proper model and swap it in for the object named `It`, keeping the
  object's animation.
- The flagging on the far stakes barely reads in the backlight. If the line needs to be
  clearer, raise `MOON_STRENGTH` or add a faint fill light from camera left.
- There is no sound. The blackouts are the obvious hooks.
