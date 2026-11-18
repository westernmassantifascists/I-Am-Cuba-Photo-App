"""
THE SURVEY - "The Enfilade"
An endless stone world for Blender 5.x, with the film's own photographs and clips
placed inside it as image planes.

The world: a grid of identical low stone rooms that goes on in every direction, every
room joined to its neighbours by doorways, lit only by lanterns the survey left behind.
Some walls have windows that look out onto other places (the field, the sea, a flooded
hall, a colonnade with crows): those views are the real footage. Faces wait in dark
doorways. A bride stands at the far end of the line of doorways, and every time the
lanterns fail she is one room closer.

See WORLD.md for the rules of the place.

The photographs and clips are read from ./plates/ next to this script (kept out of git).
Expected files are listed in PLATES below; a missing one becomes a grey card.

Run it:
  * In Blender: Scripting workspace -> Open this file -> Run Script.
  * Terminal, build and save the_survey_world.blend:
        blender --background --python the_survey_world.py
  * Render one test frame:
        blender -b --python the_survey_world.py -- --still 330 --samples 64 --percent 50
  * Render the whole piece (frames 1-864, 36 s) to ./render/:
        blender -b --python the_survey_world.py -- --animation
"""

import math
import os
import random
import sys

import bpy
import bmesh
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------------------
# TUNING
# --------------------------------------------------------------------------------------
FPS = 24
FRAME_END = 864                     # 36 seconds

CELL = 5.0                          # room size (m)
WALL_T = 0.45
WALL_H = 3.0
DOOR_W, DOOR_H = 1.2, 2.25
WIN_W, WIN_H, WIN_SILL = 1.5, 1.15, 0.85
GRID_X = range(0, 13)               # world extent in rooms (it only needs to *look* endless)
GRID_Y = range(-1, 14)
ROUTE_X = 6                         # the enfilade: the column of rooms the camera walks
EXTRA_DOORS = 0.18                  # loops in the maze, so it never quite makes sense
FAR_LANTERNS = 0.1                  # chance a distant room still has a lantern burning

LANTERN_WATTS = 110.0
HAZE = 0.02                         # air density: lantern glow and depth falloff
EXPOSURE = 1.6                      # lifts the stone; the plates are compensated

# Blackouts (all lanterns and all windows go dark) and where the bride is after each.
# She stands in a doorway of the enfilade, facing the camera; y is metres along it.
BRIDE_STEPS = [(1, 40.0), (262, 35.0), (420, 30.0), (562, 27.5), (700, 25.0)]
BLACKOUT_FRAMES = 5
FINAL_BLACKOUT = 760                # then her face, right in front of the lens
FACE_HOLD = (766, 812)
SUBLIMINAL = (836, 840)             # four frames of the tilted-back face in the dark

# Film look
GRAIN = 0.03
VIGNETTE = 0.45
GLOW = 0.3

SEED = 1964

HERE = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
PLATE_DIR = os.path.join(HERE, "plates")

# name: (file, crop (u0, v0, u1, v1) with v from the bottom, video offset frames)
PLATES = {
    "field":       ("window_field.jpg",    (0.33, 0.36, 0.83, 0.80), 0),
    "sea":         ("sea_moon.mp4",        (0.1, 0.2, 0.95, 0.92), 0),
    "colonnade":   ("colonnade.mp4",       (0.02, 0.06, 0.88, 1.0), 66),
    "water":       ("water_bride.mp4",     (0.08, 0.07, 0.92, 0.95), 0),
    "bride":       ("bride.jpg",           (0.22, 0.0, 0.78, 1.0), 0),
    "face_down":   ("face_down.jpg",       (0.0, 0.0, 1.0, 1.0), 0),
    "face_front":  ("face_front.jpg",      (0.0, 0.0, 1.0, 1.0), 0),
    "face_tilt":   ("face_tilt_back.jpg",  (0.0, 0.0, 1.0, 1.0), 0),
}

# --------------------------------------------------------------------------------------
rng = random.Random(SEED)
IS_5X = bpy.app.version >= (5, 0, 0)


def log(msg):
    print(f"[The Survey] {msg}")


def cell_centre(i, j):
    return Vector(((i - ROUTE_X) * CELL, j * CELL + CELL / 2, 0.0))


# --------------------------------------------------------------------------------------
# Scene reset and generic helpers
# --------------------------------------------------------------------------------------
def reset_scene():
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras,
                 bpy.data.curves, bpy.data.images):
        for block in list(coll):
            if block.users == 0 or coll is not bpy.data.images:
                coll.remove(block)
    for coll in list(scene.collection.children):
        bpy.data.collections.remove(coll)
    for ng in list(bpy.data.node_groups):
        if ng.bl_idname == 'CompositorNodeTree':
            bpy.data.node_groups.remove(ng)
    scene.timeline_markers.clear()
    scene.name = "The Survey - The Enfilade"
    return scene


def collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def mesh_object(name, bm, coll, material=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    obj = bpy.data.objects.new(name, me)
    coll.objects.link(obj)
    if material:
        me.materials.append(material)
    return obj


def add_box(bm, size, matrix):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=matrix @ Matrix.Diagonal(Vector((*size, 1.0))),
                        verts=geom["verts"])


def add_cylinder(bm, radius, depth, matrix, segments=16, radius2=None):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius,
                          radius2=radius if radius2 is None else radius2,
                          depth=depth, matrix=matrix)


def fcurves_of(idblock):
    """F-curves of an ID's action, for both the 4.x and the 5.x (layered) action API."""
    ad = idblock.animation_data
    if not ad or not ad.action:
        return []
    action = ad.action
    if hasattr(action, "fcurves") and not hasattr(action, "layers"):
        return list(action.fcurves)
    curves = []
    slot = getattr(ad, "action_slot", None)
    for layer in action.layers:
        for strip in layer.strips:
            bag = strip.channelbag(slot) if slot else None
            if bag:
                curves.extend(bag.fcurves)
    if not curves and hasattr(action, "fcurves"):
        curves = list(action.fcurves)
    return curves


def set_interp(idblock, interp, path=None):
    for fc in fcurves_of(idblock):
        if path is None or fc.data_path == path:
            for kp in fc.keyframe_points:
                kp.interpolation = interp


def show_between(obj, start, end):
    """Visible (render and viewport) only for frames start..end."""
    for f, hidden in ((1, True), (start, False), (end + 1, True)):
        if f < 1:
            continue
        obj.hide_render = hidden
        obj.hide_viewport = hidden
        obj.keyframe_insert("hide_render", frame=f)
        obj.keyframe_insert("hide_viewport", frame=f)
    set_interp(obj, 'CONSTANT')


# --------------------------------------------------------------------------------------
# The light that fails: one property drives every lantern and every view of elsewhere
# --------------------------------------------------------------------------------------
def build_flame(coll):
    ctl = bpy.data.objects.new("Survey Lights", None)
    coll.objects.link(ctl)
    ctl["flame"] = 1.0
    blackouts = [f for f, _ in BRIDE_STEPS[1:]] + [FINAL_BLACKOUT]

    def k(frame, v):
        ctl["flame"] = v
        ctl.keyframe_insert('["flame"]', frame=frame)

    frame = 1
    while frame <= FRAME_END:
        v = 1.0 + rng.uniform(-0.1, 0.06)
        for b in blackouts:
            if b - 12 <= frame < b:
                v *= rng.uniform(0.3, 0.85)
        k(frame, v)
        frame += rng.choice((2, 3, 3, 4, 5))
    for b in blackouts:
        k(b - 1, 0.2)
        k(b, 0.0)
        k(b + BLACKOUT_FRAMES - 1, 0.0)
        if b != FINAL_BLACKOUT:
            k(b + BLACKOUT_FRAMES, 1.3)
            k(b + BLACKOUT_FRAMES + 3, 1.0)
    # after the final blackout only her face is lit; the world stays dark
    def doomed(f):
        inside = any(b < f < b + BLACKOUT_FRAMES - 1 for b in blackouts)
        return inside or f > FINAL_BLACKOUT + BLACKOUT_FRAMES - 1

    for fc in fcurves_of(ctl):
        while True:
            hit = next((kp for kp in fc.keyframe_points if doomed(kp.co.x)), None)
            if hit is None:
                break
            fc.keyframe_points.remove(hit)
    set_interp(ctl, 'LINEAR')
    for fc in fcurves_of(ctl):
        for kp in fc.keyframe_points:
            if kp.co.y == 0.0:
                kp.interpolation = 'CONSTANT'
    return ctl


def drive_by_flame(target, path, scale, ctl):
    fc = target.driver_add(path)
    drv = fc.driver
    drv.type = 'SUM'
    var = drv.variables.new()
    var.name = "flame"
    var.type = 'SINGLE_PROP'
    var.targets[0].id_type = 'OBJECT'
    var.targets[0].id = ctl
    var.targets[0].data_path = '["flame"]'
    gen = fc.modifiers[0] if len(fc.modifiers) else fc.modifiers.new('GENERATOR')
    gen.coefficients = (0.0, scale)


# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
def stone_material(name, scale, base, mortar_depth=0.7):
    """Rough dry-stone: Voronoi cells as stones, dark gaps between, noise on top.
    Uses world position so every wall and floor shares one continuous pattern."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.92
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (scale, scale, scale * 1.7)   # flatter courses
    nt.links.new(geo.outputs["Position"], mapping.inputs["Vector"])
    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs["Randomness"].default_value = 0.85
    nt.links.new(mapping.outputs["Vector"], vor.inputs["Vector"])
    cells = nt.nodes.new("ShaderNodeTexVoronoi")
    cells.inputs["Randomness"].default_value = 0.85
    nt.links.new(mapping.outputs["Vector"], cells.inputs["Vector"])
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 14.0
    grain.inputs["Detail"].default_value = 10.0
    nt.links.new(geo.outputs["Position"], grain.inputs["Vector"])

    gap = nt.nodes.new("ShaderNodeMapRange")
    gap.inputs["From Min"].default_value = 0.0
    gap.inputs["From Max"].default_value = 0.06
    nt.links.new(vor.outputs["Distance"], gap.inputs["Value"])

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (base * 0.55, base * 0.55, base * 0.52, 1)
    ramp.color_ramp.elements[1].color = (base * 1.35, base * 1.3, base * 1.25, 1)
    nt.links.new(cells.outputs["Color"], ramp.inputs["Factor"])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    nt.links.new(gap.outputs["Result"], mix.inputs["Factor"])
    mix.inputs[6].default_value = (0.02, 0.02, 0.02, 1)
    nt.links.new(ramp.outputs["Color"], mix.inputs[7])
    mix.blend_type = 'MIX'
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])

    height = nt.nodes.new("ShaderNodeMath")
    height.operation = 'MULTIPLY_ADD'
    nt.links.new(grain.outputs["Factor"], height.inputs[0])
    height.inputs[1].default_value = 0.25
    nt.links.new(gap.outputs["Result"], height.inputs[2])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = mortar_depth
    bump.inputs["Distance"].default_value = 0.03
    nt.links.new(height.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def simple(name, color, rough=0.6, metal=0.0, **extra):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    for k, v in extra.items():
        bsdf.inputs[k].default_value = v
    return mat


def plate_material(name, plate, ctl, mode='opaque', strength=1.0):
    """The photograph or clip as light, with its crop. mode 'luma' keys out the black
    surround so a face floats in the dark. The back face is black. Strength follows
    the lanterns, so the views go dark in a blackout too."""
    fname, crop, offset = PLATES[plate]
    path = os.path.join(PLATE_DIR, fname)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    strength *= 2.0 ** -EXPOSURE          # photographs keep their true brightness
    em.inputs["Strength"].default_value = strength
    if os.path.exists(path):
        img = bpy.data.images.load(path, check_existing=True)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.extension = 'CLIP'
        if fname.endswith(".mp4"):
            img.source = 'MOVIE'
            iu = tex.image_user
            iu.frame_duration = img.frame_duration
            iu.frame_start = 1
            iu.frame_offset = offset
            iu.use_cyclic = True
            iu.use_auto_refresh = True
        uv = nt.nodes.new("ShaderNodeTexCoord")
        mp = nt.nodes.new("ShaderNodeMapping")
        mp.inputs["Location"].default_value = (crop[0], crop[1], 0)
        mp.inputs["Scale"].default_value = (crop[2] - crop[0], crop[3] - crop[1], 1)
        nt.links.new(uv.outputs["UV"], mp.inputs["Vector"])
        nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
        # black and white, whatever the source
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(tex.outputs["Color"], bw.inputs["Color"])
        colour = bw.outputs["Val"]
    else:
        log(f"Missing plate {path}; using a grey card.")
        colour = None
        em.inputs["Color"].default_value = (0.3, 0.3, 0.3, 1)
    if colour is not None:
        nt.links.new(colour, em.inputs["Color"])
    drive_by_flame(em.inputs["Strength"], "default_value", strength, ctl)

    shader = em.outputs["Emission"]
    if mode == 'luma' and colour is not None:
        key = nt.nodes.new("ShaderNodeMapRange")
        key.inputs["From Min"].default_value = 0.025
        key.inputs["From Max"].default_value = 0.16
        nt.links.new(colour, key.inputs["Value"])
        clear = nt.nodes.new("ShaderNodeBsdfTransparent")
        mixk = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(key.outputs["Result"], mixk.inputs[0])
        nt.links.new(clear.outputs["BSDF"], mixk.inputs[1])
        nt.links.new(shader, mixk.inputs[2])
        shader = mixk.outputs[0]
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    black = nt.nodes.new("ShaderNodeBsdfDiffuse")
    black.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1)
    back = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(geo.outputs["Backfacing"], back.inputs[0])
    nt.links.new(shader, back.inputs[1])
    nt.links.new(black.outputs["BSDF"], back.inputs[2])
    nt.links.new(back.outputs[0], out.inputs["Surface"])
    return mat


def plate_aspect(plate):
    fname, crop, _ = PLATES[plate]
    path = os.path.join(PLATE_DIR, fname)
    w, h = 4, 3
    if os.path.exists(path):
        img = bpy.data.images.load(path, check_existing=True)
        if fname.endswith(".mp4"):
            img.source = 'MOVIE'
        w, h = img.size[:] if img.size[0] else (4, 3)
    return (w * (crop[2] - crop[0])) / (h * (crop[3] - crop[1]))


def image_plane(name, coll, mat, height, aspect, matrix):
    """A UV-mapped card, `height` tall, centred on matrix, facing the matrix's -Y."""
    w = height * aspect
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w / 2, 0, -height / 2), (w / 2, 0, -height / 2),
                    (w / 2, 0, height / 2), (-w / 2, 0, height / 2)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for loop, co in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop.uv = co
    me.materials.append(mat)
    obj = bpy.data.objects.new(name, me)
    obj.matrix_world = matrix
    coll.objects.link(obj)
    obj.visible_shadow = False
    return obj


