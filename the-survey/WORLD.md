# THE SURVEY: world bible

## The premise

A three-person survey crew is sent to run a line across an empty field: a boundary
dispute, routine work. The line runs to a low dry-stone shelter in the middle of the
field. The shelter is small from outside. Its doorway opens onto a room, the room onto
another, and the rooms do not end.

The crew kept surveying. Their stakes, lanterns and chain tape are still in there.
They are not.

The inside is called **the Holding**. The crew's field book calls it that, then stops
calling it anything.

## The rules of the Holding

1. **Every room is the same room, almost.** Five metres square, three metres high, rough
   stone, a flagstone floor. Each room joins its neighbours through doorways only, never
   open gaps. The differences between rooms are small errors, not features: a stone out
   of place, a doorway a hand's width too far left.
2. **The line is straight; the Holding isn't.** One run of doorways (the **Enfilade**) goes
   dead straight from the entrance, and the crew's stakes follow it. Off to either side
   the rooms form a maze that loops back on itself. Mapping it never closes: walk four
   rooms around a square and you are not where you started.
3. **The only light is what the survey brought.** Lanterns sit on the floors where the
   crew left them, at every station along the Enfilade and scattered far off in rooms no
   one should have reached. They are still burning.
4. **The lanterns fail together.** All the lights in the Holding gutter and go out at the
   same moment, for a few seconds, then catch again. Nothing moves while the light is on.
5. **Windows show elsewhere.** Some walls have windows instead of doorways. They don't look
   outside. They look onto places: the field the crew came from, a sea at night under a
   hazed moon, a colonnade with crows, a flooded hall. The views move and the light from
   them is real, but you cannot climb through.
6. **The water rises with the station number.** Deeper along the Enfilade, the floors are
   wet, then flooded. One of the windows shows a hall where the water is already high.
7. **She is always in the Enfilade.** A woman in white stands in a doorway far down the
   line, too far to see clearly. Each time the lanterns go out, she is closer. She never
   moves while the light is on. Things that are closer to her are more like the windows:
   real, moving, and not quite here.
8. **The faces wait in doorways.** In the dark rooms off the Enfilade, faces wait in the
   doorways: pale, eyes blackened, looking down or at you. They are the same face.

## Places (the windows)

| Window | What it shows | Plate |
|---|---|---|
| **Station Zero** | The field the crew started from, seen from the shelter. Fog, a stake | `window_field.jpg` |
| **The Colonnade** | Stone pillars, a white sky, crows | `colonnade.mp4` |
| **The Sea Wall** | Night sea, a moon in haze, waves that never reach anything | `sea_moon.mp4` |
| **The Wash** | A flooded hall. She lies in the water and rises | `water_bride.mp4`, `water_bride.jpg` |
| **The Catacomb** | Broken brick arches, a small crowned figure (not yet placed) | `catacomb_scan.png` |

## Her

The bride (`bride.jpg`) in the Enfilade. Her faces are the close plates: `face_down.jpg`
in the doorways, `face_front.jpg` when she reaches you, `face_tilt_back.jpg` in the dark
after, and the nose-ring plates (`face_ring*.jpg`) for later. The film never says who
she is. The crew's field book has one line about her: *"Rodperson reports a figure on the
line. Instructed to hold the rod plumb."*

## How it's shot

- **Camera:** handheld eye-height walk, slow, glancing at what it passes. No cuts inside a
  walk; the blackouts are the cuts.
- **Picture:** black and white, true blacks, real photographs as the only bright things
  in frame, fine grain.
- **Sound (to do):** lantern hiss, footsteps in water, the windows' own sound (sea,
  crows) bleeding through the stone and cutting out in every blackout.

## In Blender

`the_survey_world.py` builds a 13 × 15-room section of the Holding. Change `SEED` for a
different maze with the same rules. The plates are read from `plates/`, and `PLATES` in
the script maps each name to its file and crop. Windows and faces are placed in
`build_plates()`.
