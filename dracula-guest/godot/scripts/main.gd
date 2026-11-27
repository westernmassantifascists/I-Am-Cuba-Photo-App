extends Node3D
## Dracula's Guest — builds the world from the downloaded scans and directs it from the story.
## The story (autoload Story, compiled from story/draculas-guest.twee) decides what happens;
## this script turns its tags and feelings into place, weather, light and sound.

const Player := preload("res://scripts/player.gd")
const UI := preload("res://scripts/ui.gd")
const Music := preload("res://scripts/music.gd")

const SCANS := "res://assets/scans/"
const TEX := "res://assets/textures/"
const SKY := "res://assets/sky/"

## The route: station name (or "") • position on the map (x, z) • height of the road there.
const ROUTE := [
	["crossroads", Vector2(0, 220), 26.0],
	["", Vector2(8, 178), 22.0],
	["wayside_1", Vector2(22, 135), 17.0],
	["", Vector2(27, 98), 13.0],
	["wayside_2", Vector2(15, 58), 9.0],
	["", Vector2(-3, 22), 6.0],
	["wayside_3", Vector2(-19, -18), 4.0],
	["wayside_4", Vector2(-29, -62), 3.0],
	["village", Vector2(-24, -112), 2.0],
	["", Vector2(-8, -158), 2.0],
	["gate", Vector2(6, -192), 3.0],
	["tomb", Vector2(14, -226), 3.5],
]
const COURTYARD := Vector2(0, 318)
const PLATEAU := 26.0

## What happens when you walk into a station (passages placed with at-<station> tags).
const STATION_TARGETS := {
	"wayside_1": "@drift road", "wayside_2": "@drift road", "wayside_3": "@drift road", "wayside_4": "@drift road",
	"village": "The Deserted Village", "gate": "The Cypress Alley", "tomb": "The Tomb",
}

## atmosphere-<name>: sky (a real photographed sky), sun, fog, falling snow/hail, storm.
const WEATHER := {
	"noon":      {"sky": "kloppenheim_05_puresky", "sun": 1.3, "sun_angle": -55.0, "sky_energy": 1.0, "fog": 0.002, "fog_color": Color(0.75, 0.8, 0.85), "snow": 0.0},
	"afternoon": {"sky": "kloppenheim_03_puresky", "sun": 1.1, "sun_angle": -40.0, "sky_energy": 0.9, "fog": 0.004, "fog_color": Color(0.72, 0.76, 0.8), "snow": 0.0},
	"evening":   {"sky": "kloppenheim_06_puresky", "sun": 0.7, "sun_angle": -14.0, "sky_energy": 0.7, "fog": 0.008, "fog_color": Color(0.6, 0.55, 0.52), "snow": 0.0},
	"dusk":      {"sky": "kloppenheim_01_puresky", "sun": 0.35, "sun_angle": -6.0, "sky_energy": 0.5, "fog": 0.014, "fog_color": Color(0.4, 0.4, 0.45), "snow": 0.15},
	"snow":      {"sky": "snow_field_2_puresky", "sun": 0.3, "sun_angle": -25.0, "sky_energy": 0.6, "fog": 0.035, "fog_color": Color(0.7, 0.72, 0.76), "snow": 1.0, "ground_snow": 1.0},
	"storm":     {"sky": "kloppenheim_07_puresky", "sun": 0.12, "sun_angle": -30.0, "sky_energy": 0.35, "fog": 0.03, "fog_color": Color(0.12, 0.13, 0.16), "snow": 0.7, "ground_snow": 1.0, "lightning": 7.0},
	"hail":      {"sky": "kloppenheim_07_puresky", "sun": 0.1, "sun_angle": -30.0, "sky_energy": 0.3, "fog": 0.03, "fog_color": Color(0.1, 0.1, 0.13), "snow": 0.2, "hail": 1.0, "ground_snow": 1.0, "lightning": 3.5},
	"moon":      {"sky": "kloppenheim_02_puresky", "sun": 0.25, "sun_angle": -35.0, "sky_energy": 0.45, "fog": 0.012, "fog_color": Color(0.16, 0.19, 0.27), "snow": 0.05, "ground_snow": 1.0, "moonlight": true},
	"dawn":      {"sky": "kloppenheim_06_puresky", "sun": 0.8, "sun_angle": -8.0, "sky_energy": 0.8, "fog": 0.01, "fog_color": Color(0.75, 0.55, 0.45), "snow": 0.0, "ground_snow": 1.0},
}

## look-<name>: colour grading.
const LOOKS := {
	"warm": {"saturation": 1.08, "brightness": 1.0, "contrast": 1.0},
	"cold": {"saturation": 0.75, "brightness": 0.97, "contrast": 1.05},
	"moon": {"saturation": 0.45, "brightness": 0.95, "contrast": 1.1},
	"flash": {"saturation": 0.2, "brightness": 1.25, "contrast": 1.3},
	"dark": {"saturation": 0.3, "brightness": 0.6, "contrast": 1.2},
	"dawn": {"saturation": 0.9, "brightness": 1.02, "contrast": 1.0},
}