# --------------------------------------------------------------------------------------
# The maze of rooms
# --------------------------------------------------------------------------------------
def plan_world():
    """Returns a dict of wall openings: key (axis, i, j) -> 'door' | 'window'.
    ('h', i, j) is the wall on the south side of room (i, j);
    ('v', i, j) is the wall on the west side of room (i, j). Absent = solid."""
    cells = [(i, j) for i in GRID_X for j in GRID_Y]
    inside = set(cells)
    openings = {}
    # the enfilade: a straight run of doorways, as far as the world goes
    for j in list(GRID_Y)[1:]:
        openings[('h', ROUTE_X, j)] = 'door'
    visited = {(ROUTE_X, j) for j in GRID_Y}
    frontier = []

    def push(c):
        i, j = c
        for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (i + d[0], j + d[1])
            if n in inside and n not in visited:
                frontier.append((c, n))

    for c in sorted(visited):
        push(c)
    while frontier:
        a, b = frontier.pop(rng.randrange(len(frontier)))
        if b in visited:
            continue
        visited.add(b)
        openings[wall_key(a, b)] = 'door'
        push(b)
    # extra doorways, so the place loops back on itself
    for (i, j) in cells:
        for n in ((i + 1, j), (i, j + 1)):
            if n in inside and wall_key((i, j), n) not in openings and rng.random() < EXTRA_DOORS:
                openings[wall_key((i, j), n)] = 'door'
    return openings


def wall_key(a, b):
    (i1, j1), (i2, j2) = sorted((a, b))
    if i1 == i2:
        return ('h', i1, j2)
    return ('v', i2, j1)


def build_wall(bm, axis, i, j, kind):
    """One wall between rooms, as stone blocks around an optional opening."""
    if axis == 'h':
        centre = Vector(((i - ROUTE_X) * CELL, j * CELL, 0))
        frame = Matrix.Translation(centre)
    else:
        centre = Vector(((i - ROUTE_X) * CELL - CELL / 2, j * CELL + CELL / 2, 0))
        frame = Matrix.Translation(centre) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
    L = CELL + WALL_T                      # overlap at the corners

    def piece(u0, u1, z0, z1):
        if u1 - u0 > 0.01 and z1 - z0 > 0.01:
            add_box(bm, (u1 - u0, WALL_T, z1 - z0),
                    frame @ Matrix.Translation(((u0 + u1) / 2, 0, (z0 + z1) / 2)))

    if kind is None:
        piece(-L / 2, L / 2, 0, WALL_H)
        return
    w, z0, z1 = (DOOR_W, 0.0, DOOR_H) if kind == 'door' else (WIN_W, WIN_SILL, WIN_SILL + WIN_H)
    piece(-L / 2, -w / 2, 0, WALL_H)
    piece(w / 2, L / 2, 0, WALL_H)
    piece(-w / 2, w / 2, z1, WALL_H)
    piece(-w / 2, w / 2, 0, z0)


