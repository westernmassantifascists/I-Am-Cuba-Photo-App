"""
THE SURVEY - "Station Zero"
A self-contained horror shot for Blender 5.x (scene building also works in 4.2+).

A surveyor's theodolite stands abandoned in a fogged field at night, sighting down
a line of white-flagged stakes that runs over a low rise. Something tall stands on
the line at the crest. Each time the hanging lantern gutters out, it is one stake
closer. The last time the light comes back, it is at the first stake.

Run it:
  * In Blender: Scripting workspace -> Open this file -> Run Script.
  * From a terminal (builds and saves the_survey_station_zero.blend next to this file):
        blender --background --python the_survey_station_zero.py
  * Build and render one test frame:
        blender --background --python the_survey_station_zero.py -- \
            --still 200 --samples 64 --percent 50 --out //preview_0200.png
  * Build and render the whole shot (frames 1-360) to ./render/:
        blender --background --python the_survey_station_zero.py -- --animation

Everything you would want to tweak is in the TUNING block below.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

# --------------------------------------------------------------------------------------
# TUNING
# --------------------------------------------------------------------------------------
FPS = 24
FRAME_END = 360                     # 15 seconds

STAKE_SPACING = 10.0                # metres between stations
STAKE_COUNT = 22                    # stations 1+00 ... 22+00 along +Y
CREST_Y = 110.0                     # where the line goes over the rise
CREST_HEIGHT = 3.2

# The figure's station (Y position) after each lantern blackout.
# frame -> y. The figure only ever moves while the light is out.
FIGURE_STEPS = [(1, 112.0), (96, 81.0), (168, 56.0), (232, 34.0), (292, 19.0), (330, 10.6)]
BLACKOUT_FRAMES = 4                 # how long each blackout lasts
FIGURE_HEIGHT = 2.75

FOG_DENSITY = 0.0065                # mean visibility ~ 1/density metres, above the ground fog
GROUND_FOG = 1.6                    # extra density in the first metre or two
MOON_STRENGTH = 0.35
LANTERN_WATTS = 70.0

GRASS_PARENTS = 45000               # raise for the final render, lower for speed
GRASS_CHILDREN = 6

# Film look, after the Soy Cuba app's gothic looks: blue-leaning grey conversion,
# crushed blacks, glow, vignette and midtone grain.
BW_WEIGHTS = (0.22, 0.43, 0.35)     # R, G, B
GRAIN = 0.04
VIGNETTE = 0.55
GLOW = 0.35

SEED = 1964

# --------------------------------------------------------------------------------------
rng = random.Random(SEED)
IS_5X = bpy.app.version >= (5, 0, 0)


def log(msg):
    print(f"[The Survey] {msg}")


# --------------------------------------------------------------------------------------
# Scene reset
# --------------------------------------------------------------------------------------
def reset_scene():
    scene = bpy.context.scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras,
                 bpy.data.curves, bpy.data.particles, bpy.data.textures):
        for block in list(coll):
            coll.remove(block)
    for coll in list(scene.collection.children):
        bpy.data.collections.remove(coll)
    scene.name = "The Survey"
    return scene


def collection(name):
    coll = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(coll)
    return coll


# --------------------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------------------
def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def ground_height(x, y):
    """Deterministic terrain height, so props can be placed on the ground exactly."""
    rolling = 0.9 * noise.noise(Vector((x / 45.0, y / 45.0, 0.3)))
    lumps = 0.18 * noise.noise(Vector((x / 7.0, y / 7.0, 4.1)))
    rise = CREST_HEIGHT * math.exp(-((y - CREST_Y) / 32.0) ** 2)
    rise *= 1.0 - 0.5 * smoothstep(20, 90, abs(x))
    near = smoothstep(4.0, 25.0, math.hypot(x, y))     # keep the set-up area level
    return (rolling + lumps) * near + rise


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


def add_cylinder(bm, radius, depth, matrix, segments=16, radius2=None):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius,
                          radius2=radius if radius2 is None else radius2,
                          depth=depth, matrix=matrix)


def add_box(bm, size, matrix):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.transform(bm, matrix=matrix @ Matrix.Diagonal(Vector((*size, 1.0))),
                        verts=geom["verts"])


def add_sphere(bm, radius, matrix, scale=(1, 1, 1), segs=24):
    geom = bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=segs // 2,
                                     radius=radius)
    m = matrix @ Matrix.Diagonal(Vector((*scale, 1.0)))
    bmesh.ops.transform(bm, matrix=m, verts=geom["verts"])


def limb(bm, start, end, r1, r2, segs=12):
    """A tapered cylinder from start to end."""
    start, end = Vector(start), Vector(end)
    d = end - start
    rot = d.to_track_quat('Z', 'Y').to_matrix().to_4x4()
    m = Matrix.Translation((start + end) / 2) @ rot
    add_cylinder(bm, r1, d.length, m, segments=segs, radius2=r2)


def principled(name, color, rough=0.6, metal=0.0, **extra):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    for key, value in extra.items():
        bsdf.inputs[key].default_value = value
    return mat


def key(datablock, path, frame, value, interp=None):
    if isinstance(path, tuple):
        path, index = path
    else:
        index = -1
    target = datablock
    attr = path
    if path.startswith('["'):
        datablock[path[2:-2]] = value
    elif index >= 0:
        getattr(target, attr)[index] = value
    else:
        setattr(target, attr, value)
    datablock.keyframe_insert(data_path=path, index=index, frame=frame)
    if interp:
        for fc in fcurves_of(datablock):
            if fc.data_path == path:
                for kp in fc.keyframe_points:
                    if int(kp.co.x) == frame:
                        kp.interpolation = interp


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


# --------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------
def build_materials():
    mats = {}

    # Ground: dark peat with a noise bump.
    m = principled("Ground", (0.08, 0.075, 0.065), rough=0.95)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 3.0
    tex.inputs["Detail"].default_value = 8.0
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.6
    nt.links.new(tex.outputs["Factor"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    mats["ground"] = m

    # Grass: dry, pale-ish so it reads against the dark ground in fog.
    mats["grass"] = principled("Dry Grass", (0.32, 0.29, 0.19), rough=0.6,
                               **{"Subsurface Weight": 0.2})
    mats["wood"] = principled("Lath", (0.30, 0.22, 0.14), rough=0.85)
    mats["tripod"] = principled("Tripod Wood", (0.16, 0.10, 0.06), rough=0.55)
    mats["flag"] = principled("Flagging Tape", (0.85, 0.85, 0.82), rough=0.45)
    mats["instrument"] = principled("Instrument Paint", (0.55, 0.57, 0.52), rough=0.35)
    mats["metal"] = principled("Brass", (0.75, 0.6, 0.35), rough=0.3, metal=1.0)
    mats["glass"] = principled("Lens", (0.02, 0.02, 0.03), rough=0.05,
                               **{"Coat Weight": 1.0})
    mats["tape"] = principled("Chain Tape", (0.6, 0.55, 0.3), rough=0.4, metal=0.6)

    # The figure: bloodless, faintly translucent skin.
    mats["figure"] = principled("Figure Skin", (0.62, 0.60, 0.57), rough=0.75,
                                **{"Subsurface Weight": 0.15,
                                   "Subsurface Radius": (0.4, 0.2, 0.2)})

    # Lantern glass: emission strength is driven by the lantern's "flame" property.
    m = bpy.data.materials.new("Lantern Glow")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.86, 0.66, 1.0)
    em.inputs["Strength"].default_value = 4.0
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    mats["lantern"] = m
    return mats


# --------------------------------------------------------------------------------------
# Terrain and grass
# --------------------------------------------------------------------------------------
def build_terrain(coll, mats):
    size, res = 320.0, 260
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res, y_segments=res, size=size / 2)
    # Shift the grid so it covers behind the camera less and the line ahead more.
    for v in bm.verts:
        v.co.y += 90.0
        v.co.z = ground_height(v.co.x, v.co.y)
    ground = mesh_object("Ground", bm, coll, mats["ground"], smooth=True)

    # Grass density: thick near the camera, none in the cut line, none far away
    # (the fog hides it there anyway).
    vg = ground.vertex_groups.new(name="grass")
    for v in ground.data.vertices:
        x, y = v.co.x, v.co.y
        cut = smoothstep(0.5, 1.6, abs(x))
        near = 1.0 - smoothstep(35.0, 75.0, math.hypot(x * 1.6, y))
        w = cut * near
        if w > 0.001:
            vg.add([v.index], w, 'REPLACE')

    # One grass blade, instanced by the particle system.
    bm = bmesh.new()
    h, w = 0.32, 0.012
    verts = [bm.verts.new(c) for c in ((-w, 0, 0), (w, 0, 0), (w * 0.4, 0.01, h * 0.6),
                                       (-w * 0.4, 0.01, h * 0.6), (0, 0.03, h))]
    bm.faces.new(verts[:4])
    bm.faces.new((verts[3], verts[2], verts[4]))
    blade = mesh_object("Grass Blade", bm, coll, mats["grass"])
    blade.hide_render = True
    blade.hide_viewport = True

    mod = ground.modifiers.new("Grass", 'PARTICLE_SYSTEM')
    psys = mod.particle_system
    psys.vertex_group_density = "grass"
    ps = psys.settings
    ps.name = "Grass"
    ps.type = 'HAIR'
    ps.use_advanced_hair = True
    ps.count = GRASS_PARENTS
    ps.hair_length = 1.0
    ps.render_type = 'OBJECT'
    ps.instance_object = blade
    ps.particle_size = 1.0
    ps.size_random = 0.6
    ps.use_rotations = True
    ps.rotation_mode = 'NOR'
    ps.phase_factor_random = 2.0
    ps.rotation_factor_random = 0.25
    ps.child_type = 'INTERPOLATED'
    ps.child_percent = 1
    ps.rendered_child_count = GRASS_CHILDREN
    ps.child_radius = 0.25
    ps.display_percentage = 10
    psys.seed = SEED
    return ground


# --------------------------------------------------------------------------------------
# The survey line
# --------------------------------------------------------------------------------------
def build_stake(bm_stake, bm_flag, x, y, station):
    z = ground_height(x, y)
    tilt = Euler((math.radians(rng.uniform(-5, 5)), math.radians(rng.uniform(-5, 5)),
                  math.radians(rng.uniform(0, 180))))
    base = Matrix.Translation((x, y, z - 0.25)) @ tilt.to_matrix().to_4x4()
    height = 1.25
    add_box(bm_stake, (0.045, 0.018, height), base @ Matrix.Translation((0, 0, height / 2)))
    # Flagging tape tied near the top, hanging and slightly lifted by the air.
    top = base @ Matrix.Translation((0, 0, height - 0.08))
    length = rng.uniform(0.35, 0.6)
    lift = math.radians(rng.uniform(15, 40))
    for k in range(2):                       # two tails
        yaw = math.radians(rng.uniform(-30, 30) + 180 * k)
        m = (top @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(math.pi - lift, 4, 'X')
             @ Matrix.Translation((0, 0, length / 2)))
        add_box(bm_flag, (0.03, 0.002, length), m)
    add_box(bm_flag, (0.06, 0.03, 0.03), top)   # the knot


def build_line(coll, mats):
    bm_stake, bm_flag = bmesh.new(), bmesh.new()
    for i in range(1, STAKE_COUNT + 1):
        y = i * STAKE_SPACING
        x = rng.uniform(-0.08, 0.08)
        build_stake(bm_stake, bm_flag, x, y, i)
    mesh_object("Stakes", bm_stake, coll, mats["wood"])
    mesh_object("Flagging", bm_flag, coll, mats["flag"])

    # A steel chain tape lying in the grass from the tripod to the first stake.
    cu = bpy.data.curves.new("Chain Tape", 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = 0.0
    cu.extrude = 0.006
    spline = cu.splines.new('POLY')
    pts = []
    for k in range(41):
        t = k / 40.0
        y = -0.1 + t * (STAKE_SPACING - 0.2)
        x = -0.55 + 0.6 * t + 0.25 * math.sin(t * 7.0) * (1 - t)
        pts.append((x, y, ground_height(x, y) + 0.01))
    spline.points.add(len(pts) - 1)
    for p, co in zip(spline.points, pts):
        p.co = (*co, 1.0)
    tape = bpy.data.objects.new("Chain Tape", cu)
    cu.materials.append(mats["tape"])
    coll.objects.link(tape)


# --------------------------------------------------------------------------------------
# Theodolite on its tripod, with a hanging lantern
# --------------------------------------------------------------------------------------
INSTRUMENT_POS = Vector((-0.75, 0.0, 0.0))
HEAD_HEIGHT = 1.42


def build_instrument(coll, mats):
    origin = INSTRUMENT_POS.copy()
    origin.z = ground_height(origin.x, origin.y)
    head = origin + Vector((0, 0, HEAD_HEIGHT))

    bm = bmesh.new()
    for k in range(3):
        a = math.radians(90 + 120 * k + 15)
        foot = origin + Vector((math.cos(a) * 0.62, math.sin(a) * 0.62, -0.05))
        foot.z = ground_height(foot.x, foot.y) - 0.04
        limb(bm, foot, head - Vector((0, 0, 0.03)), 0.022, 0.03, segs=8)
    add_cylinder(bm, 0.1, 0.045, Matrix.Translation(head))
    tripod = mesh_object("Tripod", bm, coll, mats["tripod"], smooth=True)

    # Instrument: levelling base, standards, telescope aimed down the line.
    bm = bmesh.new()
    add_cylinder(bm, 0.075, 0.05, Matrix.Translation(head + Vector((0, 0, 0.05))), 24)
    add_cylinder(bm, 0.06, 0.07, Matrix.Translation(head + Vector((0, 0, 0.11))), 24)
    for side in (-1, 1):
        add_box(bm, (0.025, 0.07, 0.17),
                Matrix.Translation(head + Vector((side * 0.06, 0, 0.23))))
    add_cylinder(bm, 0.035, 0.04, Matrix.Translation(head + Vector((0, 0, 0.32)))
                 @ Matrix.Rotation(math.pi / 2, 4, 'Y'), 20)
    body = mesh_object("Theodolite", bm, coll, mats["instrument"], smooth=True)

    # Telescope, pointing down the line (+Y), with a dark objective lens.
    aim = Matrix.Translation(head + Vector((0, 0.02, 0.31))) @ Matrix.Rotation(-math.pi / 2, 4, 'X')
    bm = bmesh.new()
    add_cylinder(bm, 0.032, 0.30, aim, 24, radius2=0.04)
    add_cylinder(bm, 0.018, 0.06, aim @ Matrix.Translation((0, 0, -0.17)), 16)  # eyepiece
    scope = mesh_object("Telescope", bm, coll, mats["instrument"], smooth=True)
    bm = bmesh.new()
    add_cylinder(bm, 0.036, 0.004, aim @ Matrix.Translation((0, 0, 0.152)), 24)
    mesh_object("Objective", bm, coll, mats["glass"], smooth=True)
    bm = bmesh.new()
    add_cylinder(bm, 0.008, 0.07, Matrix.Translation(head + Vector((0, -0.05, 0.135)))
                 @ Matrix.Rotation(math.pi / 2, 4, 'Y'), 8)
    mesh_object("Level Vial", bm, coll, mats["metal"])

    # Lantern hanging on a short wire from the tripod head, on the camera side.
    hook = head + Vector((0.16, -0.1, -0.05))
    lamp_pos = hook - Vector((0, 0, 0.32))
    bm = bmesh.new()
    limb(bm, head + Vector((0.05, -0.03, 0)), hook, 0.004, 0.004, segs=6)
    limb(bm, hook, lamp_pos + Vector((0, 0, 0.11)), 0.002, 0.002, segs=6)
    add_cylinder(bm, 0.055, 0.02, Matrix.Translation(lamp_pos + Vector((0, 0, 0.09))), 16,
                 radius2=0.02)
    add_cylinder(bm, 0.06, 0.03, Matrix.Translation(lamp_pos - Vector((0, 0, 0.085))), 16)
    for k in range(4):
        a = math.radians(45 + 90 * k)
        off = Vector((math.cos(a) * 0.058, math.sin(a) * 0.058, 0))
        limb(bm, lamp_pos + off - Vector((0, 0, 0.07)), lamp_pos + off + Vector((0, 0, 0.08)),
             0.004, 0.004, segs=6)
    mesh_object("Lantern Frame", bm, coll, mats["metal"], smooth=True)
    bm = bmesh.new()
    add_cylinder(bm, 0.048, 0.14, Matrix.Translation(lamp_pos), 20)
    glass = mesh_object("Lantern Glass", bm, coll, mats["lantern"], smooth=True)

    light = bpy.data.lights.new("Lantern Flame", 'POINT')
    light.energy = LANTERN_WATTS
    light.shadow_soft_size = 0.02
    light.color = (1.0, 0.86, 0.68)
    lamp = bpy.data.objects.new("Lantern Flame", light)
    lamp.location = lamp_pos
    coll.objects.link(lamp)
    return lamp, glass, head


def animate_lantern(lamp, glass):
    """A 'flame' property (1 = normal) keyed every few frames, driving light and glass."""
    lamp["flame"] = 1.0
    blackouts = [f for f, _ in FIGURE_STEPS[1:]]
    frame = 1
    while frame <= FRAME_END + 2:
        v = 1.0 + rng.uniform(-0.12, 0.08)
        # gutter: dims in the frames before a blackout
        for b in blackouts:
            if b - 10 <= frame < b:
                v *= rng.uniform(0.35, 0.8)
        key(lamp, '["flame"]', frame, v)
        frame += rng.choice((2, 3, 3, 4))
    for b in blackouts:
        key(lamp, '["flame"]', b - 1, 0.25)
        key(lamp, '["flame"]', b, 0.0, 'CONSTANT')
        key(lamp, '["flame"]', b + BLACKOUT_FRAMES - 1, 0.0, 'CONSTANT')
        key(lamp, '["flame"]', b + BLACKOUT_FRAMES, 1.35)       # flares as it catches
        key(lamp, '["flame"]', b + BLACKOUT_FRAMES + 3, 1.0)
    # clear any random keys that fell inside a blackout
    for fc in fcurves_of(lamp):
        for kp in list(fc.keyframe_points):
            f = kp.co.x
            for b in blackouts:
                if b < f < b + BLACKOUT_FRAMES - 1:
                    fc.keyframe_points.remove(kp)
                    break

    def drive(id_block, path, scale, index=-1):
        fc = id_block.driver_add(path, index) if index >= 0 else id_block.driver_add(path)
        drv = fc.driver
        drv.type = 'SUM'
        var = drv.variables.new()
        var.name = "flame"
        var.type = 'SINGLE_PROP'
        var.targets[0].id_type = 'OBJECT'
        var.targets[0].id = lamp
        var.targets[0].data_path = '["flame"]'
        gen = fc.modifiers[0] if len(fc.modifiers) else fc.modifiers.new('GENERATOR')
        gen.coefficients = (0.0, scale)

    drive(lamp.data, "energy", LANTERN_WATTS)
    em = glass.data.materials[0].node_tree.nodes["Emission"]
    drive(em.inputs["Strength"], "default_value", 4.0)


# --------------------------------------------------------------------------------------
# The figure
# --------------------------------------------------------------------------------------
def build_figure(coll, mats):
    H = FIGURE_HEIGHT
    s = H / 2.75
    bm = bmesh.new()
    I = Matrix.Identity(4)

    def at(x, y, z):
        return Matrix.Translation((x * s, y * s, z * s))

    hip_z, shoulder_z = 1.38, 2.22
    # legs, too long and very thin
    for side in (-1, 1):
        limb(bm, (side * 0.09 * s, 0.0, 0.02), (side * 0.08 * s, 0.01 * s, (hip_z + 0.05) * s),
             0.04 * s, 0.075 * s)
        add_sphere(bm, 0.05 * s, at(side * 0.09, 0.04, 0.03), (0.9, 1.8, 0.5), 12)   # feet
    add_sphere(bm, 0.16, at(0, 0, hip_z + 0.05), (1.1, 0.8, 0.9), 16)           # pelvis
    add_sphere(bm, 0.2, at(0, 0, 1.85), (0.9, 0.55, 2.0), 20)                    # torso
    add_sphere(bm, 0.17, at(0, 0.0, shoulder_z - 0.04), (1.35, 0.6, 0.55), 16)   # shoulders
    # arms hang past the knees, slightly forward, hands long
    for side in (-1, 1):
        sh = Vector((side * 0.20 * s, 0.0, (shoulder_z - 0.03) * s))
        el = Vector((side * 0.27 * s, 0.05 * s, 1.55 * s))
        wr = Vector((side * 0.25 * s, 0.10 * s, 0.92 * s))
        limb(bm, sh, el, 0.055 * s, 0.04 * s)
        limb(bm, el, wr, 0.042 * s, 0.03 * s)
        limb(bm, wr, wr + Vector((0, 0.03 * s, -0.24 * s)), 0.03 * s, 0.01 * s, segs=8)
    # neck and a head that is a little too small, tilted toward its shoulder
    limb(bm, (0, 0, shoulder_z * s), (0.03 * s, 0.02 * s, 2.5 * s), 0.05 * s, 0.04 * s)
    head_m = at(0.05, 0.03, 2.6) @ Matrix.Rotation(math.radians(-22), 4, 'Y')
    add_sphere(bm, 0.105 * s, head_m, (0.85, 0.95, 1.25), 20)
    fig = mesh_object("It", bm, coll, mats["figure"], smooth=True)
    sub = fig.modifiers.new("Soften", 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 2

    # Flagging tape tied around its left wrist, like a stake.
    bm = bmesh.new()
    wrist = Vector((-0.25 * s, 0.10 * s, 0.95 * s))
    bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=0.04 * s, radius2=0.04 * s,
                          depth=0.03, matrix=Matrix.Translation(wrist))
    for k, yaw in enumerate((200, 250)):
        m = (Matrix.Translation(wrist + Vector((-0.03, 0, 0))) @ Matrix.Rotation(math.radians(yaw), 4, 'Z')
             @ Matrix.Rotation(math.radians(170 - 12 * k), 4, 'X')
             @ Matrix.Translation((0, 0, 0.22)))
        add_box(bm, (0.028, 0.002, 0.44), m)
    tape = mesh_object("Wrist Flag", bm, coll, mats["flag"])
    tape.parent = fig
    return fig


def animate_figure(fig):
    """The figure stands on the line, facing the instrument; it moves only in the dark."""
    for frame, y in FIGURE_STEPS:
        x = 0.35 + rng.uniform(-0.1, 0.1)
        z = ground_height(x, y)
        key(fig, "location", frame, (x, y, z), 'CONSTANT')
        # turned a little more toward the camera each time
        yaw = math.radians(180 + rng.uniform(-8, 8))
        key(fig, "rotation_euler", frame, (0.0, 0.0, yaw), 'CONSTANT')
    for fc in fcurves_of(fig):
        for kp in fc.keyframe_points:
            kp.interpolation = 'CONSTANT'


# --------------------------------------------------------------------------------------
# Fog, moon, world
# --------------------------------------------------------------------------------------
def build_atmosphere(scene, coll):
    world = bpy.data.worlds.get("Night") or bpy.data.worlds.new("Night")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.012, 0.014, 0.02, 1.0)
    bg.inputs["Strength"].default_value = 1.0

    sun = bpy.data.lights.new("Moon", 'SUN')
    sun.energy = MOON_STRENGTH
    sun.angle = math.radians(0.6)
    sun.color = (0.8, 0.87, 1.0)
    moon = bpy.data.objects.new("Moon", sun)
    # behind the far end of the line, low: back-lights the fog over the crest
    moon.rotation_euler = Euler((math.radians(72), 0.0, math.radians(172)))
    coll.objects.link(moon)

    # A big fog box. Density thickens near the ground and is broken up by noise.
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    fog = mesh_object("Fog", bm, coll)
    fog.scale = (320, 330, 40)
    fog.location = (0, 90, 15)
    fog.display_type = 'BOUNDS'
    mat = bpy.data.materials.new("Fog")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.82, 0.85, 0.9, 1.0)
    vol.inputs["Anisotropy"].default_value = 0.45
    coord = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Position"], sep.inputs["Vector"])

    def math_node(op, a=None, b=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            elif v is not None:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    z = sep.outputs["Z"]
    falloff = math_node('EXPONENT', math_node('MULTIPLY', math_node('MAXIMUM', z, 0.0), -0.45))
    height = math_node('ADD', math_node('MULTIPLY', falloff, GROUND_FOG), 1.0)
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 0.035
    tex.inputs["Detail"].default_value = 3.0
    nt.links.new(coord.outputs["Position"], tex.inputs["Vector"])
    patchy = math_node('MULTIPLY_ADD', tex.outputs["Factor"], 1.3)
    patchy.node.inputs[2].default_value = 0.35
    dens = math_node('MULTIPLY', math_node('MULTIPLY', height, patchy), FOG_DENSITY)
    nt.links.new(dens, vol.inputs["Density"])
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    fog.data.materials.append(mat)
    fog.visible_shadow = True
    return fog


# --------------------------------------------------------------------------------------
# Camera
# --------------------------------------------------------------------------------------
def build_camera(scene, coll, fig, head):
    cam_data = bpy.data.cameras.new("Station Camera")
    cam_data.lens = 40
    cam_data.sensor_width = 36
    cam_data.clip_start = 0.05
    cam_data.clip_end = 600
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 2.0
    cam = bpy.data.objects.new("Station Camera", cam_data)
    coll.objects.link(cam)
    scene.camera = cam

    look = bpy.data.objects.new("Look At", None)
    look.empty_display_size = 0.5
    coll.objects.link(look)
    look.location = (-0.05, 40.0, 1.2)
    focus = bpy.data.objects.new("Focus", None)
    focus.empty_display_size = 0.3
    coll.objects.link(focus)
    cam_data.dof.focus_object = focus

    track = cam.constraints.new('TRACK_TO')
    track.target = look
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'

    # Slow push-in over the instrument's right shoulder.
    key(cam, "location", 1, (0.35, -3.6, 1.42))
    key(cam, "location", FRAME_END, (0.02, -1.9, 1.52))
    # Handheld drift: noise on the look-at point (small at 40 m = a fraction of a degree).
    key(look, "location", 1, look.location[:])
    for fc in fcurves_of(look):
        n = fc.modifiers.new('NOISE')
        n.scale = 40.0
        n.strength = 0.25 if fc.array_index != 1 else 0.0
        n.phase = 10.0 * fc.array_index

    # Focus sits on the instrument, then racks to the figure for the last beat.
    last_y = FIGURE_STEPS[-1][1]
    key(focus, "location", 1, head + Vector((0, 0.05, 0.3)))
    key(focus, "location", FIGURE_STEPS[-1][0] + BLACKOUT_FRAMES + 6,
        head + Vector((0, 0.05, 0.3)))
    key(focus, "location", FIGURE_STEPS[-1][0] + BLACKOUT_FRAMES + 22,
        (0.35, last_y, ground_height(0.35, last_y) + FIGURE_HEIGHT * 0.9))
    return cam


# --------------------------------------------------------------------------------------
# Render settings and the film-look compositor
# --------------------------------------------------------------------------------------
def setup_render(scene, samples=256, percent=100):
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.volume_bounces = 1
    if hasattr(scene.cycles, "volume_step_rate"):
        scene.cycles.volume_step_rate = 4.0
        scene.cycles.volume_preview_step_rate = 8.0
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    scene.render.resolution_x = 2048
    scene.render.resolution_y = 858      # 2.39:1
    scene.render.resolution_percentage = percent
    scene.render.fps = FPS
    scene.frame_start = 1
    scene.frame_end = FRAME_END
    scene.frame_current = 1
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'None'
    except TypeError:
        scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.exposure = 1.8
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = "//render/the_survey_"


def setup_compositor(scene):
    if not IS_5X:
        log("Compositor grade needs Blender 5.0+; rendering in colour without it.")
        return
    tree = bpy.data.node_groups.new("Survey Grade", 'CompositorNodeTree')
    tree.interface.new_socket("Image", in_out='OUTPUT', socket_type='NodeSocketColor')
    scene.compositing_node_group = tree
    N, L = tree.nodes, tree.links

    def node(kind, x, y, **props):
        n = N.new(kind)
        n.location = (x, y)
        for k, v in props.items():
            setattr(n, k, v)
        return n

    def math(op, a, b=None, x=0, y=0, c=None):
        n = node("ShaderNodeMath", x, y, operation=op)
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                L.new(v, n.inputs[i])
        return n.outputs[0]

    rl = node("CompositorNodeRLayers", -1200, 0)
    sep = node("CompositorNodeSeparateColor", -1000, 0)
    L.new(rl.outputs["Image"], sep.inputs["Image"])

    # 1. Spectral response -> grey
    r = math('MULTIPLY', sep.outputs["Red"], BW_WEIGHTS[0], -800, 150)
    g = math('MULTIPLY', sep.outputs["Green"], BW_WEIGHTS[1], -800, 0)
    b = math('MULTIPLY', sep.outputs["Blue"], BW_WEIGHTS[2], -800, -150)
    grey = math('ADD', math('ADD', r, g, -650, 80), b, -500, 0)

    # 2. Glow around the lantern and in the fog
    glare = node("CompositorNodeGlare", -320, 0)
    glare.inputs["Type"].default_value = 'Fog Glow'
    glare.inputs["Threshold"].default_value = 0.5
    glare.inputs["Strength"].default_value = GLOW
    glare.inputs["Size"].default_value = 0.6
    L.new(grey, glare.inputs["Image"])

    # 3. Tone curve: crush the blacks, cap the highlights. Grading happens on a
    #    gamma-encoded copy (so curve points and grain behave perceptually) and is
    #    linearised again before the view transform.
    encoded = math('POWER', math('MAXIMUM', glare.outputs["Image"], 0.0, -220, -120),
                   1 / 2.2, -160, -120)
    curve = node("CompositorNodeCurveRGB", -120, 0)
    c = curve.mapping.curves[3]
    c.points[0].location = (0.0, 0.0)
    c.points[1].location = (1.0, 0.93)
    c.points.new(0.06, 0.0)
    c.points.new(0.5, 0.47)
    curve.mapping.update()
    L.new(encoded, curve.inputs["Image"])
    lum = curve.outputs["Image"]

    # 4. Vignette
    mask = node("CompositorNodeEllipseMask", -120, -300)
    mask.inputs["Size"].default_value = (0.95, 0.85)
    blur = node("CompositorNodeBlur", 60, -300)
    blur.inputs["Size"].default_value = (300, 300)
    L.new(mask.outputs["Mask"], blur.inputs["Image"])
    vig = math('ADD', math('MULTIPLY', blur.outputs["Image"], VIGNETTE, 240, -300),
               1.0 - VIGNETTE, 400, -300)
    lum = math('MULTIPLY', lum, vig, 560, 0)

    # 5. Grain, strongest in the midtones, new every frame, slightly clumped
    coords = node("CompositorNodeImageCoordinates", -120, -600)
    L.new(rl.outputs["Image"], coords.inputs["Image"])
    t = node("CompositorNodeSceneTime", -120, -760)
    noise_n = node("ShaderNodeTexWhiteNoise", 80, -650, noise_dimensions='4D')
    L.new(coords.outputs["Pixel"], noise_n.inputs["Vector"])
    L.new(t.outputs["Frame"], noise_n.inputs["W"])
    clump = node("CompositorNodeBlur", 260, -650)
    clump.inputs["Size"].default_value = (1, 1)
    L.new(noise_n.outputs["Value"], clump.inputs["Image"])
    centred = math('SUBTRACT', clump.outputs["Image"], 0.5, 440, -650)
    mid = math('MULTIPLY', math('MULTIPLY', lum, math('SUBTRACT', 1.0, lum, 560, -820), 720, -820),
               4.0, 880, -820)
    amount = math('MULTIPLY', math('ADD', mid, 0.35, 1040, -820), GRAIN * 2.0, 1200, -820)
    lum = math('MULTIPLY_ADD', centred, amount, 1380, 0, c=lum)

    # 6. A touch of lens barrel and output
    lens = node("CompositorNodeLensdist", 1560, 0)
    lens.inputs["Distortion"].default_value = 0.015
    L.new(math('POWER', math('MAXIMUM', lum, 0.0, 1460, 120), 2.2, 1500, 120),
          lens.inputs["Image"])
    out = node("NodeGroupOutput", 1760, 0)
    L.new(lens.outputs["Image"], out.inputs[0])
    viewer = node("CompositorNodeViewer", 1760, -200)
    L.new(lens.outputs["Image"], viewer.inputs[0])


# --------------------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------------------
def build(samples=256, percent=100, grade=True):
    scene = reset_scene()
    mats = build_materials()
    c_land = collection("Land")
    c_line = collection("Survey Line")
    c_inst = collection("Instrument")
    c_it = collection("It")
    c_atmo = collection("Atmosphere")
    c_cam = collection("Camera")

    build_terrain(c_land, mats)
    build_line(c_line, mats)
    lamp, glass, head = build_instrument(c_inst, mats)
    fig = build_figure(c_it, mats)
    build_atmosphere(scene, c_atmo)
    build_camera(scene, c_cam, fig, head)
    setup_render(scene, samples, percent)
    animate_lantern(lamp, glass)
    animate_figure(fig)
    if grade:
        setup_compositor(scene)

    # markers so the beats are easy to find on the timeline
    for i, (frame, _) in enumerate(FIGURE_STEPS[1:], 1):
        scene.timeline_markers.new(f"Dark {i}", frame=frame)
    scene.frame_set(1)
    log("Scene built.")
    return scene


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"still": None, "animation": False, "samples": 256, "percent": 100,
            "out": None, "save": True, "grass": None, "grade": True}
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
        elif a == "--grass":
            opts["grass"] = int(next(it))
        elif a == "--no-grade":
            opts["grade"] = False
        elif a == "--no-save":
            opts["save"] = False
    return opts


def main():
    global GRASS_PARENTS
    opts = parse_args()
    if opts["grass"] is not None:
        GRASS_PARENTS = opts["grass"]
    scene = build(opts["samples"], opts["percent"], opts["grade"])

    here = os.path.dirname(os.path.abspath(__file__)) if "__file__" in globals() else os.getcwd()
    if bpy.app.background and opts["save"]:
        path = os.path.join(here, "the_survey_station_zero.blend")
        bpy.ops.wm.save_as_mainfile(filepath=path)
        log(f"Saved {path}")

    if opts["still"] is not None:
        scene.frame_set(opts["still"])
        out = opts["out"] or f"//preview_{opts['still']:04d}.png"
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        log(f"Rendered frame {opts['still']} -> {bpy.path.abspath(out)}")
    elif opts["animation"]:
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