var player: CharacterBody3D
var ui: CanvasLayer
var music: Node
var env: Environment
var world_env: WorldEnvironment
var sun: DirectionalLight3D
var terrain_mat: ShaderMaterial
var snow: GPUParticles3D
var hail: GPUParticles3D
var stations := {}
var station_areas := {}
var station_done := {}
var weather := "noon"
var look := "warm"
var ground_snow := 0.0
var lightning_every := 0.0
var _lightning_t := 5.0
var _tick := 0.0
var _cold_acc := 0.0
var _ending_title := ""
var _walked_out := false
var rng := RandomNumberGenerator.new()
var noise := FastNoiseLite.new()
var autoplay := false
var _shots_dir := ""


func _ready() -> void:
	rng.seed = 1914
	noise.seed = 1914
	noise.frequency = 0.012
	autoplay = OS.get_cmdline_user_args().has("--autoplay")
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			_shots_dir = a.substr(8)
	_build_environment()
	_build_terrain()
	_build_courtyard()
	_build_crossroads()
	_scatter_nature()
	_build_village()
	_build_cemetery()
	_build_stations()
	_build_weather_particles()
	# world built with a fixed seed; the test bot's choices use --seed=N
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--seed="):
			rng.seed = int(a.substr(7))
			seed(int(a.substr(7)))

	player = Player.new()
	add_child(player)
	_place_player(Vector3(COURTYARD.x, PLATEAU + 0.2, COURTYARD.y + 8), Vector3(COURTYARD.x, PLATEAU + 1.6, COURTYARD.y - 20))
	music = Music.new()
	add_child(music)
	ui = UI.new()
	add_child(ui)
	ui.choice_pressed.connect(func(i): Story.choose(i))
	ui.begin_again.connect(func(): get_tree().reload_current_scene())

	Story.passage_started.connect(_on_passage)
	Story.text_shown.connect(func(t): ui.add_text(t))
	Story.choices_shown.connect(_on_choices)
	Story.walk_requested.connect(_on_walk)
	Story.video_requested.connect(_on_video)
	Story.card_requested.connect(_on_card)
	Story.fx_requested.connect(_on_fx)
	Story.sfx_requested.connect(func(p, v): music.sfx(p, v))
	Story.scene_changed.connect(_apply_scene)
	Story.ending_reached.connect(func(_id, title): _ending_title = title)
	_apply_weather("noon", true)
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--views="):
			_render_views(a.substr(8))
			return
	Story.start.call_deferred()


# ================================================================== the story, directed

func _on_passage(name: String, scene: Dictionary) -> void:
	player.enabled = false
	if not autoplay:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	ui.begin_passage()
	if scene.has("at") and stations.has(scene.at):
		var st: Vector3 = stations[scene.at]
		if player.global_position.distance_to(st) > 40.0:
			ui.dip(1.5)
			_place_player(st + Vector3(0, 0.3, 6), st + Vector3(0, 1.6, -20))
	_apply_scene(scene)
	if name == "Go Home, Johann":
		_walked_out = true
	print("[story] ", name)


func _apply_scene(scene: Dictionary) -> void:
	if scene.has("music"):
		music.set_bed(scene.music)
	if scene.has("atmosphere"):
		_apply_weather(scene.atmosphere)
	if scene.has("look"):
		look = scene.look


func _on_choices(labels: Array) -> void:
	ui.show_choices(labels)
	if autoplay:
		if _shots_dir != "":
			await get_tree().create_timer(2.5).timeout
			await _shot("p_" + Story.passage.to_lower().replace(" ", "_").replace(",", "").replace("'", ""))
		else:
			await get_tree().create_timer(0.05).timeout
		# the bot chooses at random (seeded with --seed=N), so different runs take different paths
		Story.choose(rng.randi_range(0, labels.size() - 1))


func _on_walk() -> void:
	if Story.ended != "":
		var found: Array = Story.endings_found()
		ui.hide_passage()
		ui.show_end(_ending_title, found.size(), Story.data.endings.size())
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		print("[story] ENDING: ", _ending_title, " (dread %d, cold %d, defiance %d)" % [Story.meter("dread"), Story.meter("cold"), Story.meter("defiance")])
		if autoplay:
			await get_tree().create_timer(0.5).timeout
			_shot("ending")
			get_tree().quit(0)
		return
	ui.hide_passage()
	player.enabled = true
	if not autoplay:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	# a turn may have broken in while you stood in a station: let that station happen now
	_check_stations.call_deferred()
	if autoplay:
		_auto_walk()


func _check_stations() -> void:
	if not player.enabled:
		return
	for name in station_areas:
		if not station_done.has(name) and (station_areas[name] as Area3D).overlaps_body(player):
			_on_station(player, name)
			return


func _on_video(path: String, skippable: bool) -> void:
	if autoplay:
		Story.video_done.emit.call_deferred()
		return
	ui.play_video(path, skippable)