def build_rooms(coll, mats, openings):
    bm_walls = bmesh.new()
    for i in list(GRID_X) + [GRID_X[-1] + 1]:
        for j in list(GRID_Y) + [GRID_Y[-1] + 1]:
            if i in GRID_X or i == GRID_X[-1] + 1:
                if i in GRID_X:
                    build_wall(bm_walls, 'h', i, j, openings.get(('h', i, j)))
                if j in GRID_Y:
                    build_wall(bm_walls, 'v', i, j, openings.get(('v', i, j)))
    walls = mesh_object("Rooms", bm_walls, coll, mats["stone"])
    bev = walls.modifiers.new("Worn Edges", 'BEVEL')
    bev.width = 0.04
    bev.segments = 2

    x0 = (GRID_X[0] - ROUTE_X) * CELL - CELL / 2
    x1 = (GRID_X[-1] - ROUTE_X) * CELL + CELL / 2
    y0, y1 = GRID_Y[0] * CELL, (GRID_Y[-1] + 1) * CELL
    bm = bmesh.new()
    add_box(bm, (x1 - x0, y1 - y0, 0.2), Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, -0.1)))
    mesh_object("Floors", bm, coll, mats["floor"])
    bm = bmesh.new()
    add_box(bm, (x1 - x0, y1 - y0, 0.3),
            Matrix.Translation(((x0 + x1) / 2, (y0 + y1) / 2, WALL_H + 0.15)))
    mesh_object("Ceilings", bm, coll, mats["ceiling"])


def build_water(coll, mats, rooms):
    bm = bmesh.new()
    for (i, j) in rooms:
        c = cell_centre(i, j)
        add_box(bm, (CELL + WALL_T, CELL + WALL_T, 0.01), Matrix.Translation(c + Vector((0, 0, 0.05))))
    mesh_object("Standing Water", bm, coll, mats["water"])


# --------------------------------------------------------------------------------------
# Lanterns and survey stakes
# --------------------------------------------------------------------------------------
def build_lantern(coll, mats, pos, ctl, name):
    bm = bmesh.new()
    add_cylinder(bm, 0.07, 0.03, Matrix.Translation(pos + Vector((0, 0, 0.015))), 16)
    add_cylinder(bm, 0.06, 0.025, Matrix.Translation(pos + Vector((0, 0, 0.22))), 16, radius2=0.02)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        off = Vector((math.cos(a) * 0.062, math.sin(a) * 0.062, 0.11))
        add_cylinder(bm, 0.004, 0.2, Matrix.Translation(pos + off), 6)
    mesh_object(f"{name} Frame", bm, coll, mats["iron"])
    bm = bmesh.new()
    add_cylinder(bm, 0.05, 0.16, Matrix.Translation(pos + Vector((0, 0, 0.11))), 16)
    mesh_object(f"{name} Glass", bm, coll, mats["lantern"])
    light = bpy.data.lights.new(name, 'POINT')
    light.energy = LANTERN_WATTS
    light.shadow_soft_size = 0.03
    light.color = (1.0, 0.9, 0.75)
    lamp = bpy.data.objects.new(name, light)
    lamp.location = pos + Vector((0, 0, 0.12))
    coll.objects.link(lamp)
    drive_by_flame(light, "energy", LANTERN_WATTS, ctl)


def build_stake(bm_stake, bm_flag, pos):
    tilt = Matrix.Rotation(rng.uniform(-0.06, 0.06), 4, 'X') @ Matrix.Rotation(rng.uniform(-0.06, 0.06), 4, 'Y')
    base = Matrix.Translation(pos) @ tilt
    add_box(bm_stake, (0.045, 0.018, 1.2), base @ Matrix.Translation((0, 0, 0.6)))
    top = base @ Matrix.Translation((0, 0, 1.12))
    for k in range(2):
        m = (top @ Matrix.Rotation(rng.uniform(-0.5, 0.5) + math.pi * k, 4, 'Z')
             @ Matrix.Rotation(math.pi - 0.15, 4, 'X') @ Matrix.Translation((0, 0, 0.22)))
        add_box(bm_flag, (0.03, 0.002, 0.44), m)
    add_box(bm_flag, (0.06, 0.03, 0.03), top)


def build_survey(coll, mats, ctl, openings):
    bm_s, bm_f = bmesh.new(), bmesh.new()
    # a stake in every room of the enfilade, just off the centre line
    for j in GRID_Y:
        build_stake(bm_s, bm_f, cell_centre(ROUTE_X, j) + Vector((0.55, -1.2, 0)))
    mesh_object("Stakes", bm_s, coll, mats["wood"])
    mesh_object("Flagging", bm_f, coll, mats["flag"])
    # lanterns along the walk, left on the floor against alternating walls
    for n, j in enumerate(range(0, 6)):
        side = -1 if n % 2 == 0 else 1
        build_lantern(coll, mats, cell_centre(ROUTE_X, j) + Vector((side * 1.9, 1.4, 0)), ctl,
                      f"Lantern {j}")
    # and a few still burning far off, seen through side doorways
    for i in GRID_X:
        for j in GRID_Y:
            if i != ROUTE_X and rng.random() < FAR_LANTERNS:
                build_lantern(coll, mats, cell_centre(i, j) + Vector((rng.uniform(-1.8, 1.8),
                                                                      rng.uniform(-1.8, 1.8), 0)),
                              ctl, f"Far Lantern {i}_{j}")


