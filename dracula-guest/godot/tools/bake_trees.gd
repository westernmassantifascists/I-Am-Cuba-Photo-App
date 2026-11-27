extends SceneTree
## Bakes the tall trees from the photogrammetry fir (assets/scans/fir_sapling): its real scanned
## branches are stacked whorl on whorl into a spruce or a cypress, photographed against nothing, and
## saved as cut-out pictures (assets/trees/*.png). The world stands them up as crossed cards, so a
## valley of full-size conifers costs almost nothing to draw (and runs in a browser).
##   godot --path godot --script res://tools/bake_trees.gd        (needs a display / GPU)

const OUT := "res://assets/trees/"
const VARIANTS := 3

var kit: Node3D


func _init() -> void:
	kit = (load("res://assets/scans/fir_sapling/fir_sapling.gltf") as PackedScene).instantiate()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT))
	_bake.call_deferred()


func _bake() -> void:
	for kind in ["spruce", "cypress"]:
		for v in VARIANTS:
			var rng := RandomNumberGenerator.new()
			rng.seed = hash(kind) + v * 7919
			await _shoot(kind, v, rng)
	print("[bake] trees done")
	quit(0)


## One branch: a whole scanned sapling laid out from the trunk along dir.
func _branch(parent: Node3D, rng: RandomNumberGenerator, y: float, dir: Vector3, length: float, spread: float) -> void:
	var src := kit.get_child(rng.randi_range(0, kit.get_child_count() - 1))
	var n: Node3D = src.duplicate()
	var up := dir.normalized()
	var x := Vector3.UP.cross(up)
	if x.length() < 0.01:
		x = Vector3.RIGHT
	x = x.normalized()
	var z := x.cross(up).normalized()
	var k := length / 1.1
	n.basis = Basis(x * k * spread, up * k, z * k * spread * 0.55).rotated(up, rng.randf_range(-0.3, 0.3))
	n.position = Vector3(0, y, 0)
	parent.add_child(n)


func _whorl(parent: Node3D, rng: RandomNumberGenerator, y: float, count: int, length: float, rise: float, spread: float) -> void:
	var a0 := rng.randf_range(0, TAU)
	for i in count:
		var a := a0 + TAU * i / count + rng.randf_range(-0.25, 0.25)
		var dir := Vector3(cos(a), rise + rng.randf_range(-0.12, 0.12), sin(a))
		_branch(parent, rng, y + rng.randf_range(-0.08, 0.08), dir, length * rng.randf_range(0.8, 1.15), spread)


func _tree(kind: String, rng: RandomNumberGenerator) -> Array:
	var root := Node3D.new()
	var h := 0.0
	var w := 0.0
	if kind == "spruce":
		h = rng.randf_range(11.0, 14.0)
		w = 2.7
		var y := 1.2
		while y < h - 1.0:
			var t := y / h
			# whorls: long drooping boughs at the foot, short ones up to the spire
			var l := lerpf(w, 0.35, pow(t, 0.8))
			_whorl(root, rng, y, 7 if t < 0.6 else 5, l, lerpf(-0.35, 0.25, t), 1.0)
			y += rng.randf_range(0.32, 0.48)
		var top := kit.get_child(0).duplicate() as Node3D
		top.position = Vector3(0, h - 1.4, 0)
		top.scale = Vector3(0.7, 1.2, 0.7)
		root.add_child(top)
	else:
		h = rng.randf_range(9.0, 12.0)
		w = 1.05
		var y := 0.4
		while y < h - 0.8:
			var t := y / h
			# the cypress flame: branches swept up against the trunk, full low down, drawn to a point
			var prof := pow(sin(PI * clampf(t * 0.85 + 0.12, 0.0, 1.0)), 0.6)
			_whorl(root, rng, y, 7, maxf(0.35, w * 1.6 * prof), 2.4, 0.9)
			y += rng.randf_range(0.22, 0.32)
		var top := kit.get_child(2).duplicate() as Node3D
		top.position = Vector3(0, h - 1.0, 0)
		top.scale = Vector3(0.6, 1.4, 0.6)
		root.add_child(top)
	var trunk := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.03
	cyl.bottom_radius = 0.16 if kind == "spruce" else 0.1
	cyl.height = h * 0.9
	trunk.mesh = cyl
	var bark := StandardMaterial3D.new()
	bark.albedo_color = Color(0.16, 0.12, 0.09)
	bark.roughness = 1.0
	trunk.material_override = bark
	trunk.position.y = h * 0.45
	root.add_child(trunk)
	return [root, h, w]


func _shoot(kind: String, v: int, rng: RandomNumberGenerator) -> void:
	var made := _tree(kind, rng)
	var tree: Node3D = made[0]
	var h: float = made[1]
	var w: float = made[2]
	var vp := SubViewport.new()
	var aspect := 2.0 if kind == "spruce" else 4.0
	vp.size = Vector2i(512, int(512 * aspect))
	vp.transparent_bg = true
	vp.own_world_3d = true
	vp.msaa_3d = Viewport.MSAA_4X
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(vp)
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.62, 0.66, 0.7)
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_LINEAR
	var we := WorldEnvironment.new()
	we.environment = env
	vp.add_child(we)
	vp.add_child(tree)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-38, -35, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	vp.add_child(sun)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	cam.size = h * 1.04
	cam.position = Vector3(0, h * 0.5, 40)
	cam.near = 1.0
	cam.far = 80.0
	vp.add_child(cam)
	cam.current = true
	for i in 6:
		await process_frame
	await RenderingServer.frame_post_draw
	var img := vp.get_texture().get_image()
	img.convert(Image.FORMAT_RGBA8)
	# fill the colour of transparent pixels from their neighbours, so the cut edges don't fringe
	var path := "%s%s_%d.png" % [OUT, kind, v]
	img.save_png(path)
	print("[bake] ", path, " ", img.get_size(), " tree %.1f m tall, picture width %.1f m" % [h, h * 1.04 / aspect])
	vp.queue_free()