func _on_card(title: String, kicker: String, sub: String) -> void:
	if autoplay:
		Story.card_done.emit.call_deferred()
		return
	ui.show_card(title, kicker, sub)


func _on_fx(kind: String, seconds: float) -> void:
	ui.fx(kind, seconds)
	if kind == "flash":
		_lightning()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseButton and event.pressed and player.enabled:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _on_station(body: Node, name: String) -> void:
	if body != player or not player.enabled or station_done.has(name):
		return
	if not STATION_TARGETS.has(name):
		return
	station_done[name] = true
	print("[walk] reached ", name)
	# the evening deepens as you go down into the valley (unless the storm has come)
	if name in ["wayside_3", "wayside_4"] and weather in ["noon", "afternoon", "evening"]:
		_apply_weather("dusk")
	Story.go(STATION_TARGETS[name])


# ================================================================== feelings → world, every frame

func _process(delta: float) -> void:
	# cold creeps in once you are walking alone; faster when you stand still, and in the storm
	if player and player.enabled and _walked_out:
		var rate := 0.18
		if WEATHER[weather].get("snow", 0.0) > 0.5 or weather == "hail":
			rate = 0.4
		if not player.moving():
			rate *= 1.6
		# the walk alone brings you to the edge of the cold; only choices take you past it
		if Story.meter("cold") < 70.0:
			_cold_acc += rate * delta
		if weather in ["storm", "hail", "moon"] and Story.meter("dread") < 60.0:
			Story.nudge({"dread": 0.08 * delta})
	_tick += delta
	if _tick >= 0.5:
		_tick = 0.0
		if _cold_acc > 0.0:
			Story.nudge({"cold": _cold_acc})
			_cold_acc = 0.0
		music.mix(Story.meter("dread"), Story.meter("cold"), Story.meter("defiance"))
		if player.enabled:
			Story.check_turns()
	_feel(delta)
	if snow:
		snow.global_position = player.global_position + Vector3(0, 12, 0)
		hail.global_position = player.global_position + Vector3(0, 12, 0)
	if lightning_every > 0.0:
		_lightning_t -= delta
		if _lightning_t <= 0.0:
			_lightning_t = rng.randf_range(lightning_every * 0.5, lightning_every * 1.5)
			_lightning()
			get_tree().create_timer(rng.randf_range(0.6, 2.0)).timeout.connect(func(): music.sfx("res://assets/music/sfx_thunder.ogg", 0.8))


## Colour, fog and snow follow the weather, the look and the feelings.
func _feel(delta: float) -> void:
	var w: Dictionary = WEATHER[weather]
	var l: Dictionary = LOOKS.get(look, LOOKS.warm)
	var dread := Story.meter("dread") / 100.0
	var cold := Story.meter("cold") / 100.0
	var k := clampf(delta * 0.8, 0.0, 1.0)
	env.adjustment_saturation = lerpf(env.adjustment_saturation, l.saturation * (1.0 - 0.45 * dread) * (1.0 - 0.3 * cold), k)
	env.adjustment_brightness = lerpf(env.adjustment_brightness, l.brightness * (1.0 - 0.15 * dread), k)
	env.adjustment_contrast = lerpf(env.adjustment_contrast, l.contrast * (1.0 + 0.15 * dread), k)
	env.fog_density = lerpf(env.fog_density, w.fog * (1.0 + 1.2 * dread), k)
	env.fog_light_color = env.fog_light_color.lerp(w.fog_color.lerp(Color(0.6, 0.68, 0.8), cold * 0.3), k)
	ground_snow = lerpf(ground_snow, maxf(ground_snow, w.get("ground_snow", 0.0)), delta * 0.08)
	terrain_mat.set_shader_parameter("snow_amount", ground_snow)
	snow.amount_ratio = lerpf(snow.amount_ratio, w.get("snow", 0.0), k)
	hail.amount_ratio = lerpf(hail.amount_ratio, w.get("hail", 0.0), k)
	player.snow_slow = ground_snow


func _apply_weather(name: String, instant := false) -> void:
	if not WEATHER.has(name):
		return
	weather = name
	var w: Dictionary = WEATHER[name]
	var sky_path: String = SKY + w.sky + ".hdr"
	if ResourceLoader.exists(sky_path):
		var mat := PanoramaSkyMaterial.new()
		mat.panorama = load(sky_path)
		mat.energy_multiplier = w.sky_energy
		env.sky.sky_material = mat
	var tw := create_tween().set_parallel(true)
	var t := 0.01 if instant else 4.0
	tw.tween_property(sun, "light_energy", w.sun, t)
	tw.tween_property(sun, "rotation_degrees:x", w.sun_angle, t)
	tw.tween_property(env, "background_energy_multiplier", w.sky_energy, t)
	sun.light_color = Color(0.7, 0.78, 1.0) if w.get("moonlight", false) else Color(1.0, 0.95, 0.88)
	lightning_every = w.get("lightning", 0.0)