# --------------------------------------------------------------------------------------
# The plates: views of elsewhere, faces in doorways, the bride
# --------------------------------------------------------------------------------------
def window_view(coll, ctl, plate, i, j, side, height=2.2):
    """A view through the window in the east (side=+1) or west (-1) wall of room (i, j)."""
    c = cell_centre(i, j)
    x = c.x + side * (CELL / 2 + WALL_T / 2 + 0.55)
    centre = Vector((x, c.y, WIN_SILL + WIN_H / 2))
    face_dir = Matrix.Rotation(-side * math.pi / 2, 4, 'Z')   # card faces back into the room
    mat = plate_material(f"View: {plate}", plate, ctl)
    card = image_plane(f"View: {plate}", coll, mat, height, plate_aspect(plate),
                       Matrix.Translation(centre) @ face_dir)
    return card


def doorway_face(coll, ctl, plate, i, j, side, height=1.15, depth=0.45):
    """A face floating in the dark beyond a side doorway of room (i, j)."""
    c = cell_centre(i, j)
    x = c.x + side * (CELL / 2 + depth)
    centre = Vector((x, c.y, 1.5))
    face_dir = Matrix.Rotation(-side * math.pi / 2, 4, 'Z')
    mat = plate_material(f"Doorway: {plate}", plate, ctl, mode='luma', strength=0.8)
    return image_plane(f"Doorway: {plate}", coll, mat, height, plate_aspect(plate),
                       Matrix.Translation(centre) @ face_dir)


def build_plates(coll, ctl, openings):
    # windows: force these walls to be windows, not doorways
    views = [("field", 1, +1), ("colonnade", 3, -1), ("sea", 4, -1), ("water", 4, +1)]
    for plate, j, side in views:
        key = ('v', ROUTE_X + (1 if side > 0 else 0), j)
        openings[key] = 'window'
        window_view(coll, ctl, plate, ROUTE_X, j, side, 1.4 if plate == "sea" else 2.2)
    # a dark doorway on the left of room 2, with a face in it
    openings[('v', ROUTE_X, 2)] = 'door'
    doorway_face(coll, ctl, "face_down", ROUTE_X, 2, -1)

    # the bride, in the doorways of the enfilade
    mat = plate_material("Bride", "bride", ctl, mode='luma', strength=0.9)
    bride = image_plane("Bride", coll, mat, 1.75, plate_aspect("bride"), Matrix.Identity(4))
    for frame, y in BRIDE_STEPS:
        bride.location = (0.0, y + 0.3, 1.32)
        bride.keyframe_insert("location", frame=frame)
    set_interp(bride, 'CONSTANT')
    show_between(bride, 1, FINAL_BLACKOUT - 1)
    return bride


def build_final_faces(coll, ctl, cam_pos_end):
    """Her face, right in front of the lens after the last blackout, and then the
    tilted-back face for four frames in the dark."""
    looks = []
    for plate, (a, b), dist in (("face_front", FACE_HOLD, 0.95), ("face_tilt", SUBLIMINAL, 0.8)):
        mat = plate_material(f"Close: {plate}", plate, ctl, mode='luma', strength=1.0)
        # these ignore the flame (they ARE the light after the last blackout)
        nodes = mat.node_tree.nodes
        em = next(n for n in nodes if n.type == 'EMISSION')
        em.inputs["Strength"].driver_remove("default_value")
        em.inputs["Strength"].default_value = 2.0 ** -EXPOSURE
        h = 0.62
        card = image_plane(f"Close: {plate}", coll, mat, h, plate_aspect(plate),
                           Matrix.Translation(cam_pos_end + Vector((0.0, dist, 0.0))))
        show_between(card, a, b)
        looks.append(card)
    return looks


# --------------------------------------------------------------------------------------
# Camera: a slow walk down the enfilade, glancing at what it passes
# --------------------------------------------------------------------------------------
WALK_START, WALK_END, WALK_FRAMES = 2.0, 22.0, 700
GLANCES = [  # (frame, yaw degrees +right, width in frames)
    (205, 48, 46), (330, -55, 40), (455, -48, 40), (590, -62, 44), (665, 62, 44)]


