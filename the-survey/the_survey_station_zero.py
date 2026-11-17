"""
THE SURVEY - "Station Zero"
A self-contained horror shot for Blender 5.x (scene building also works in 4.2+).

We are inside a dry-stone shelter, looking out through its doorway at a field
whited out by fog, with a low moon hanging in the haze. A surveyor's theodolite stands
just inside the threshold, silhouetted, sighting down a line of flagged stakes that runs
away into the white. The floor of the shelter is flooded; the doorway shines in it.

Far out on the line stands a woman in a white dress and veil. Each time the lantern
hanging from the tripod gutters out, she is one stake closer. She never moves while the
light is on. The last time it relights she is standing on the threshold, and the
lantern finds her face.

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

import bpy
import bmesh
from mathutils import Euler, Matrix, Vector, noise

# --------------------------------------------------------------------------------------
# TUNING
# --------------------------------------------------------------------------------------
FPS = 24
FRAME_END = 360                     # 15 seconds

STAKE_SPACING = 10.0                # metres between stations
STAKE_COUNT = 24                    # stations 1+00 ... 24+00 along +Y

# The woman's position on the line (Y, metres from the doorway) after each blackout.
# frame -> y. She only ever moves while the light is out.
FIGURE_STEPS = [(1, 138.0), (96, 78.0), (168, 44.0), (232, 23.0), (292, 10.6), (330, 1.9)]
BLACKOUT_FRAMES = 4                 # how long each blackout lasts

FOG_DENSITY = 0.0085                # outside: how fast the field whites out
GROUND_FOG = 1.2                    # extra density in the first metre or two
SKY_STRENGTH = 2.2                  # overcast fog light; this is what whites out the door
MOON_GLOW = 45.0
LANTERN_WATTS = 60.0

GRASS_PARENTS = 40000               # raise for the final render, lower for speed
GRASS_CHILDREN = 6

CROWS = 7                           # the flock that crosses the doorway early on

# Film look: hard black-and-white, white highlights that bloom, blacks crushed to
# nothing, heavy vignette, fine grain.
BW_WEIGHTS = (0.24, 0.46, 0.30)     # R, G, B
GRAIN = 0.035
VIGNETTE = 0.8
GLOW = 0.55
EXPOSURE = -0.4

SEED = 1964

# --------------------------------------------------------------------------------------
rng = random.Random(SEED)
IS_5X = bpy.app.version >= (5, 0, 0)

# Shelter layout (metres). The doorway is centred on x = 0 in the front wall.
HUT_X = (-2.3, 2.3)
HUT_BACK_Y = -7.0
HUT_FRONT_Y = -1.3                  # centre line of the front wall
WALL_T = 0.6
WALL_H = 2.7
DOOR_W = 1.8
DOOR_H = 2.0


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
    for ng in list(bpy.data.node_groups):
        if ng.bl_idname == 'CompositorNodeTree':
            bpy.data.node_groups.remove(ng)
    scene.timeline_markers.clear()
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
    """Deterministic terrain height, so props can be placed on the ground exactly.
    Flat meadow, very gently rolling, dead level around the shelter."""
    rolling = 1.1 * noise.noise(Vector((x / 60.0, y / 60.0, 0.3)))
    lumps = 0.08 * noise.noise(Vector((x / 6.0, y / 6.0, 4.1)))
    near = smoothstep(6.0, 30.0, math.hypot(x, y + 4.0))
    return (rolling + lumps) * near


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


def lathe(bm, profile, segs=48, arc=(0.0, 2 * math.pi), wobble=None):
    """Revolve a list of (radius, z) around Z. wobble(theta, z) -> radial offset."""
    closed = abs(arc[1] - arc[0] - 2 * math.pi) < 1e-6
    n_theta = segs if closed else segs + 1
    rings = []
    for r, z in profile:
        ring = []
        for k in range(n_theta):
            th = arc[0] + (arc[1] - arc[0]) * k / segs
            rr = r + (wobble(th, z) if wobble else 0.0)
            ring.append(bm.verts.new((rr * math.sin(th), -rr * math.cos(th), z)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(n_theta if closed else n_theta - 1):
            k2 = (k + 1) % n_theta
            bm.faces.new((a[k], a[k2], b[k2], b[k]))


def principled(name, color, rough=0.6, metal=0.0, **extra):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    for k, value in extra.items():
        bsdf.inputs[k].default_value = value
    return mat


def bump_material(mat, scale, strength, detail=8.0):
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = scale
    tex.inputs["Detail"].default_value = detail
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    nt.links.new(tex.outputs["Factor"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return tex


def key(datablock, path, frame, value, interp=None):
    if isinstance(path, tuple):
        path, index = path
    else:
        index = -1
    if path.startswith('["'):
        datablock[path[2:-2]] = value
    elif index >= 0:
        getattr(datablock, path)[index] = value
    else:
        setattr(datablock, path, value)
    datablock.keyframe_insert(data_path=path, index=index, frame=frame)
    if interp:
        for fc in fcurves_of(datablock.id_data):
            if fc.data_path.endswith(path):
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
    m = principled("Meadow", (0.10, 0.10, 0.085), rough=0.95)
    bump_material(m, 3.0, 0.5)
    mats["ground"] = m
    mats["grass"] = principled("Grass", (0.22, 0.22, 0.17), rough=0.6,
                               **{"Subsurface Weight": 0.2})
    m = principled("Fieldstone", (0.16, 0.155, 0.145), rough=0.9)
    bump_material(m, 6.0, 0.9, 12.0)
    mats["stone"] = m
    m = principled("Floor Slab", (0.08, 0.08, 0.075), rough=0.8)
    bump_material(m, 2.0, 0.4)
    mats["floor"] = m

    # Standing water on the floor: black mirror with a slow ripple.
    m = principled("Floodwater", (0.005, 0.005, 0.006), rough=0.02,
                   **{"IOR": 1.33, "Specular IOR Level": 0.7})
    tex = bump_material(m, 1.4, 0.06, 2.0)
    tex.noise_dimensions = '4D'
    tex.inputs["W"].default_value = 0.0
    tex.inputs["W"].keyframe_insert("default_value", frame=1)
    tex.inputs["W"].default_value = 2.5
    tex.inputs["W"].keyframe_insert("default_value", frame=FRAME_END)
    mats["water"] = m

    mats["wood"] = principled("Lath", (0.30, 0.24, 0.17), rough=0.85)
    mats["tripod"] = principled("Tripod Wood", (0.16, 0.10, 0.06), rough=0.55)
    mats["flag"] = principled("Flagging Tape", (0.9, 0.9, 0.88), rough=0.45)
    mats["instrument"] = principled("Instrument Paint", (0.4, 0.42, 0.38), rough=0.35)
    mats["metal"] = principled("Brass", (0.75, 0.6, 0.35), rough=0.3, metal=1.0)
    mats["glass"] = principled("Lens", (0.02, 0.02, 0.03), rough=0.05,
                               **{"Coat Weight": 1.0})
    mats["tape"] = principled("Chain Tape", (0.6, 0.55, 0.3), rough=0.4, metal=0.6)

    # The woman. Skin is chalk-pale; eyes and lips are smudged black.
    mats["skin"] = principled("Pale Skin", (0.80, 0.78, 0.75), rough=0.55,
                              **{"Subsurface Weight": 0.25,
                                 "Subsurface Radius": (0.5, 0.25, 0.2)})
    mats["kohl"] = principled("Kohl", (0.01, 0.01, 0.01), rough=0.35)
    mats["hair"] = principled("Hair", (0.015, 0.012, 0.01), rough=0.45)
    m = principled("White Dress", (0.88, 0.87, 0.84), rough=0.7,
                   **{"Sheen Weight": 0.5, "Subsurface Weight": 0.1})
    mats["dress"] = m
    m = principled("Veil", (0.95, 0.95, 0.95), rough=0.4,
                   **{"Transmission Weight": 0.7, "Alpha": 0.55})
    mats["veil"] = m
    mats["flowers"] = principled("Crown Flowers", (0.9, 0.9, 0.86), rough=0.6)
    mats["crow"] = principled("Crow", (0.01, 0.01, 0.01), rough=0.5)

    m = bpy.data.materials.new("Lantern Glow")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (1.0, 0.88, 0.7, 1.0)
    em.inputs["Strength"].default_value = 2.5
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    mats["lantern"] = m

    m = bpy.data.materials.new("Moon")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = MOON_GLOW
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    mats["moon"] = m
    return mats


# --------------------------------------------------------------------------------------
# The shelter: dry-stone walls, a lintel, roof slabs and a flooded floor
# --------------------------------------------------------------------------------------
def stone_course(bm, frame, length, height, thickness, opening=None):
    """Lay rough stones along local X (0..length), up local Z, thickness along local Y.
    `opening` = (u0, u1, top) leaves a gap. Chinks between stones are left open."""
    z = 0.0
    gap = 0.018
    while z < height - 0.05:
        h = min(rng.uniform(0.17, 0.32), height - z)
        spans = [(0.0, length)]
        if opening and z < opening[2]:
            spans = [(0.0, opening[0]), (opening[1], length)]
        for s0, s1 in spans:
            u = s0
            first = True
            while u < s1 - 0.02:
                w = rng.uniform(0.3, 0.75)
                if first:                         # stagger the courses
                    w *= rng.uniform(0.3, 1.0)
                    first = False
                w = min(w, s1 - u)
                t = thickness * rng.uniform(0.88, 1.05)
                rot = Euler((rng.uniform(-0.04, 0.04), rng.uniform(-0.05, 0.05),
                             rng.uniform(-0.04, 0.04))).to_matrix().to_4x4()
                c = Vector((u + w / 2, rng.uniform(-0.03, 0.03), z + h / 2))
                add_box(bm, (w - gap, t, h - gap), frame @ Matrix.Translation(c) @ rot)
                u += w
        z += h
    return z


def build_shelter(coll, mats):
    bm = bmesh.new()
    x0, x1 = HUT_X
    width = x1 - x0
    # Front wall, with the doorway.
    front = Matrix.Translation((x0, HUT_FRONT_Y, 0))
    du0 = -x0 - DOOR_W / 2
    stone_course(bm, front, width, WALL_H, WALL_T, (du0, du0 + DOOR_W, DOOR_H))
    # Lintel: one long slab over the door.
    add_box(bm, (DOOR_W + 0.9, WALL_T * 1.05, 0.28),
            Matrix.Translation((0, HUT_FRONT_Y, DOOR_H + 0.14))
            @ Matrix.Rotation(0.02, 4, 'Y'))
    # Back wall.
    stone_course(bm, Matrix.Translation((x0, HUT_BACK_Y, 0)), width, WALL_H, WALL_T)
    # Side walls (local X runs along world +Y).
    depth = HUT_FRONT_Y - HUT_BACK_Y
    for x in (x0, x1):
        side = Matrix.Translation((x, HUT_BACK_Y, 0)) @ Matrix.Rotation(math.pi / 2, 4, 'Z')
        # a narrow window slit in the right wall throws a sliver of light inside
        slit = (1.6, 1.85, 1.75) if x > 0 else None
        if slit:
            stone_course(bm, side, depth, WALL_H, WALL_T, slit)
        else:
            stone_course(bm, side, depth, WALL_H, WALL_T)
    # A rubble-and-mud core inside the walls keeps the chinks from leaking light, except
    # through the slit in the right wall.
    core_t = WALL_T * 0.5
    h_side = DOOR_H + 0.3
    for u0, u1 in ((x0, -DOOR_W / 2), (DOOR_W / 2, x1)):
        add_box(bm, (u1 - u0, core_t, WALL_H), Matrix.Translation(((u0 + u1) / 2, HUT_FRONT_Y,
                                                                   WALL_H / 2)))
    add_box(bm, (DOOR_W, core_t, WALL_H - h_side),
            Matrix.Translation((0, HUT_FRONT_Y, h_side + (WALL_H - h_side) / 2)))
    add_box(bm, (width, core_t, WALL_H), Matrix.Translation((0, HUT_BACK_Y, WALL_H / 2)))
    add_box(bm, (core_t, depth, WALL_H), Matrix.Translation((x0, (HUT_FRONT_Y + HUT_BACK_Y) / 2,
                                                             WALL_H / 2)))
    sy0, sy1 = HUT_BACK_Y + 1.6, HUT_BACK_Y + 1.85
    for a, b in ((HUT_BACK_Y, sy0), (sy1, HUT_FRONT_Y)):
        add_box(bm, (core_t, b - a, WALL_H), Matrix.Translation((x1, (a + b) / 2, WALL_H / 2)))
    add_box(bm, (core_t, sy1 - sy0, WALL_H - 1.75),
            Matrix.Translation((x1, (sy0 + sy1) / 2, 1.75 + (WALL_H - 1.75) / 2)))
    add_box(bm, (width + WALL_T, depth + WALL_T, 0.1),
            Matrix.Translation((0, (HUT_FRONT_Y + HUT_BACK_Y) / 2, WALL_H + 0.02)))
    walls = mesh_object("Shelter Walls", bm, coll, mats["stone"])
    bev = walls.modifiers.new("Rounded", 'BEVEL')
    bev.width = 0.035
    bev.segments = 2

    # Roof: heavy overlapping slabs.
    bm = bmesh.new()
    y = HUT_BACK_Y - 0.4
    while y < HUT_FRONT_Y + 0.4:
        d = rng.uniform(0.7, 1.1)
        add_box(bm, (width + 1.0, d + 0.15, rng.uniform(0.16, 0.24)),
                Matrix.Translation((rng.uniform(-0.1, 0.1), y + d / 2, WALL_H + 0.12))
                @ Matrix.Rotation(rng.uniform(-0.04, 0.04), 4, 'X'))
        y += d
    mesh_object("Roof Slabs", bm, coll, mats["stone"])

    # Floor slabs and the water lying on them; the water spills a little past the door.
    bm = bmesh.new()
    add_box(bm, (width + WALL_T, HUT_FRONT_Y - HUT_BACK_Y + WALL_T, 0.1),
            Matrix.Translation((0, (HUT_FRONT_Y + HUT_BACK_Y) / 2, -0.04)))
    mesh_object("Floor", bm, coll, mats["floor"])
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5,
                          matrix=Matrix.Translation((0, (HUT_FRONT_Y + HUT_BACK_Y) / 2 + 0.5,
                                                     0.025))
                          @ Matrix.Diagonal((width, HUT_FRONT_Y - HUT_BACK_Y + 1.0, 1, 1)))
    mesh_object("Floodwater", bm, coll, mats["water"])


# --------------------------------------------------------------------------------------
# Terrain and grass outside
# --------------------------------------------------------------------------------------
def build_terrain(coll, mats):
    size, res = 360.0, 260
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res, y_segments=res, size=size / 2)
    for v in bm.verts:
        v.co.y += 120.0
        v.co.z = ground_height(v.co.x, v.co.y) - 0.02
    ground = mesh_object("Meadow", bm, coll, mats["ground"], smooth=True)

    vg = ground.vertex_groups.new(name="grass")
    for v in ground.data.vertices:
        x, y = v.co.x, v.co.y
        if y < HUT_FRONT_Y + WALL_T and abs(x) < 3.5:
            continue                                   # no grass inside the shelter
        cut = smoothstep(0.45, 1.4, abs(x))            # trampled line along the stakes
        near = 1.0 - smoothstep(30.0, 70.0, math.hypot(x * 1.5, y))
        w = cut * near
        if w > 0.001:
            vg.add([v.index], w, 'REPLACE')

    bm = bmesh.new()
    h, w = 0.28, 0.011
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
def build_stake(bm_stake, bm_flag, x, y):
    z = ground_height(x, y)
    tilt = Euler((math.radians(rng.uniform(-5, 5)), math.radians(rng.uniform(-5, 5)),
                  math.radians(rng.uniform(0, 180))))
    base = Matrix.Translation((x, y, z - 0.25)) @ tilt.to_matrix().to_4x4()
    height = 1.35
    add_box(bm_stake, (0.045, 0.018, height), base @ Matrix.Translation((0, 0, height / 2)))
    top = base @ Matrix.Translation((0, 0, height - 0.08))
    length = rng.uniform(0.35, 0.6)
    lift = math.radians(rng.uniform(15, 40))
    for k in range(2):
        yaw = math.radians(rng.uniform(-30, 30) + 180 * k)
        m = (top @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(math.pi - lift, 4, 'X')
             @ Matrix.Translation((0, 0, length / 2)))
        add_box(bm_flag, (0.03, 0.002, length), m)
    add_box(bm_flag, (0.06, 0.03, 0.03), top)


def build_line(coll, mats):
    bm_stake, bm_flag = bmesh.new(), bmesh.new()
    for i in range(1, STAKE_COUNT + 1):
        build_stake(bm_stake, bm_flag, rng.uniform(-0.08, 0.08), i * STAKE_SPACING)
    mesh_object("Stakes", bm_stake, coll, mats["wood"])
    mesh_object("Flagging", bm_flag, coll, mats["flag"])

    # Steel chain tape from the instrument, through the water, out to the first stake.
    cu = bpy.data.curves.new("Chain Tape", 'CURVE')
    cu.dimensions = '3D'
    cu.extrude = 0.006
    spline = cu.splines.new('POLY')
    pts = []
    start = INSTRUMENT_POS + Vector((0.1, 0.25, 0))
    for k in range(51):
        t = k / 50.0
        y = start.y + t * (STAKE_SPACING - 0.2 - start.y)
        x = start.x * (1 - t) + 0.12 * math.sin(t * 9.0) * (1 - t)
        inside = y < HUT_FRONT_Y + WALL_T / 2
        z = 0.03 if inside else ground_height(x, y) + 0.01
        pts.append((x, y, z))
    spline.points.add(len(pts) - 1)
    for p, co in zip(spline.points, pts):
        p.co = (*co, 1.0)
    tape = bpy.data.objects.new("Chain Tape", cu)
    cu.materials.append(mats["tape"])
    coll.objects.link(tape)


# --------------------------------------------------------------------------------------
# Theodolite on its tripod, just inside the door, with a hanging lantern
# --------------------------------------------------------------------------------------
INSTRUMENT_POS = Vector((-0.5, -2.3, 0.0))
HEAD_HEIGHT = 1.22


def build_instrument(coll, mats):
    origin = INSTRUMENT_POS.copy()
    head = origin + Vector((0, 0, HEAD_HEIGHT))

    bm = bmesh.new()
    for k in range(3):
        a = math.radians(90 + 120 * k + 15)
        foot = origin + Vector((math.cos(a) * 0.6, math.sin(a) * 0.6, -0.02))
        limb(bm, foot, head - Vector((0, 0, 0.03)), 0.022, 0.03, segs=8)
    add_cylinder(bm, 0.1, 0.045, Matrix.Translation(head))
    mesh_object("Tripod", bm, coll, mats["tripod"], smooth=True)

    bm = bmesh.new()
    add_cylinder(bm, 0.075, 0.05, Matrix.Translation(head + Vector((0, 0, 0.05))), 24)
    add_cylinder(bm, 0.06, 0.07, Matrix.Translation(head + Vector((0, 0, 0.11))), 24)
    for side in (-1, 1):
        add_box(bm, (0.025, 0.07, 0.17),
                Matrix.Translation(head + Vector((side * 0.06, 0, 0.23))))
    add_cylinder(bm, 0.035, 0.04, Matrix.Translation(head + Vector((0, 0, 0.32)))
                 @ Matrix.Rotation(math.pi / 2, 4, 'Y'), 20)
    mesh_object("Theodolite", bm, coll, mats["instrument"], smooth=True)

    aim = (Matrix.Translation(head + Vector((0, 0.02, 0.31)))
           @ Matrix.Rotation(-math.pi / 2, 4, 'X'))
    bm = bmesh.new()
    add_cylinder(bm, 0.032, 0.30, aim, 24, radius2=0.04)
    add_cylinder(bm, 0.018, 0.06, aim @ Matrix.Translation((0, 0, -0.17)), 16)
    mesh_object("Telescope", bm, coll, mats["instrument"], smooth=True)
    bm = bmesh.new()
    add_cylinder(bm, 0.036, 0.004, aim @ Matrix.Translation((0, 0, 0.152)), 24)
    mesh_object("Objective", bm, coll, mats["glass"], smooth=True)
    bm = bmesh.new()
    add_cylinder(bm, 0.008, 0.07, Matrix.Translation(head + Vector((0, -0.05, 0.135)))
                 @ Matrix.Rotation(math.pi / 2, 4, 'Y'), 8)
    mesh_object("Level Vial", bm, coll, mats["metal"])

    # Lantern on a short wire from the tripod head, on the camera side.
    hook = head + Vector((0.18, -0.12, -0.05))
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
    light.color = (1.0, 0.88, 0.7)
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
        for b in blackouts:
            if b - 10 <= frame < b:
                v *= rng.uniform(0.35, 0.8)
        key(lamp, '["flame"]', frame, v)
        frame += rng.choice((2, 3, 3, 4))
    for b in blackouts:
        key(lamp, '["flame"]', b - 1, 0.25)
        key(lamp, '["flame"]', b, 0.0, 'CONSTANT')
        key(lamp, '["flame"]', b + BLACKOUT_FRAMES - 1, 0.0, 'CONSTANT')
        key(lamp, '["flame"]', b + BLACKOUT_FRAMES, 1.35)
        key(lamp, '["flame"]', b + BLACKOUT_FRAMES + 3, 1.0)
    for fc in fcurves_of(lamp):
        for kp in list(fc.keyframe_points):
            f = kp.co.x
            for b in blackouts:
                if b < f < b + BLACKOUT_FRAMES - 1:
                    fc.keyframe_points.remove(kp)
                    break

    def drive(target, path, scale):
        fc = target.driver_add(path)
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
    drive(em.inputs["Strength"], "default_value", 2.5)


# --------------------------------------------------------------------------------------
# The woman in white
# --------------------------------------------------------------------------------------
def build_woman(coll, mats):
    """A blockout of the bride: floor-length white slip dress, long veil, crown of
    small white flowers, long black hair, chalk-white face with blackened eyes and
    lips. Built facing -Y (towards the shelter). Swap in a sculpt when you have one."""
    root = bpy.data.objects.new("Her", None)
    root.empty_display_type = 'SINGLE_ARROW'
    coll.objects.link(root)

    def part(name, bm, mat, subsurf=0):
        ob = mesh_object(name, bm, coll, mats[mat], smooth=True)
        ob.parent = root
        if subsurf:
            m = ob.modifiers.new("Soften", 'SUBSURF')
            m.levels = 1
            m.render_levels = subsurf
        return ob

    # Dress: gathered under the bust, falling in folds to the ground.
    bm = bmesh.new()
    profile = []
    for i in range(15):
        t = i / 14.0
        z = 0.02 + t * 1.22
        r = 0.36 - 0.21 * (t ** 0.8)
        profile.append((r, z))
    profile += [(0.15, 1.30), (0.16, 1.38), (0.14, 1.44)]

    def folds(th, z):
        depth = 0.028 * (1.0 - smoothstep(0.6, 1.25, z))
        return depth * math.sin(11 * th + 1.5 * noise.noise(Vector((th, z, 0.0))))
    lathe(bm, profile, segs=64, wobble=folds)
    dress = part("Dress", bm, "dress", 1)
    # thin straps
    bm = bmesh.new()
    for side in (-1, 1):
        limb(bm, (side * 0.09, -0.06, 1.43), (side * 0.12, -0.01, 1.52), 0.008, 0.008, 6)
        limb(bm, (side * 0.09, 0.06, 1.43), (side * 0.12, -0.01, 1.52), 0.008, 0.008, 6)
    part("Straps", bm, "dress")

    # Skin: shoulders, arms hanging straight, neck, head.
    bm = bmesh.new()
    add_sphere(bm, 0.1, Matrix.Translation((0, 0, 1.47)), (1.85, 0.95, 0.55), 20)
    for side in (-1, 1):
        sh = Vector((side * 0.17, 0.0, 1.47))
        el = Vector((side * 0.2, 0.0, 1.17))
        wr = Vector((side * 0.21, -0.03, 0.9))
        limb(bm, sh, el, 0.038, 0.03)
        limb(bm, el, wr, 0.03, 0.022)
        limb(bm, wr, wr + Vector((0, -0.01, -0.17)), 0.024, 0.008, 8)
    limb(bm, (0, 0, 1.47), (0, -0.01, 1.6), 0.045, 0.04)
    head = Matrix.Translation((0, -0.01, 1.68)) @ Matrix.Rotation(math.radians(-7), 4, 'Y')
    add_sphere(bm, 0.098, head, (0.82, 0.95, 1.17), 28)
    part("Skin", bm, "skin", 1)

    # Blackened eye hollows and lips, sitting on the face (the face looks along -Y).
    bm = bmesh.new()
    for side in (-1, 1):
        add_sphere(bm, 0.022, head @ Matrix.Translation((side * 0.034, -0.083, 0.012)),
                   (1.35, 0.35, 0.9), 12)
    add_sphere(bm, 0.02, head @ Matrix.Translation((0, -0.088, -0.072)), (1.5, 0.35, 0.5), 12)
    part("Kohl", bm, "kohl")

    # Hair: long, black, parted, falling down the back and over the shoulders.
    bm = bmesh.new()
    add_sphere(bm, 0.11, head @ Matrix.Translation((0, 0.022, 0.018)), (0.92, 0.95, 1.12), 24)
    add_sphere(bm, 0.1, Matrix.Translation((0, 0.07, 1.42)), (1.25, 0.45, 2.6), 20)
    for side in (-1, 1):
        add_sphere(bm, 0.05, Matrix.Translation((side * 0.11, -0.035, 1.47))
                   @ Matrix.Rotation(side * 0.12, 4, 'Y'), (0.75, 0.55, 3.2), 14)
    part("Hair", bm, "hair", 1)

    # Crown of small white flowers.
    bm = bmesh.new()
    for k in range(16):
        a = 2 * math.pi * k / 16
        if math.sin(a) > 0.75 and math.cos(a) < 0:
            pass
        p = head @ Vector((0.095 * math.cos(a), 0.1 * math.sin(a), 0.085 + 0.01 * math.sin(3 * a)))
        add_sphere(bm, rng.uniform(0.016, 0.024), Matrix.Translation(p), (1, 1, 0.7), 8)
    part("Flower Crown", bm, "flowers")

    # Veil: a sheer half-cone from the crown down the back to the knees.
    bm = bmesh.new()
    vprof = [(0.1 + 0.2 * (i / 10.0) ** 1.2, 1.78 - 1.3 * i / 10.0) for i in range(11)]

    def drape(th, z):
        return 0.02 * math.sin(7 * th + z * 4)
    lathe(bm, vprof, segs=24, arc=(math.radians(115), math.radians(245)), wobble=drape)
    veil = part("Veil", bm, "veil", 1)
    for ob in (veil,):
        ob.location.y = 0.03
    return root


def animate_woman(root):
    for frame, y in FIGURE_STEPS:
        x = 0.28 + rng.uniform(-0.06, 0.06)
        z = ground_height(x, y)
        key(root, "location", frame, (x, y, z), 'CONSTANT')
        key(root, "rotation_euler", frame, (0.0, 0.0, math.radians(rng.uniform(-6, 6))),
            'CONSTANT')
    for fc in fcurves_of(root):
        for kp in fc.keyframe_points:
            kp.interpolation = 'CONSTANT'


# --------------------------------------------------------------------------------------
# Crows crossing the doorway
# --------------------------------------------------------------------------------------
def build_crows(coll, mats):
    for i in range(CROWS):
        body = bpy.data.objects.new(f"Crow {i + 1}", None)
        coll.objects.link(body)
        bm = bmesh.new()
        add_sphere(bm, 0.11, Matrix.Identity(4), (0.6, 2.0, 0.55), 12)
        add_sphere(bm, 0.05, Matrix.Translation((0, 0.22, 0.02)), (1, 1.2, 1), 10)
        add_box(bm, (0.1, 0.18, 0.015), Matrix.Translation((0, -0.26, 0)))
        torso = mesh_object(f"Crow {i + 1} Body", bm, coll, mats["crow"], smooth=True)
        torso.parent = body
        for side in (-1, 1):
            bm = bmesh.new()
            add_box(bm, (0.42, 0.16, 0.012), Matrix.Translation((side * 0.24, 0.0, 0)))
            add_box(bm, (0.2, 0.1, 0.01), Matrix.Translation((side * 0.5, -0.05, 0))
                    @ Matrix.Rotation(side * 0.3, 4, 'Z'))
            wing = mesh_object(f"Crow {i + 1} Wing", bm, coll, mats["crow"])
            wing.parent = body
            period = rng.randint(7, 10)
            phase = rng.randint(0, period)
            for f, a in ((1 + phase, 40), (1 + phase + period // 2, -25), (1 + phase + period, 40)):
                key(wing, ("rotation_euler", 1), f, math.radians(a * side))
            for fc in fcurves_of(wing):
                fc.modifiers.new('CYCLES')
        # flight: right to left across the field beyond the door
        start_f = 20 + i * rng.randint(3, 7)
        dur = rng.randint(45, 60)
        y = rng.uniform(11, 20)
        z = rng.uniform(1.8, 3.6)
        x0 = 14 + rng.uniform(-2, 2)
        x1 = -14 + rng.uniform(-2, 2)
        body.rotation_euler = (0, 0, math.pi / 2)
        key(body, "location", start_f, (x0, y, z), 'LINEAR')
        key(body, "location", start_f + dur, (x1, y + rng.uniform(-4, 4), z + rng.uniform(-1, 1.5)),
            'LINEAR')
        for fc in fcurves_of(body):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
            fc.extrapolation = 'LINEAR'


# --------------------------------------------------------------------------------------
# Fog, sky, moon
# --------------------------------------------------------------------------------------
def build_atmosphere(scene, coll, mats):
    world = bpy.data.worlds.get("White Fog") or bpy.data.worlds.new("White Fog")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.82, 0.85, 0.9, 1.0)
    bg.inputs["Strength"].default_value = SKY_STRENGTH

    # A low moon, hazed by the fog.
    bm = bmesh.new()
    add_sphere(bm, 1.9, Matrix.Identity(4), segs=24)
    moon = mesh_object("Moon", bm, coll, mats["moon"])
    moon.location = (-26.0, 230.0, 34.0)
    moon.visible_shadow = False

    # Fog: thicker near the ground, broken up by slow noise. Covers the shelter too, so
    # the lantern and the door light show in the air inside.
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    fog = mesh_object("Fog", bm, coll)
    fog.scale = (360, 400, 50)
    fog.location = (0, 120, 20)
    fog.display_type = 'BOUNDS'
    mat = bpy.data.materials.new("Fog")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Color"].default_value = (0.9, 0.92, 0.95, 1.0)
    vol.inputs["Anisotropy"].default_value = 0.3
    coord = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(coord.outputs["Position"], sep.inputs["Vector"])

    def m(op, a=None, b=None, c=None):
        n = nt.nodes.new("ShaderNodeMath")
        n.operation = op
        for i, v in enumerate((a, b, c)):
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            elif v is not None:
                nt.links.new(v, n.inputs[i])
        return n.outputs[0]

    z = sep.outputs["Z"]
    falloff = m('EXPONENT', m('MULTIPLY', m('MAXIMUM', z, 0.0), -0.5))
    height = m('ADD', m('MULTIPLY', falloff, GROUND_FOG), 1.0)
    tex = nt.nodes.new("ShaderNodeTexNoise")
    tex.inputs["Scale"].default_value = 0.03
    tex.inputs["Detail"].default_value = 3.0
    nt.links.new(coord.outputs["Position"], tex.inputs["Vector"])
    patchy = m('MULTIPLY_ADD', tex.outputs["Factor"], 1.0, 0.5)
    dens = m('MULTIPLY', m('MULTIPLY', height, patchy), FOG_DENSITY)
    nt.links.new(dens, vol.inputs["Density"])
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    fog.data.materials.append(mat)
    return fog


# --------------------------------------------------------------------------------------
# Camera
# --------------------------------------------------------------------------------------
def build_camera(scene, coll, head):
    cam_data = bpy.data.cameras.new("Shelter Camera")
    cam_data.lens = 24
    cam_data.sensor_width = 36
    cam_data.clip_start = 0.05
    cam_data.clip_end = 800
    cam_data.dof.use_dof = True
    cam_data.dof.aperture_fstop = 2.8
    cam = bpy.data.objects.new("Shelter Camera", cam_data)
    coll.objects.link(cam)
    scene.camera = cam

    look = bpy.data.objects.new("Look At", None)
    look.empty_display_size = 0.5
    coll.objects.link(look)
    look.location = (0.0, 30.0, 1.0)
    focus = bpy.data.objects.new("Focus", None)
    focus.empty_display_size = 0.3
    coll.objects.link(focus)
    cam_data.dof.focus_object = focus

    track = cam.constraints.new('TRACK_TO')
    track.target = look
    track.track_axis = 'TRACK_NEGATIVE_Z'
    track.up_axis = 'UP_Y'

    # Slow push from the back of the shelter toward the door.
    key(cam, "location", 1, (0.25, -6.45, 0.92))
    key(cam, "location", FRAME_END, (0.1, -5.3, 0.98))
    key(look, "location", 1, look.location[:])
    for fc in fcurves_of(look):
        n = fc.modifiers.new('NOISE')
        n.scale = 40.0
        n.strength = 0.2 if fc.array_index != 1 else 0.0
        n.phase = 10.0 * fc.array_index

    # Focus holds on the instrument, then racks out to her on the threshold.
    last_frame, last_y = FIGURE_STEPS[-1]
    hold = head + Vector((0, 0.05, 0.3))
    key(focus, "location", 1, hold)
    key(focus, "location", last_frame + BLACKOUT_FRAMES + 6, hold)
    key(focus, "location", last_frame + BLACKOUT_FRAMES + 22, (0.28, last_y, 1.66))
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
    try:
        scene.view_settings.view_transform = 'AgX'
        scene.view_settings.look = 'None'
    except TypeError:
        scene.view_settings.view_transform = 'Filmic'
    scene.view_settings.exposure = EXPOSURE
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

    def math_(op, a, b=None, x=0, y=0, c=None):
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

    # 1. Spectral response -> grey (linear)
    r = math_('MULTIPLY', sep.outputs["Red"], BW_WEIGHTS[0], -800, 150)
    g = math_('MULTIPLY', sep.outputs["Green"], BW_WEIGHTS[1], -800, 0)
    b = math_('MULTIPLY', sep.outputs["Blue"], BW_WEIGHTS[2], -800, -150)
    grey = math_('ADD', math_('ADD', r, g, -650, 80), b, -500, 0)

    # 2. Halation: the white doorway and the lantern bloom into the dark around them
    glare = node("CompositorNodeGlare", -320, 0)
    glare.inputs["Type"].default_value = 'Fog Glow'
    glare.inputs["Threshold"].default_value = 0.7
    glare.inputs["Strength"].default_value = GLOW
    glare.inputs["Size"].default_value = 0.8
    L.new(grey, glare.inputs["Image"])

    # 3. Hard tone curve on a gamma-encoded copy: blacks crushed, whites pushed to paper
    encoded = math_('POWER', math_('MAXIMUM', glare.outputs["Image"], 0.0, -220, -120),
                    1 / 2.2, -160, -120)
    curve = node("CompositorNodeCurveRGB", -120, 0)
    c = curve.mapping.curves[3]
    c.points[0].location = (0.0, 0.0)
    c.points[1].location = (1.0, 1.0)
    c.points.new(0.09, 0.0)
    c.points.new(0.35, 0.26)
    c.points.new(0.72, 0.86)
    curve.mapping.update()
    L.new(encoded, curve.inputs["Image"])
    lum = curve.outputs["Image"]

    # 4. Heavy vignette, falling to black at the corners
    mask = node("CompositorNodeEllipseMask", -120, -300)
    mask.inputs["Size"].default_value = (0.9, 0.95)
    blur = node("CompositorNodeBlur", 60, -300)
    blur.inputs["Size"].default_value = (420, 420)
    L.new(mask.outputs["Mask"], blur.inputs["Image"])
    vig = math_('ADD', math_('MULTIPLY', blur.outputs["Image"], VIGNETTE, 240, -300),
                1.0 - VIGNETTE, 400, -300)
    lum = math_('MULTIPLY', lum, math_('POWER', vig, 1.6, 480, -300), 560, 0)

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
    centred = math_('SUBTRACT', clump.outputs["Image"], 0.5, 440, -650)
    mid = math_('MULTIPLY', math_('MULTIPLY', lum, math_('SUBTRACT', 1.0, lum, 560, -820),
                                  720, -820), 4.0, 880, -820)
    amount = math_('MULTIPLY', math_('ADD', mid, 0.25, 1040, -820), GRAIN * 2.0, 1200, -820)
    lum = math_('MULTIPLY_ADD', centred, amount, 1380, 0, c=lum)

    # 6. Back to linear, a touch of lens barrel, out
    lens = node("CompositorNodeLensdist", 1560, 0)
    lens.inputs["Distortion"].default_value = 0.02
    L.new(math_('POWER', math_('MAXIMUM', lum, 0.0, 1460, 120), 2.2, 1500, 120),
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
    c_shelter = collection("Shelter")
    c_land = collection("Field")
    c_line = collection("Survey Line")
    c_inst = collection("Instrument")
    c_her = collection("Her")
    c_crows = collection("Crows")
    c_atmo = collection("Atmosphere")
    c_cam = collection("Camera")

    build_shelter(c_shelter, mats)
    build_terrain(c_land, mats)
    build_line(c_line, mats)
    lamp, glass, head = build_instrument(c_inst, mats)
    her = build_woman(c_her, mats)
    build_crows(c_crows, mats)
    build_atmosphere(scene, c_atmo, mats)
    build_camera(scene, c_cam, head)
    setup_render(scene, samples, percent)
    animate_lantern(lamp, glass)
    animate_woman(her)
    if grade:
        setup_compositor(scene)

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