func _lightning() -> void:
	var e := sun.light_energy
	sun.light_energy = 3.0
	env.background_energy_multiplier = 2.0
	var tw := create_tween()
	tw.tween_property(sun, "light_energy", e, 0.35)
	tw.parallel().tween_property(env, "background_energy_multiplier", WEATHER[weather].sky_energy, 0.5)


# ================================================================== building the world

func _build_environment() -> void:
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = Sky.new()
	env.sky.sky_material = PanoramaSkyMaterial.new()
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.8
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.fog_enabled = true
	env.fog_density = 0.002
	env.fog_sky_affect = 0.6
	env.glow_enabled = true
	env.glow_intensity = 0.4
	env.adjustment_enabled = true
	env.ssao_enabled = true
	world_env = WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -30, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 120.0
	add_child(sun)


# ---- terrain: a road down from the plateau into a valley, hills on either side

func _road_info(p: Vector2) -> Vector2:
	# returns (distance to the road, road height at the nearest point)
	var best := INF
	var h := 0.0
	for i in ROUTE.size() - 1:
		var a: Vector2 = ROUTE[i][1]
		var b: Vector2 = ROUTE[i + 1][1]
		var ab := b - a
		var t := clampf((p - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
		var d := p.distance_to(a + ab * t)
		if d < best:
			best = d
			h = lerpf(ROUTE[i][2], ROUTE[i + 1][2], t)
	# the plateau road on to the courtyard
	var a2: Vector2 = ROUTE[0][1]
	var ab2 := COURTYARD - a2
	var t2 := clampf((p - a2).dot(ab2) / ab2.length_squared(), 0.0, 1.0)
	var d2 := p.distance_to(a2 + ab2 * t2)
	if d2 < best:
		best = d2
		h = PLATEAU
	return Vector2(best, h)


func height_at(x: float, z: float) -> float:
	var p := Vector2(x, z)
	var info := _road_info(p)
	var d := info.x
	# up on the plateau (north) the land is open and wind-swept; going south the road drops into
	# a winding valley between wooded hills, which close in around the village and the churchyard
	var valley := smoothstep(160.0, 60.0, z)
	var floor_w := lerpf(40.0, 14.0, valley)
	var side := pow(maxf(d - floor_w, 0.0) / 50.0, 1.5) * lerpf(4.0, 22.0, valley)
	var hills := noise.get_noise_2d(x, z) * lerpf(3.0, 9.0, valley) * smoothstep(4.0, 24.0, d)
	var swell := noise.get_noise_2d(x * 0.25 + 400.0, z * 0.25) * 10.0 * smoothstep(20.0, 60.0, d)
	var h := info.y + minf(side, 60.0) + hills + swell
	# flat places: the courtyard, the village green, the churchyard
	for flat in [[COURTYARD, 30.0, PLATEAU], [ROUTE[8][1], 28.0, ROUTE[8][2]], [ROUTE[11][1], 32.0, ROUTE[11][2]]]:
		var f := 1.0 - smoothstep(flat[1] * 0.6, flat[1], p.distance_to(flat[0]))
		h = lerpf(h, flat[2], f)
	return h


func _build_terrain() -> void:
	var x0 := -160.0
	var x1 := 160.0
	var z0 := -300.0
	var z1 := 370.0
	var step := 3.0
	var nx := int((x1 - x0) / step) + 1
	var nz := int((z1 - z0) / step) + 1
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for j in nz:
		for i in nx:
			var x := x0 + i * step
			var z := z0 + j * step
			var d := _road_info(Vector2(x, z)).x
			st.set_color(Color(1.0 - smoothstep(2.5, 4.5, d), 0, 0))
			st.set_uv(Vector2(x, z) * 0.1)
			st.add_vertex(Vector3(x, height_at(x, z), z))
	for j in nz - 1:
		for i in nx - 1:
			var a := j * nx + i
			st.add_index(a)
			st.add_index(a + 1)
			st.add_index(a + nx)
			st.add_index(a + 1)
			st.add_index(a + nx + 1)
			st.add_index(a + nx)
	st.generate_normals()
	st.generate_tangents()
	var arrays := st.commit_to_arrays()
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	terrain_mat = ShaderMaterial.new()
	terrain_mat.shader = load("res://scripts/terrain.gdshader")
	for pair in [["ground_tex", "forest_leaves_02", "diff"], ["ground_nor", "forest_leaves_02", "nor"], ["road_tex", "stony_dirt_path", "diff"], ["road_nor", "stony_dirt_path", "nor"], ["rock_tex", "rock_wall_08", "diff"], ["snow_tex", "snow_02", "diff"], ["snow_nor", "snow_02", "nor"]]:
		var tex := _tex(pair[1], pair[2])
		if tex:
			terrain_mat.set_shader_parameter(pair[0], tex)
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = terrain_mat
	add_child(mi)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	# collision straight from the vertex data (does not depend on the renderer)
	var verts: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	var faces := PackedVector3Array()
	faces.resize(idx.size())
	for k in idx.size():
		faces[k] = verts[idx[k]]
	var shape := ConcavePolygonShape3D.new()
	shape.set_faces(faces)
	cs.shape = shape
	body.add_child(cs)
	add_child(body)


# ---- materials and models

func _tex(id: String, kind: String) -> Texture2D:
	var path := "%s%s/%s_%s.jpg" % [TEX, id, id, kind]
	return load(path) if ResourceLoader.exists(path) else null


func _mat(id: String, tile := 0.5) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = _tex(id, "diff")
	var n := _tex(id, "nor")
	if n:
		m.normal_enabled = true
		m.normal_texture = n
	var arm := _tex(id, "arm")
	if arm:
		m.roughness_texture = arm
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
		m.ao_enabled = true
		m.ao_texture = arm
		m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
	else:
		m.roughness = 0.9
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3.ONE * tile
	return m


func _box(size: Vector3, pos: Vector3, mat: Material, rot_y := 0.0, collide := true, parent: Node = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.rotation.y = rot_y
	(parent if parent else self).add_child(mi)
	if collide:
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		body.add_child(cs)
		mi.add_child(body)
	return mi


func _scan(id: String) -> Node3D:
	var path := "%s%s/%s.gltf" % [SCANS, id, id]
	if not ResourceLoader.exists(path):
		return null
	var scene: PackedScene = load(path)
	return scene.instantiate()


func _place(id: String, pos: Vector3, scale := 1.0, rot := 0.0, tilt := 0.0) -> Node3D:
	var n := _scan(id)
	if n == null:
		return null
	n.position = pos
	n.rotation = Vector3(tilt, rot, 0)
	n.scale = Vector3.ONE * scale
	add_child(n)
	return n


func _fit_height(n: Node3D, h: float) -> void:
	var aabb := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var bb: AABB = (mi as MeshInstance3D).get_aabb()
		bb = (mi as MeshInstance3D).transform * bb
		aabb = bb if first else aabb.merge(bb)
		first = false
	if not first and aabb.size.y > 0.01:
		n.scale = Vector3.ONE * (h / aabb.size.y)


func _ground(x: float, z: float) -> Vector3:
	return Vector3(x, height_at(x, z), z)


# ---- places

func _build_courtyard() -> void:
	var c := COURTYARD
	var cobble := _mat("cobblestone_floor_01", 0.35)
	_box(Vector3(36, 0.4, 36), Vector3(c.x, PLATEAU - 0.15, c.y), cobble)
	var plaster := _mat("worn_mossy_plasterwall", 0.3)
	var roof := _mat("roof_slates_02", 0.4)
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.05, 0.05, 0.06)
	# the Quatre Saisons: a long facade with windows, and a wing
	_box(Vector3(30, 12, 6), Vector3(c.x, PLATEAU + 6, c.y - 18), plaster)
	_box(Vector3(31, 0.6, 7.5), Vector3(c.x, PLATEAU + 12.3, c.y - 18), roof)
	for i in 6:
		for row in 2:
			_box(Vector3(1.6, 2.4, 0.2), Vector3(c.x - 12.5 + i * 5, PLATEAU + 4 + row * 4.5, c.y - 14.95), dark, 0.0, false)
	_box(Vector3(3, 3.6, 0.3), Vector3(c.x, PLATEAU + 1.8, c.y - 14.9), dark, 0.0, false)
	_box(Vector3(6, 10, 22), Vector3(c.x - 17, PLATEAU + 5, c.y - 4), plaster)
	# the carriage
	var planks := _mat("weathered_planks", 0.6)
	_box(Vector3(1.8, 1.6, 3.2), Vector3(c.x + 6, PLATEAU + 1.4, c.y - 2), planks, 0.0)
	for wx in [-1.0, 1.0]:
		for wz in [-1.1, 1.1]:
			var wheel := MeshInstance3D.new()
			var cyl := CylinderMesh.new()
			cyl.top_radius = 0.55
			cyl.bottom_radius = 0.55
			cyl.height = 0.08
			wheel.mesh = cyl
			wheel.material_override = planks
			wheel.position = Vector3(c.x + 6 + wx * 0.95, PLATEAU + 0.55, c.y - 2 + wz)
			wheel.rotation.z = PI / 2
			add_child(wheel)
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(c.x, PLATEAU + 4, c.y - 13)
	lamp.light_color = Color(1, 0.8, 0.55)
	lamp.light_energy = 0.6
	lamp.omni_range = 10
	add_child(lamp)


func _build_crossroads() -> void:
	var p: Vector2 = ROUTE[0][1]
	var planks := _mat("weathered_planks", 0.8)
	# the suicide's grave at the cross roads, marked with a cross
	var g := _ground(p.x + 5, p.y + 1)
	_box(Vector3(0.18, 2.4, 0.18), g + Vector3(0, 1.2, 0), planks, 0.3)
	_box(Vector3(1.1, 0.16, 0.16), g + Vector3(0, 1.75, 0), planks, 0.3)
	_place("stone_01", g + Vector3(0.6, 0, 0.4), 2.0, 1.0)
	_place("dry_branches_medium_01", _ground(p.x - 4, p.y - 6), 1.0, 0.7)


func _scatter(id: String, count: int, dmin: float, dmax: float, smin: float, smax: float, zmin := -300.0, zmax := 260.0, sink := 0.0) -> void:
	if not ResourceLoader.exists("%s%s/%s.gltf" % [SCANS, id, id]):
		return
	var placed := 0
	var tries := 0
	while placed < count and tries < count * 40:
		tries += 1
		var x := rng.randf_range(-150, 150)
		var z := rng.randf_range(zmin, zmax)
		var d := _road_info(Vector2(x, z)).x
		if d < dmin or d > dmax:
			continue
		# keep the churchyard and the village green clear
		if Vector2(x, z).distance_to(ROUTE[11][1]) < 26.0 or Vector2(x, z).distance_to(COURTYARD) < 30.0:
			continue
		_place(id, _ground(x, z) - Vector3(0, sink, 0), rng.randf_range(smin, smax), rng.randf_range(0, TAU))
		placed += 1


func _scatter_nature() -> void:
	_scatter("rock_moss_set_01", 14, 5, 40, 1.0, 2.2, -260, 220, 0.2)
	_scatter("rock_moss_set_02", 14, 5, 40, 1.0, 2.2, -260, 220, 0.2)
	_scatter("boulder_01", 10, 9, 70, 1.2, 2.6, -260, 230, 0.6)
	_scatter("rock_07", 8, 8, 60, 1.5, 3.0, -260, 230, 0.4)
	_scatter("rock_09", 8, 8, 60, 1.5, 3.0, -260, 230, 0.4)
	_scatter("stone_01", 18, 4, 25, 1.0, 3.0, -260, 230)
	_scatter("tree_stump_01", 8, 6, 35, 1.0, 1.4, -200, 120)
	_scatter("tree_stump_02", 8, 6, 35, 1.0, 1.4, -200, 120)
	_scatter("dead_tree_trunk", 7, 6, 40, 1.0, 1.3, -230, 160)
	_scatter("dead_tree_trunk_02", 7, 6, 40, 1.0, 1.3, -230, 160)
	_scatter("root_cluster_02", 5, 7, 30, 1.0, 1.5, -200, 60)
	_scatter("pine_roots", 5, 7, 30, 1.0, 1.4, -200, 60)
	_scatter("dry_branches_medium_01", 20, 3, 18, 0.8, 1.3, -260, 220)
	_scatter("fern_02", 20, 4, 20, 1.0, 1.6, -200, 120)
	_scatter("moss_01", 8, 4, 16, 1.0, 1.5, -200, 120)
	# firs on the slopes: the "scattered fringe of wood" and the clumps on the hills
	_scatter("fir_sapling", 40, 12, 90, 3.0, 5.5, -280, 160)


func _build_village() -> void:
	var c: Vector2 = ROUTE[8][1]
	var plaster := _mat("worn_mossy_plasterwall", 0.35)
	var roof := _mat("roof_slates_02", 0.4)
	var spots := [Vector2(-16, 8), Vector2(14, 10), Vector2(-14, -12), Vector2(16, -14), Vector2(0, 22), Vector2(-26, -2), Vector2(26, 0)]
	for i in spots.size():
		var s: Vector2 = c + spots[i]
		var w := rng.randf_range(5, 8)
		var d := rng.randf_range(5, 7)
		var rot := rng.randf_range(-0.3, 0.3) + (PI / 2 if i % 2 == 0 else 0.0)
		var base := _ground(s.x, s.y)
		var holder := Node3D.new()
		holder.position = base
		holder.rotation.y = rot
		add_child(holder)
		# four broken walls, a doorway with no door; the snow lies inside as it lies outside
		for wall in [[Vector3(0, 0, -d / 2), w, 0.0], [Vector3(0, 0, d / 2), w, 0.0], [Vector3(-w / 2, 0, 0), d, PI / 2], [Vector3(w / 2, 0, 0), d, PI / 2]]:
			var h := rng.randf_range(1.2, 4.2)
			var len: float = wall[1]
			var at: Vector3 = wall[0]
			if at.z > 0.0:
				# the doorway
				for part in [-1.0, 1.0]:
					var seg := (len - 1.4) / 2.0
					_box(Vector3(seg, h, 0.45), Vector3(part * (0.7 + seg / 2.0), h / 2.0, at.z), plaster, 0.0, true, holder)
			else:
				_box(Vector3(len, h, 0.45), at + Vector3(0, h / 2.0, 0), plaster, wall[2], true, holder)
		if i % 3 == 0:
			var r := _box(Vector3(w + 0.6, 0.25, d * 0.6), Vector3(0, 3.6, -d * 0.2), roof, 0.0, true, holder)
			r.rotation.x = 0.35
		_place("nettle_plant", base + Vector3(rng.randf_range(-1, 1), 0, rng.randf_range(-1, 1)), rng.randf_range(1.0, 1.6), rng.randf())


func _build_cemetery() -> void:
	var c: Vector2 = ROUTE[11][1]
	var gate: Vector2 = ROUTE[10][1]
	var center := _ground(c.x, c.y)
	var wall := _mat("mossy_stone_wall", 0.4)
	var marble := _mat("marble_01", 0.35)
	var blocks := _mat("medieval_blocks_02", 0.35)
	# a low wall round the copse, open towards the road
	var to_gate := (gate - c).angle()
	var r := 24.0
	for k in 40:
		var a := TAU * k / 40.0
		if absf(wrapf(a - to_gate, -PI, PI)) < 0.2:
			continue
		var p := c + Vector2(cos(a), sin(a)) * r
		var g := _ground(p.x, p.y)
		_box(Vector3(4.0, 1.2, 0.6), g + Vector3(0, 0.5, 0), wall, -a + PI / 2)
	# gravestones, leaning
	for k in 22:
		var a := rng.randf_range(0, TAU)
		var rr := rng.randf_range(8, 20)
		var p := c + Vector2(cos(a), sin(a)) * rr
		if absf(wrapf(a - to_gate, -PI, PI)) < 0.35:
			continue
		var stone := _box(Vector3(0.7, rng.randf_range(0.8, 1.4), 0.15), _ground(p.x, p.y) + Vector3(0, 0.5, 0), marble, rng.randf_range(0, TAU))
		stone.rotation.x = rng.randf_range(-0.15, 0.15)
	# the cypress alley from the gap in the wall to the tomb (firs, drawn tall and narrow)
	for k in 7:
		var t := float(k) / 6.0
		var p := gate.lerp(c, 0.25 + t * 0.6)
		var side := (c - gate).orthogonal().normalized() * 3.5
		for s in [-1.0, 1.0]:
			var q: Vector2 = p + side * s
			var tree := _place("fir_sapling", _ground(q.x, q.y), 1.0, rng.randf_range(0, TAU))
			if tree:
				tree.scale = Vector3(2.0, 5.5, 2.0)
	# the tomb: a few vast blocks of white marble on a stone plinth
	var face := (gate - c).normalized()
	var yaw := atan2(face.x, face.y)
	var tomb := Node3D.new()
	tomb.position = center
	tomb.rotation.y = yaw
	add_child(tomb)
	for part in [[Vector3(7.5, 0.8, 9.5), Vector3(0, 0.4, 0), blocks], [Vector3(5.5, 4.2, 7.5), Vector3(0, 2.9, 0), marble], [Vector3(6.1, 0.6, 8.1), Vector3(0, 5.3, 0), marble]]:
		_box(part[0], part[1], part[2], 0.0, true, tomb)
	# the deep Doric doorway and its bronze door
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.01, 0.01, 0.01)
	_box(Vector3(2.2, 3.0, 0.8), Vector3(0, 2.3, 3.5), dark, 0.0, false, tomb)
	var bronze := StandardMaterial3D.new()
	bronze.albedo_color = Color(0.22, 0.17, 0.1)
	bronze.metallic = 0.8
	bronze.roughness = 0.45
	_box(Vector3(1.9, 2.8, 0.12), Vector3(0, 2.2, 3.35), bronze, 0.0, true, tomb)
	# the great iron stake driven through the marble
	var iron := StandardMaterial3D.new()
	iron.albedo_color = Color(0.08, 0.07, 0.07)
	iron.metallic = 0.6
	iron.roughness = 0.7
	var stake := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.03
	cyl.bottom_radius = 0.14
	cyl.height = 3.2
	stake.mesh = cyl
	stake.material_override = iron
	stake.position = Vector3(0, 7.1, 0)
	tomb.add_child(stake)
	# the inscriptions
	var front := Label3D.new()
	front.text = "COUNTESS DOLINGEN OF GRATZ\nIN STYRIA\nSOUGHT AND FOUND DEATH\n1801"
	front.font_size = 64
	front.pixel_size = 0.0035
	front.modulate = Color(0.25, 0.22, 0.2)
	front.position = Vector3(0, 4.35, 3.77)
	front.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tomb.add_child(front)
	var back := Label3D.new()
	back.text = "МЁРТВЫЕ ЕЗДЯТ БЫСТРО"
	back.font_size = 72
	back.pixel_size = 0.004
	back.modulate = Color(0.25, 0.22, 0.2)
	back.position = Vector3(0, 3.0, -3.77)
	back.rotation.y = PI
	tomb.add_child(back)
	# a weathered, veiled statue keeps watch beside the door
	var statue := _scan("gothic_statue")
	if statue:
		tomb.add_child(statue)
		_fit_height(statue, 2.2)
		statue.position = Vector3(3.6, 0.8, 4.2)
		statue.rotation.y = PI * 0.1


func _build_stations() -> void:
	for r in ROUTE:
		if r[0] == "":
			continue
		var p: Vector2 = r[1]
		stations[r[0]] = _ground(p.x, p.y)
	stations["courtyard"] = Vector3(COURTYARD.x, PLATEAU, COURTYARD.y + 8)
	for name in STATION_TARGETS:
		var area := Area3D.new()
		var cs := CollisionShape3D.new()
		var sph := SphereShape3D.new()
		sph.radius = 9.0 if name != "tomb" else 7.0
		cs.shape = sph
		area.add_child(cs)
		area.position = stations[name] + Vector3(0, 1, 0)
		area.body_entered.connect(_on_station.bind(name))
		add_child(area)
		station_areas[name] = area


func _build_weather_particles() -> void:
	snow = _particles(4000, Color(1, 1, 1, 0.9), 0.06, Vector3(0, -2.2, 0), 0.8)
	hail = _particles(2500, Color(0.85, 0.88, 0.92, 0.9), 0.035, Vector3(0, -22, 0), 0.6)


func _particles(amount: int, color: Color, size: float, gravity: Vector3, life: float) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = 6.0 * life if gravity.y > -10 else 1.2
	p.amount_ratio = 0.0
	p.visibility_aabb = AABB(Vector3(-30, -20, -30), Vector3(60, 40, 60))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(25, 2, 25)
	pm.gravity = gravity
	pm.direction = Vector3(0.3, -1, 0.1)
	pm.initial_velocity_min = 0.5
	pm.initial_velocity_max = 2.0
	pm.turbulence_enabled = gravity.y > -10
	pm.turbulence_noise_strength = 2.0
	p.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = color
	q.material = m
	p.draw_pass_1 = q
	add_child(p)
	return p


func _place_player(at: Vector3, look_at_point: Vector3) -> void:
	player.global_position = at
	player.velocity = Vector3.ZERO
	player.face(look_at_point)


# ================================================================== test mode: the game plays itself

func _auto_walk() -> void:
	# walk the route station by station (teleporting), so the whole story is exercised headless
	await get_tree().create_timer(0.3).timeout
	if Story.running or not player.enabled:
		return
	var order := ["wayside_1", "wayside_2", "wayside_3", "wayside_4", "village", "gate", "tomb"]
	for name in order:
		if not station_done.has(name):
			if _shots_dir != "":
				# stop short of the station, look at it, and take a picture of the world
				var to: Vector3 = stations[name]
				player.global_position = to + (player.global_position - to).normalized() * 14.0 + Vector3(0, 2.0, 0)
				player.face(to + Vector3(0, 1.5, 0))
				await get_tree().create_timer(2.5).timeout
				await _shot("w_" + name)
			player.global_position = stations[name] + Vector3(0, 0.5, 0)
			# let some cold accumulate on the way
			Story.nudge({"cold": 4.0})
			return
	push_error("autoplay: walked the whole route without reaching an ending")
	get_tree().quit(1)


## --views=<folder>: one still of each place in its weather (no story), then quit.
func _render_views(dir: String) -> void:
	_shots_dir = dir
	ui.hint.visible = false
	var views := [
		["courtyard", "noon", Vector3(COURTYARD.x + 6, PLATEAU + 1.7, COURTYARD.y + 14), Vector3(COURTYARD.x - 3, PLATEAU + 5, COURTYARD.y - 18), 0.0, 0.0],
		["crossroads", "afternoon", stations.crossroads + Vector3(-6, 1.7, 10), stations.wayside_1, 0.0, 0.0],
		["valley", "evening", stations.wayside_2 + Vector3(4, 2.5, 18), stations.wayside_3, 0.0, 0.0],
		["snow", "snow", stations.wayside_4 + Vector3(0, 1.8, 14), stations.village, 0.6, 0.6],
		["village", "dusk", stations.village + Vector3(10, 2.0, 22), stations.village, 0.3, 0.3],
		["cypresses", "storm", stations.gate + Vector3(-4, 1.8, 10), stations.tomb + Vector3(0, 3, 0), 1.0, 0.7],
		["tomb", "moon", stations.tomb + Vector3(7, 1.7, 13), stations.tomb + Vector3(0, 3, 0), 1.0, 0.6],
		["dawn", "dawn", stations.tomb + Vector3(-10, 2.0, 16), stations.tomb + Vector3(0, 2, 0), 0.2, 0.9],
	]
	var only: Array = []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.substr(7).split(",")
	for v in views:
		if not only.is_empty() and not only.has(v[0]):
			continue
		_apply_weather(v[1], true)
		ground_snow = v[5]
		Story.S["dread"] = v[4] * 60.0
		Story.S["cold"] = v[5] * 60.0
		player.global_position = v[2]
		player.face(v[3])
		player.set_physics_process(false)
		for i in 40:
			_feel(0.25)
			await get_tree().process_frame
		await _shot("view_" + v[0])
		print("[view] ", v[0])
	get_tree().quit(0)


func _shot(name: String) -> void:
	if _shots_dir == "":
		return
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img:
		img.save_png("%s/%s.png" % [_shots_dir, name])