def cam_y(f):
    u = min(1.0, max(0.0, (f - 1) / WALK_FRAMES))
    return WALK_START + (WALK_END - WALK_START) * (u * u * (3 - 2 * u))


def cam_yaw(f):
    yaw = 0.0
    for c, amp, w in GLANCES:
        yaw += amp * math.exp(-((f - c) / (w / 2.0)) ** 2)
    return math.radians(yaw)


def build_camera(scene, coll):
    data = bpy.data.cameras.new("Walker")
    data.lens = 26
    data.sensor_width = 36
    data.clip_start = 0.05
    data.clip_end = 400
    data.dof.use_dof = True
    data.dof.aperture_fstop = 2.8
    data.dof.focus_distance = 5.0
    cam = bpy.data.objects.new("Walker", data)
    coll.objects.link(cam)
    scene.camera = cam
    cam.rotation_mode = 'XYZ'
    for f in range(1, FRAME_END + 1, 4):
        y = cam_y(f)
        moving = 1.0 - smoothstep(0.85, 1.0, (f - 1) / WALK_FRAMES)
        bob = 0.025 * math.sin(f / FPS * 2 * math.pi * 1.7) * moving
        cam.location = (0.12 * math.sin(f / 90.0), y, 1.58 + bob)
        cam.keyframe_insert("location", frame=f)
        cam.rotation_euler = (math.radians(89.0), 0.0, -cam_yaw(f))
        cam.keyframe_insert("rotation_euler", frame=f)
        # focus: on whatever is ahead in the doorways, or the window being looked at
        data.dof.focus_distance = 6.0 if abs(cam_yaw(f)) < 0.3 else 3.0
        data.dof.keyframe_insert("focus_distance", frame=f)
    for fc in fcurves_of(cam):
        if fc.data_path == "rotation_euler":
            n = fc.modifiers.new('NOISE')
            n.scale = 30.0
            n.strength = 0.012
            n.phase = 7.0 * fc.array_index
    return cam


# --------------------------------------------------------------------------------------
# World, render, compositor
# --------------------------------------------------------------------------------------
def build_world(scene):
    world = bpy.data.worlds.get("Nowhere") or bpy.data.worlds.new("Nowhere")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes.get("Background")
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
    out = nt.nodes.get("World Output")
    vol = nt.nodes.new("ShaderNodeVolumeScatter")
    vol.inputs["Density"].default_value = HAZE
    vol.inputs["Anisotropy"].default_value = 0.4
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])


def setup_render(scene, samples, percent):
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.volume_bounces = 0
    if hasattr(scene.cycles, "volume_step_rate"):
        scene.cycles.volume_step_rate = 4.0
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 858
    scene.render.resolution_percentage = percent
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = FRAME_END
    # 'Standard' so the photographs reproduce as they are
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.view_settings.exposure = EXPOSURE
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = "//render/the_survey_world_"


def setup_compositor(scene):
    if not IS_5X:
        log("Compositor grade needs Blender 5.0+; skipping it.")
        return
    tree = bpy.data.node_groups.new("Survey Grade", 'CompositorNodeTree')
    tree.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    scene.compositing_node_group = tree
    N, L = tree.nodes, tree.links

    def node(kind, **props):
        n = N.new(kind)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def m(op, a, b=None, c=None):
        n = node("ShaderNodeMath", operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    rl = node("CompositorNodeRLayers")
    bw = node("CompositorNodeRGBToBW")
    L.new(rl.outputs["Image"], bw.inputs["Image"])
    glare = node("CompositorNodeGlare")
    glare.inputs["Type"].default_value = 'Fog Glow'
    glare.inputs["Threshold"].default_value = 0.8
    glare.inputs["Strength"].default_value = GLOW
    glare.inputs["Size"].default_value = 0.6
    L.new(bw.outputs["Val"], glare.inputs["Image"])
    lum = m('POWER', m('MAXIMUM', glare.outputs["Image"], 0.0), 1 / 2.2)

    mask = node("CompositorNodeEllipseMask")
    mask.inputs["Size"].default_value = (0.95, 0.9)
    blur = node("CompositorNodeBlur")
    blur.inputs["Size"].default_value = (360, 360)
    L.new(mask.outputs["Mask"], blur.inputs["Image"])
    lum = m('MULTIPLY', lum, m('ADD', m('MULTIPLY', blur.outputs["Image"], VIGNETTE), 1 - VIGNETTE))

    coords = node("CompositorNodeImageCoordinates")
    L.new(rl.outputs["Image"], coords.inputs["Image"])
    t = node("CompositorNodeSceneTime")
    wn = node("ShaderNodeTexWhiteNoise", noise_dimensions='4D')
    L.new(coords.outputs["Pixel"], wn.inputs["Vector"])
    L.new(t.outputs["Frame"], wn.inputs["W"])
    clump = node("CompositorNodeBlur")
    clump.inputs["Size"].default_value = (1, 1)
    L.new(wn.outputs["Value"], clump.inputs["Image"])
    mid = m('MULTIPLY', m('MULTIPLY', lum, m('SUBTRACT', 1.0, lum)), 4.0)
    amount = m('MULTIPLY', m('ADD', mid, 0.3), GRAIN * 2)
    lum = m('MULTIPLY_ADD', m('SUBTRACT', clump.outputs["Image"], 0.5), amount, lum)
    lin = m('POWER', m('MAXIMUM', lum, 0.0), 2.2)
    out = node("NodeGroupOutput")
    L.new(lin, out.inputs[0])
    viewer = node("CompositorNodeViewer")
    L.new(lin, viewer.inputs[0])


# --------------------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------------------
def build(samples=128, percent=100, grade=True):
    scene = reset_scene()
    mats = {
        "stone": stone_material("Rough Stone", 2.2, 0.22),
        "floor": stone_material("Flagstones", 0.8, 0.11, mortar_depth=0.5),
        "ceiling": stone_material("Ceiling Slabs", 0.6, 0.07),
        "water": simple("Standing Water", (0.004, 0.004, 0.004), rough=0.03,
                        **{"IOR": 1.33}),
        "wood": simple("Lath", (0.30, 0.24, 0.17), rough=0.85),
        "flag": simple("Flagging Tape", (0.9, 0.9, 0.88), rough=0.45),
        "iron": simple("Lantern Iron", (0.05, 0.05, 0.05), rough=0.5, metal=1.0),
    }
    c_world = collection("Rooms")
    c_survey = collection("Survey")
    c_plates = collection("Plates")
    c_cam = collection("Camera")

    ctl = build_flame(c_survey)
    lg = bpy.data.materials.new("Lantern Glass")
    lg.use_nodes = True
    nt = lg.node_tree
    nt.nodes.clear()
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.9, 0.75, 1)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    drive_by_flame(em.inputs["Strength"], "default_value", 6.0, ctl)
    mats["lantern"] = lg

    openings = plan_world()
    build_plates(c_plates, ctl, openings)          # also cuts its windows into the plan
    build_rooms(c_world, mats, openings)
    build_water(c_world, mats, [(ROUTE_X, 3), (ROUTE_X, 4), (ROUTE_X, 5), (ROUTE_X - 1, 3),
                                (ROUTE_X + 1, 4)])
    build_survey(c_survey, mats, ctl, openings)
    cam = build_camera(scene, c_cam)
    scene.frame_set(FRAME_END)
    build_final_faces(c_plates, ctl, cam.matrix_world.translation.copy())
    build_world(scene)
    setup_render(scene, samples, percent)
    if grade:
        setup_compositor(scene)
    for n, (f, _) in enumerate(BRIDE_STEPS[1:], 1):
        scene.timeline_markers.new(f"Dark {n}", frame=f)
    scene.timeline_markers.new("Last dark", frame=FINAL_BLACKOUT)
    scene.frame_set(1)
    log("World built.")
    return scene


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"still": None, "animation": False, "samples": 128, "percent": 100,
            "out": None, "save": True, "grade": True}
    it = iter(argv)
    for a in it:
        if a == "--still":
            opts["still"] = int(next(it))
        elif a == "--animation":
            opts["animation"] = True
        elif a == "--samples":
            opts["samples"] = int(next(it))
        elif a == "--percent":
            opts["percent"] = int(next(it))
        elif a == "--out":
            opts["out"] = next(it)
        elif a == "--no-grade":
            opts["grade"] = False
        elif a == "--no-save":
            opts["save"] = False
    return opts


def main():
    opts = parse_args()
    scene = build(opts["samples"], opts["percent"], opts["grade"])
    if bpy.app.background and opts["save"]:
        path = os.path.join(HERE, "the_survey_world.blend")
        bpy.ops.wm.save_as_mainfile(filepath=path)
        log(f"Saved {path}")
    if opts["still"] is not None:
        scene.frame_set(opts["still"])
        out = opts["out"] or f"//previews/world_{opts['still']:04d}.png"
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        log(f"Rendered frame {opts['still']} -> {bpy.path.abspath(out)}")
    elif opts["animation"]:
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
