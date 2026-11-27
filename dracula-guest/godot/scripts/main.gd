extends Node3D
## Dracula's Guest — builds the world from the downloaded scans and directs it from the story.
## The story (autoload Story, compiled from story/draculas-guest.twee) decides what happens;
## this script turns its tags and feelings into place, weather, light and sound, and frames
## every passage as a composed shot (data/shots.json) graded with the look developed from
## the material itself (data/look.json, written by tools/develop-look.mjs).

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
## the road north, back towards Munich
const NORTH := Vector2(0, 318)
const PLATEAU := 26.0
## Munich is not on the map: it is a small lit table in the dark, a still life far above the valley.
const MUNICH := Vector3(0, 400, 900)

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

var player: CharacterBody3D
var ui: Node
var music: Node
var env: Environment
var stage_env: Environment
var world_env: WorldEnvironment
var sun: DirectionalLight3D
var terrain_mat: ShaderMaterial
var snow: GPUParticles3D
var hail: GPUParticles3D
var stations := {}
var station_areas := {}
var station_done := {}
var weather := "noon"

# the developed look
var look_data := {}
var looks := {}
var look := ""
var _mood := {"brightness": 1.0, "contrast": 1.0, "saturation": 1.0, "sepia": 0.0, "tint": Vector3(0.5, 0.5, 0.5)}
var _look_from_tag := false

# the director
var shots := {}
var anchors := {}             # name -> Transform3D
var show_nodes := {}          # name -> Node3D, visible only in the shots that ask for them
var shot_cam: Camera3D
var _shot_tween: Tween
var letterbox := 0.0
var door_left: Node3D
var door_right: Node3D
var _door_open := false

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
var _piece_cache := {}


func _ready() -> void:
	rng.seed = 1914
	noise.seed = 1914
	noise.frequency = 0.012
	autoplay = OS.get_cmdline_user_args().has("--autoplay")
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			_shots_dir = a.substr(8)
	look_data = _json("res://data/look.json")
	looks = look_data.get("looks", {})
	shots = _json("res://data/shots.json").get("shots", {})
	_build_environment()
	_build_terrain()
	_build_munich()
	_build_crossroads()
	_scatter_nature()
	_build_village()
	_build_cemetery()
	_build_stations()
	_build_weather_particles()
	for kit in _piece_cache.values():
		if kit:
			kit.free()
	_piece_cache.clear()
	# world built with a fixed seed; the test bot's choices use --seed=N
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--seed="):
			rng.seed = int(a.substr(7))
			seed(int(a.substr(7)))

	player = Player.new()
	add_child(player)
	_place_player(stations.crossroads + Vector3(0, 0.3, 4), stations.wayside_1 + Vector3(0, 1.6, 0))
	shot_cam = Camera3D.new()
	shot_cam.far = 900
	add_child(shot_cam)
	music = Music.new()
	add_child(music)
	ui = UI.new()
	add_child(ui)
	ui.apply_grade(look_data)
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


func _json(path: String) -> Dictionary:
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {}
	var v = JSON.parse_string(f.get_as_text())
	return v if v is Dictionary else {}


# ================================================================== the story, directed

func _on_passage(name: String, scene: Dictionary) -> void:
	player.enabled = false
	if not autoplay:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if scene.has("at") and stations.has(scene.at):
		var st: Vector3 = stations[scene.at]
		if player.global_position.distance_to(st) > 40.0:
			_place_player(st + Vector3(0, 0.3, 6), st + Vector3(0, 1.6, -20))
	_look_from_tag = false
	_apply_scene(scene)
	var shot := _shot_for(name, scene)
	ui.begin_passage(shot.get("side", "left"))
	_frame(shot)
	if name == "Go Home, Johann":
		_walked_out = true
	print("[story] ", name)


func _apply_scene(scene: Dictionary) -> void:
	if scene.has("music"):
		music.set_bed(scene.music)
	if scene.has("look") and looks.has(scene.look):
		look = scene.look
		_look_from_tag = true
	if scene.has("atmosphere"):
		_apply_weather(scene.atmosphere)


func _on_choices(labels: Array) -> void:
	ui.show_choices(labels)
	if autoplay:
		if _shots_dir != "":
			await get_tree().create_timer(4.0).timeout
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
	_release_shot()
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


# ================================================================== the director: composed shots

func _shot_for(name: String, scene: Dictionary) -> Dictionary:
	var key := name
	if shots.has(name) and shots[name].has("use"):
		key = shots[name].use
	elif not shots.has(name):
		key = "wayside" if scene.get("at", "") == "wayside" or scene.has("drift") else "here_low"
	var s: Dictionary = shots.get(key, {"side": "left", "fov": 40}).duplicate()
	if not s.has("anchor"):
		s.merge(_shot_here(key), true)
	return s


## Shots without a fixed place are framed around wherever the walker stands.
func _shot_here(kind: String) -> Dictionary:
	var fwd := -player.global_basis.z
	fwd.y = 0
	fwd = fwd.normalized()
	var right := fwd.cross(Vector3.UP)
	anchors["_here"] = Transform3D(Basis.IDENTITY, player.global_position)
	match kind:
		"here_sky":
			# looking up into the weather, the road a dark line at the foot of the frame
			return {"anchor": "_here", "pos": [0, 1.5, 0], "look": [fwd.x * 20, 14, fwd.z * 20], "move": [0, 0.2, 0]}
		"here_low":
			# down at the snow, looking back up the road you came by
			return {"anchor": "_here", "pos": [right.x * 0.6, 0.35, right.z * 0.6], "look": [-fwd.x * 30, 2.5, -fwd.z * 30], "move": [fwd.x * -0.4, 0, fwd.z * -0.4]}
	# by the roadside: a little apart from the walker, looking on down the road
	return {"anchor": "_here", "pos": [right.x * 1.6 - fwd.x, 1.25, right.z * 1.6 - fwd.z], "look": [fwd.x * 40, 1.0, fwd.z * 40], "move": [fwd.x * 1.6, 0, fwd.z * 1.6]}


## Cut (through black) to the passage's shot and let the camera drift.
func _frame(s: Dictionary) -> void:
	var anchor_name: String = s.get("anchor", "_here")
	if not anchors.has(anchor_name):
		return
	var a: Transform3D = anchors[anchor_name]
	var pos: Vector3 = a * _v(s.get("pos", [0, 1.6, 4]))
	var look_t: Transform3D = anchors.get(s.get("look_anchor", anchor_name), a)
	var target: Vector3 = look_t * _v(s.get("look", [0, 1.5, 0]))
	var stage := anchor_name == "munich"
	if not stage:
		pos.y = maxf(pos.y, height_at(pos.x, pos.z) + 0.2)
	var move: Vector3 = a.basis * _v(s.get("move", [0, 0, 0]))
	ui.dip(1.4 if shot_cam.current else 1.8)
	shot_cam.environment = stage_env if stage else null
	shot_cam.far = 40.0 if stage else 900.0
	shot_cam.near = 0.02 if stage else 0.05
	shot_cam.fov = float(s.get("fov", 40))
	shot_cam.global_position = pos
	shot_cam.look_at(target, Vector3.UP)
	shot_cam.make_current()
	for k in show_nodes:
		show_nodes[k].visible = (s.get("show", []) as Array).has(k)
	if s.get("open", false):
		_open_door()
	if _shot_tween:
		_shot_tween.kill()
	_shot_tween = create_tween().set_parallel(true)
	_shot_tween.tween_property(self, "letterbox", 1.0, 0.01 if letterbox > 0.9 else 1.5)
	var end := pos + move
	if not stage:
		end.y = maxf(end.y, height_at(end.x, end.z) + 0.2)
	var drift := func(t: float) -> void:
		shot_cam.global_position = pos.lerp(end, t)
		shot_cam.look_at(target, Vector3.UP)
	_shot_tween.tween_method(drift, 0.0, 1.0, 30.0).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


func _release_shot() -> void:
	if _shot_tween:
		_shot_tween.kill()
	_shot_tween = create_tween()
	_shot_tween.tween_property(self, "letterbox", 0.0, 1.2)
	ui.dip(1.2)
	player.camera.make_current()
	for k in show_nodes:
		show_nodes[k].visible = false


func _v(a: Array) -> Vector3:
	return Vector3(float(a[0]), float(a[1]), float(a[2]))


func _open_door() -> void:
	if _door_open or door_left == null:
		return
	_door_open = true
	var tw := create_tween().set_parallel(true)
	tw.tween_property(door_left, "rotation:y", -1.25, 2.5).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tw.tween_property(door_right, "rotation:y", 1.1, 2.8).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


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
		var at := shot_cam.global_position if shot_cam.current else player.global_position
		snow.global_position = at + Vector3(0, 12, 0)
		hail.global_position = at + Vector3(0, 12, 0)
	if lightning_every > 0.0:
		_lightning_t -= delta
		if _lightning_t <= 0.0:
			_lightning_t = rng.randf_range(lightning_every * 0.5, lightning_every * 1.5)
			_lightning()
			get_tree().create_timer(rng.randf_range(0.6, 2.0)).timeout.connect(func(): music.sfx("res://assets/music/sfx_thunder.ogg", 0.8))


## Colour, fog and snow follow the weather, the developed look and the feelings.
func _feel(delta: float) -> void:
	var w: Dictionary = WEATHER[weather]
	var dread := Story.meter("dread") / 100.0
	var cold := Story.meter("cold") / 100.0
	var k := clampf(delta * 0.8, 0.0, 1.0)
	# a developed mood is a correction measured on photographs: in the world it is felt at about half strength
	var m: Dictionary = looks.get(look, {})
	var soft := func(key: String, def: float) -> float: return 1.0 + (float(m.get(key, def)) - 1.0) * 0.45
	_mood.brightness = lerpf(_mood.brightness, soft.call("brightness", 1.0), k)
	_mood.contrast = lerpf(_mood.contrast, soft.call("contrast", 1.0), k)
	_mood.saturation = lerpf(_mood.saturation, soft.call("saturation", 1.0), k)
	_mood.sepia = lerpf(_mood.sepia, float(m.get("sepia", 0.0)) * 0.6, k)
	var t: Array = m.get("tint", [0.5, 0.5, 0.5])
	var tv := Vector3(t[0], t[1], t[2])
	var lum := maxf(tv.dot(Vector3(0.2126, 0.7152, 0.0722)), 0.01)
	_mood.tint = (_mood.tint as Vector3).lerp(tv / lum * 0.5, k)
	var g: ShaderMaterial = ui.grade_mat
	g.set_shader_parameter("mood_brightness", _mood.brightness)
	g.set_shader_parameter("mood_contrast", _mood.contrast)
	g.set_shader_parameter("mood_saturation", _mood.saturation)
	g.set_shader_parameter("mood_sepia", _mood.sepia)
	g.set_shader_parameter("mood_tint", _mood.tint)
	g.set_shader_parameter("dread", dread)
	g.set_shader_parameter("cold", cold)
	g.set_shader_parameter("letterbox", letterbox)
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
	# with no look of its own, a passage takes the mood its sky was developed into
	if not _look_from_tag:
		var sky_mood: String = look_data.get("skies", {}).get(w.sky, "")
		if looks.has(sky_mood):
			look = sky_mood
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
	env.ssao_enabled = true
	world_env = WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, -30, 0)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 120.0
	add_child(sun)
	# the Munich still life is lit only by its own lamp, in the dark
	stage_env = Environment.new()
	stage_env.background_mode = Environment.BG_COLOR
	stage_env.background_color = Color(0.004, 0.004, 0.005)
	stage_env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	stage_env.ambient_light_color = Color(0.05, 0.05, 0.06)
	stage_env.ambient_light_energy = 0.4
	stage_env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	stage_env.glow_enabled = true
	stage_env.glow_intensity = 0.6
	stage_env.ssao_enabled = true


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
	# the plateau road north, the way the carriage came
	var a2: Vector2 = ROUTE[0][1]
	var ab2 := NORTH - a2
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
	# flat places: the village green, the churchyard
	for flat in [[ROUTE[8][1], 28.0, ROUTE[8][2]], [ROUTE[11][1], 32.0, ROUTE[11][2]]]:
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


## A block of scanned surface (used for the tomb's masonry, the bier and the gravestones —
## the things that really are cut blocks — never for buildings).
func _block(size: Vector3, pos: Vector3, mat: Material, rot_y := 0.0, collide := true, parent: Node = null) -> MeshInstance3D:
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


## One named piece of a scanned kit (e.g. one wall of modular_fort_01), positioned at its own origin.
func _piece(id: String, piece: String, collide := true) -> Node3D:
	if not _piece_cache.has(id):
		_piece_cache[id] = _scan(id)
	var kit: Node3D = _piece_cache[id]
	if kit == null:
		return null
	var src := kit.find_child(id + "_" + piece, true, false)
	if src == null:
		return null
	var n: Node3D = src.duplicate()
	n.transform = Transform3D.IDENTITY
	if collide and DisplayServer.get_name() != "headless" and n is MeshInstance3D and (n as MeshInstance3D).mesh:
		var shape := (n as MeshInstance3D).mesh.create_trimesh_shape()
		if shape and shape.get_faces().size() > 0:
			var body := StaticBody3D.new()
			var cs := CollisionShape3D.new()
			cs.shape = shape
			body.add_child(cs)
			n.add_child(body)
	return n


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
	var aabb := _aabb(n)
	if aabb.size.y > 0.01:
		n.scale = Vector3.ONE * (h / aabb.size.y)


func _aabb(n: Node3D) -> AABB:
	var aabb := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var bb: AABB = (mi as MeshInstance3D).get_aabb()
		var tr: Transform3D = n.global_transform.affine_inverse() * (mi as MeshInstance3D).global_transform if n.is_inside_tree() else (mi as MeshInstance3D).transform
		bb = tr * bb
		aabb = bb if first else aabb.merge(bb)
		first = false
	return aabb


func _ground(x: float, z: float) -> Vector3:
	return Vector3(x, height_at(x, z), z)


## A basis whose z axis points along dir (flattened), y up.
func _facing(dir: Vector3) -> Basis:
	var z := Vector3(dir.x, 0, dir.z).normalized()
	var x := Vector3.UP.cross(z)
	return Basis(x, Vector3.UP, z)


func _dark_mat(c: Color, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m


# ---- places

## Munich: the hotel morning as a still life — the carved horse's head (a scan) on a table, a
## lamp, the day's card; the telegram for the last scene. Black all round, as on a stage.
func _build_munich() -> void:
	var stage := Node3D.new()
	stage.position = MUNICH
	add_child(stage)
	anchors["munich"] = Transform3D(Basis.IDENTITY, MUNICH)
	var table := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(9.0, 7.0)
	table.mesh = pm
	var wood := _mat("weathered_planks", 1.0)
	wood.uv1_triplanar = false
	wood.uv1_world_triplanar = false
	wood.uv1_scale = Vector3(6.0, 4.7, 1.0)
	table.material_override = wood
	stage.add_child(table)
	var horse := _scan("horse_head")
	if horse:
		stage.add_child(horse)
		horse.rotation.y = deg_to_rad(28)
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(0.55, 0.55, 0.25)
	lamp.light_color = Color(1.0, 0.74, 0.46)
	lamp.light_energy = 2.4
	lamp.omni_range = 5.0
	lamp.omni_attenuation = 1.6
	lamp.shadow_enabled = true
	stage.add_child(lamp)
	# a cold rim from the window behind
	var rim := SpotLight3D.new()
	rim.position = Vector3(-1.2, 1.4, -1.6)
	rim.look_at_from_position(rim.position, Vector3(0, 0.15, 0))
	rim.light_color = Color(0.7, 0.8, 1.0)
	rim.light_energy = 2.5
	rim.spot_range = 5.0
	rim.spot_angle = 22.0
	rim.shadow_enabled = true
	stage.add_child(rim)
	var paper := _dark_mat(Color(0.62, 0.58, 0.5), 0.95)
	var display: Font = load("res://fonts/IMFeENsc28P.ttf")
	# the hotel's card for the day, propped against the horse
	var card := Node3D.new()
	card.position = Vector3(-0.32, 0.0, 0.18)
	card.rotation = Vector3(0, deg_to_rad(-20), 0)
	stage.add_child(card)
	var cq := MeshInstance3D.new()
	var cm := QuadMesh.new()
	cm.size = Vector2(0.18, 0.12)
	cq.mesh = cm
	cq.material_override = paper
	cq.position = Vector3(0, 0.05, 0)
	cq.rotation.x = deg_to_rad(-14)
	card.add_child(cq)
	var ct := Label3D.new()
	ct.text = "Hôtel Quatre Saisons\n\nWALPURGIS NACHT\n30 April"
	ct.font = display
	ct.font_size = 48
	ct.pixel_size = 0.00028
	ct.modulate = Color(0.14, 0.1, 0.08)
	ct.outline_size = 0
	ct.shaded = true
	ct.position = Vector3(0, 0.0, 0.002)
	cq.add_child(ct)
	show_nodes["card"] = card
	# the telegram, opened on the table
	var tel := Node3D.new()
	tel.position = Vector3(0.12, 0.002, 0.34)
	stage.add_child(tel)
	tel.rotation.x = -PI / 2
	var tq := MeshInstance3D.new()
	var tm := QuadMesh.new()
	tm.size = Vector2(0.27, 0.19)
	tq.mesh = tm
	var form := StandardMaterial3D.new()
	form.albedo_texture = _telegram_texture()
	form.roughness = 0.95
	tq.material_override = form
	tel.add_child(tq)
	show_nodes["telegram"] = tel


func _build_crossroads() -> void:
	var p: Vector2 = ROUTE[0][1]
	anchors["crossroads"] = Transform3D(Basis.IDENTITY, _ground(p.x, p.y))
	var planks := _mat("weathered_planks", 0.8)
	# the suicide's grave at the cross roads, marked with a rough cross of two weathered beams
	var g := _ground(p.x + 5, p.y + 1)
	anchors["cross"] = Transform3D(Basis.IDENTITY, g)
	var cross := Node3D.new()
	cross.position = g
	cross.rotation = Vector3(0.04, 0.3, -0.06)
	add_child(cross)
	_block(Vector3(0.16, 2.4, 0.14), Vector3(0, 1.1, 0), planks, 0.0, true, cross)
	_block(Vector3(1.05, 0.14, 0.13), Vector3(0, 1.72, 0), planks, 0.0, false, cross)
	_place("stone_01", g + Vector3(0.6, 0, 0.4), 2.0, 1.0)
	_place("stone_01", g + Vector3(-0.5, 0, -0.3), 1.4, 2.2)
	_place("dry_branches_medium_01", _ground(p.x - 4, p.y - 6), 1.0, 0.7)
	# the crest where the tall, thin stranger stands: the highest ground in sight to the west
	var best := _ground(-34, 190)
	for i in 24:
		var a := deg_to_rad(200.0 + i * 3.0)
		for r in [40.0, 50.0, 60.0]:
			var q: Vector2 = p + Vector2(cos(a), sin(a)) * r
			var c: Vector3 = _ground(q.x, q.y)
			if c.y > best.y:
				best = c
	anchors["crest"] = Transform3D(Basis.IDENTITY, best)
	var figure := _scan("gothic_statue")
	if figure:
		var holder := Node3D.new()
		holder.position = best
		holder.basis = _facing(_ground(p.x, p.y) - best)
		add_child(holder)
		holder.add_child(figure)
		_fit_height(figure, 2.35)
		figure.scale.x *= 0.8
		figure.scale.z *= 0.8
		for mi in figure.find_children("*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).material_override = _dark_mat(Color(0.015, 0.015, 0.018))
		show_nodes["figure"] = holder
		holder.visible = false


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
		if Vector2(x, z).distance_to(ROUTE[11][1]) < 26.0 or Vector2(x, z).distance_to(ROUTE[8][1]) < 22.0:
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
	_scatter("dry_branches_medium_01", 20, 3, 18, 0.8, 1.3, -260, 220)
	_scatter("fern_02", 20, 4, 20, 1.0, 1.6, -200, 120)
	_scatter("moss_01", 8, 4, 16, 1.0, 1.5, -200, 120)
	# firs on the slopes: the "scattered fringe of wood" and the clumps on the hills
	_scatter_trees()


## Full-size conifers, baked from the fir scan by tools/bake_trees.gd and stood up as three crossed
## cut-out cards: the valley's "scattered fringe of wood" and the clumps on the hills.
var _tree_mats := {}
var _tree_meshes := {}

func _tree_card(kind: String, at: Vector3, size := 1.0) -> void:
	var v := rng.randi_range(0, 2)
	var key := "%s_%d" % [kind, v]
	var path := "res://assets/trees/%s.png" % key
	if not ResourceLoader.exists(path):
		return
	if not _tree_mats.has(key):
		var tex: Texture2D = load(path)
		var m := ShaderMaterial.new()
		m.shader = load("res://scripts/tree_card.gdshader")
		m.set_shader_parameter("tex", tex)
		_tree_mats[key] = m
		# the picture is the tree's height x (height / aspect), with the foot at the bottom
		var aspect := float(tex.get_height()) / tex.get_width()
		var heights := {"spruce": [11.5, 12.6, 13.0], "cypress": [11.7, 10.3, 11.2]}
		var h: float = heights[kind][v] * 1.04
		var am := ArrayMesh.new()
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		for k in 3:
			var ang := PI * k / 3.0
			var r := Vector3(cos(ang), 0, sin(ang)) * (h / aspect) * 0.5
			var nrm := Vector3(-sin(ang), 0, cos(ang))
			var c := [Vector3.ZERO - r, Vector3.ZERO + r, Vector3(0, h, 0) + r, Vector3(0, h, 0) - r]
			var uv := [Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]
			for tri in [[0, 1, 2], [0, 2, 3]]:
				for idx in tri:
					st.set_normal(nrm)
					st.set_uv(uv[idx])
					st.add_vertex(c[idx] - Vector3(0, h * 0.02, 0))
		st.commit(am)
		_tree_meshes[key] = am
	var mi := MeshInstance3D.new()
	mi.mesh = _tree_meshes[key]
	mi.material_override = _tree_mats[key]
	mi.position = at
	mi.rotation.y = rng.randf_range(0, TAU)
	mi.scale = Vector3.ONE * size
	add_child(mi)


func _scatter_trees() -> void:
	var placed := 0
	var tries := 0
	while placed < 140 and tries < 6000:
		tries += 1
		var x := rng.randf_range(-150, 150)
		var z := rng.randf_range(-290, 200)
		var d := _road_info(Vector2(x, z)).x
		if d < 10.0 or d > 110.0:
			continue
		if Vector2(x, z).distance_to(ROUTE[11][1]) < 28.0 or Vector2(x, z).distance_to(ROUTE[8][1]) < 24.0:
			continue
		# woods thicken going down into the valley, in clumps
		var dens := smoothstep(200.0, 40.0, z) * 0.75 + 0.15
		if noise.get_noise_2d(x * 2.5, z * 2.5) < 0.0 or rng.randf() > dens:
			continue
		_tree_card("spruce", _ground(x, z), rng.randf_range(0.7, 1.15))
		placed += 1


## The deserted village: roofless houses and the stump of a church tower, all from the
## photogrammetry fort kit (modular_fort_01), brought down to the size of cottages.
func _build_village() -> void:
	var c: Vector2 = ROUTE[8][1]
	var centre := _ground(c.x, c.y)
	anchors["village"] = Transform3D(Basis.IDENTITY, centre)
	# the church tower, broken off above the bell-floor
	var tower_at := _ground(c.x + 5, c.y - 15)
	anchors["tower"] = Transform3D(Basis.IDENTITY, tower_at)
	var tower := _piece("modular_fort_01", "tower_round")
	if tower:
		tower.position = tower_at - Vector3(0, 0.3, 0)
		tower.scale = Vector3(0.5, 0.62, 0.5)
		tower.rotation.y = 0.8
		add_child(tower)
	var spots := [Vector2(-16, 8), Vector2(14, 10), Vector2(-14, -12), Vector2(-26, -2), Vector2(26, 0), Vector2(-6, 20), Vector2(18, -6)]
	for i in spots.size():
		var s: Vector2 = c + spots[i]
		var house := Node3D.new()
		house.position = _ground(s.x, s.y) - Vector3(0, 0.15, 0)
		house.rotation.y = rng.randf_range(-0.35, 0.35) + (PI / 2 if i % 2 == 0 else 0.0)
		var k := rng.randf_range(0.36, 0.46)
		house.scale = Vector3(k, rng.randf_range(0.3, 0.48), k)
		add_child(house)
		# front with its empty doorway, two side walls, and (sometimes) what is left of the back
		var parts := [["wall_thin_gate_01", Vector3(0, 0, 14.82), PI / 2], ["wall_thin_straight_01", Vector3(0, 0, 0), 0.0], ["wall_thin_straight_02", Vector3(5.0, 0, 0), 0.0]]
		if i % 3 != 1:
			parts.append(["wall_thin_straight_04", Vector3(0, 0, 2.55), PI / 2])
		for part in parts:
			var n := _piece("modular_fort_01", part[0])
			if n:
				n.position = part[1] - Vector3(3.8, 0, 7.4)
				n.rotation.y = part[2]
				house.add_child(n)
		_place("nettle_plant", _ground(s.x, s.y) + Vector3(rng.randf_range(-1, 1), 0, rng.randf_range(-1, 1)), rng.randf_range(1.0, 1.6), rng.randf())


func _build_cemetery() -> void:
	var c: Vector2 = ROUTE[11][1]
	var gate: Vector2 = ROUTE[10][1]
	var center := _ground(c.x, c.y)
	var marble := _mat("marble_01", 0.35)
	var blocks := _mat("medieval_blocks_02", 0.35)
	anchors["gate"] = Transform3D(Basis.IDENTITY, _ground(gate.x, gate.y))
	# a low wall of scanned stone round the copse (the fort kit's thin wall, cut down), with an iron gate
	var to_gate := (gate - c).angle()
	var r := 24.0
	var seg := 2.9
	var n_seg := int(TAU * r / seg)
	for k in n_seg:
		var a := TAU * k / n_seg
		if absf(wrapf(a - to_gate, -PI, PI)) < 0.085:
			continue
		var p := c + Vector2(cos(a), sin(a)) * r
		var tangent := Vector3(-sin(a), 0, cos(a))
		var holder := Node3D.new()
		holder.position = _ground(p.x, p.y) - Vector3(0, 0.25, 0)
		holder.basis = _facing(tangent)
		add_child(holder)
		var w := _piece("modular_fort_01", "wall_thin_straight_03")
		if w:
			w.scale = Vector3(0.2, rng.randf_range(0.17, 0.21), seg / 7.41 + 0.02)
			w.position = Vector3(-0.25, 0, -seg / 2.0)
			holder.add_child(w)
	var gp := c + Vector2(cos(to_gate), sin(to_gate)) * r
	var iron := _scan("large_iron_gate")
	if iron:
		var gh := Node3D.new()
		gh.position = _ground(gp.x, gp.y)
		var radial := Vector3(cos(to_gate), 0, sin(to_gate))
		gh.basis = Basis(Vector3(-sin(to_gate), 0, cos(to_gate)), Vector3.UP, radial)
		add_child(gh)
		gh.add_child(iron)
		# the gate stands open: swing each leaf on its hinge
		for leaf in [["large_iron_gate_left_door", -1.43, -1.1], ["large_iron_gate_right_door", 1.43, 1.25]]:
			var d := iron.find_child(leaf[0], true, false) as Node3D
			if d:
				var hinge := Node3D.new()
				hinge.position = Vector3(leaf[1], 0, 0)
				iron.add_child(hinge)
				d.get_parent().remove_child(d)
				hinge.add_child(d)
				d.position = Vector3(-leaf[1], 0, 0)
				hinge.rotation.y = leaf[2]
	# gravestones, leaning, sunk in the snow
	for k in 22:
		var a := rng.randf_range(0, TAU)
		var rr := rng.randf_range(8, 20)
		var p := c + Vector2(cos(a), sin(a)) * rr
		if absf(wrapf(a - to_gate, -PI, PI)) < 0.35:
			continue
		var stone := _block(Vector3(0.62, rng.randf_range(0.7, 1.3), 0.14), _ground(p.x, p.y) + Vector3(0, 0.4, 0), marble, rng.randf_range(0, TAU))
		stone.rotation.x = rng.randf_range(-0.18, 0.18)
		stone.rotation.z = rng.randf_range(-0.1, 0.1)
	# the cypress alley from the gap in the wall to the tomb (firs, drawn tall and narrow)
	for k in 7:
		var t := float(k) / 6.0
		var p := gp.lerp(c, 0.12 + t * 0.6)
		var side := (c - gate).orthogonal().normalized() * 3.5
		for s in [-1.0, 1.0]:
			var q: Vector2 = p + side * s
			_tree_card("cypress", _ground(q.x, q.y), rng.randf_range(0.9, 1.05))
	_build_tomb(center, (gate - c).normalized(), marble, blocks)


## The tomb: vast blocks of white marble on a stone plinth, hollow, with a deep doorway and
## a scanned oak door; the bier inside; the great iron stake through the roof.
func _build_tomb(center: Vector3, face: Vector2, marble: Material, blocks: Material) -> void:
	var tomb := Node3D.new()
	tomb.position = center
	tomb.basis = _facing(Vector3(face.x, 0, face.y))
	add_child(tomb)
	var T := tomb.transform
	anchors["tomb"] = T
	anchors["door"] = T * Transform3D(Basis.IDENTITY, Vector3(0, 0.8, 3.75))
	anchors["statue"] = T * Transform3D(Basis.IDENTITY, Vector3(3.6, 0.8, 4.2))
	anchors["bier"] = T * Transform3D(Basis.IDENTITY, Vector3(0, 1.5, -1.2))
	_block(Vector3(7.5, 0.8, 9.5), Vector3(0, 0.4, 0), blocks, 0.0, true, tomb)
	# walls: back, two sides, the front in three pieces round the doorway
	for part in [
		[Vector3(5.5, 4.2, 0.6), Vector3(0, 2.9, -3.45)],
		[Vector3(0.6, 4.2, 7.5), Vector3(-2.45, 2.9, 0)],
		[Vector3(0.6, 4.2, 7.5), Vector3(2.45, 2.9, 0)],
		[Vector3(1.75, 4.2, 0.6), Vector3(-1.875, 2.9, 3.45)],
		[Vector3(1.75, 4.2, 0.6), Vector3(1.875, 2.9, 3.45)],
		[Vector3(2.0, 1.25, 0.6), Vector3(0, 4.375, 3.45)],
		[Vector3(6.1, 0.6, 8.1), Vector3(0, 5.3, 0)],
		[Vector3(6.4, 0.25, 8.4), Vector3(0, 5.72, 0)],
	]:
		_block(part[0], part[1], marble, 0.0, true, tomb)
	# the door: a photographed oak door in its stone frame
	var door := _scan("large_castle_door")
	if door:
		door.position = Vector3(0, 0.8, 3.2)
		tomb.add_child(door)
		door_left = door.find_child("large_castle_door_left", true, false) as Node3D
		door_right = door.find_child("large_castle_door_right", true, false) as Node3D
	# inside: the bier and the one who lies on it
	_block(Vector3(2.3, 0.7, 1.5), Vector3(0, 1.15, -1.2), marble, 0.0, true, tomb)
	var shroud := MeshInstance3D.new()
	shroud.mesh = _shroud_mesh(2.3, 1.5)
	var linen := StandardMaterial3D.new()
	linen.albedo_color = Color(0.86, 0.84, 0.8)
	linen.roughness = 0.92
	linen.cull_mode = BaseMaterial3D.CULL_DISABLED
	linen.subsurf_scatter_enabled = false
	shroud.material_override = linen
	shroud.position = Vector3(0, 1.5, -1.2)
	tomb.add_child(shroud)
	var inner := OmniLight3D.new()
	inner.position = Vector3(0.6, 3.6, 0.5)
	inner.light_color = Color(0.75, 0.82, 1.0)
	inner.light_energy = 1.4
	inner.omni_range = 6.0
	inner.shadow_enabled = true
	inner.visible = false
	tomb.add_child(inner)
	show_nodes["bier_light"] = inner
	# the great iron stake driven through the marble
	var stake := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.03
	cyl.bottom_radius = 0.14
	cyl.height = 3.2
	stake.mesh = cyl
	var iron := _dark_mat(Color(0.08, 0.07, 0.07), 0.7)
	iron.metallic = 0.6
	stake.material_override = iron
	stake.position = Vector3(0, 7.2, 0)
	stake.rotation.z = 0.05
	tomb.add_child(stake)
	# the inscriptions, cut in the marble
	var cut: Font = load("res://fonts/IMFeENsc28P.ttf")
	for ins in [["COUNTESS DOLINGEN OF GRATZ\nIN STYRIA\nSOUGHT AND FOUND DEATH\n1801", Vector3(0, 4.42, 3.76), 0.0, 56], ["THE DEAD TRAVEL FAST", Vector3(0, 3.4, -3.76), PI, 72]]:
		var l := Label3D.new()
		l.text = ins[0]
		l.font = cut
		l.font_size = ins[3]
		l.pixel_size = 0.0034
		l.modulate = Color(0.22, 0.2, 0.18)
		l.outline_size = 0
		l.shaded = true
		l.position = ins[1]
		l.rotation.y = ins[2]
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		tomb.add_child(l)
	# a weathered, veiled statue keeps watch beside the door
	var statue := _scan("gothic_statue")
	if statue:
		tomb.add_child(statue)
		_fit_height(statue, 2.2)
		statue.position = Vector3(3.6, 0.8, 4.2)
		statue.rotation.y = PI * 0.1
	# the wolf: two eyes at the edge of the roof, looking down
	var eyes := Node3D.new()
	eyes.position = Vector3(0.55, 6.06, 4.1)
	tomb.add_child(eyes)
	var glow := StandardMaterial3D.new()
	glow.albedo_color = Color(0.1, 0.05, 0.0)
	glow.emission_enabled = true
	glow.emission = Color(1.0, 0.62, 0.25)
	glow.emission_energy_multiplier = 9.0
	for x in [-0.07, 0.07]:
		var e := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.05
		sm.height = 0.06
		e.mesh = sm
		e.material_override = glow
		e.position = Vector3(x, 0, 0)
		eyes.add_child(e)
	eyes.visible = false
	show_nodes["wolf"] = eyes


## The one who lies on the bier, under a linen sheet: a body's shape (head on a pillow, shoulders,
## hands folded on the breast, hips, legs, the feet lifting the cloth), the sheet settling over it in
## folds and falling over the edges of the slab. Lying along x, head towards -x, on top of a slab
## of the given length and depth.
func _shroud_mesh(length: float, depth: float) -> ArrayMesh:
	var parts := [  # centre x, centre z, radius x, radius z, height
		[-0.93, 0.0, 0.2, 0.26, 0.07],    # pillow
		[-0.9, 0.0, 0.12, 0.1, 0.25],     # head
		[-0.66, 0.0, 0.1, 0.07, 0.15],    # neck
		[-0.5, 0.0, 0.16, 0.25, 0.2],     # shoulders
		[-0.3, 0.0, 0.26, 0.2, 0.23],     # breast, hands folded
		[-0.28, 0.0, 0.1, 0.13, 0.27],    # the hands
		[0.0, 0.0, 0.2, 0.21, 0.19],      # hips
		[0.32, -0.08, 0.3, 0.09, 0.15],   # thighs
		[0.32, 0.08, 0.3, 0.09, 0.15],
		[0.7, -0.07, 0.22, 0.07, 0.11],   # shins
		[0.7, 0.07, 0.22, 0.07, 0.11],
		[0.93, -0.08, 0.05, 0.06, 0.22],  # feet
		[0.93, 0.08, 0.05, 0.06, 0.22],
	]
	var hx := length / 2.0
	var hz := depth / 2.0
	var over := 0.32
	var step := 0.022
	var nx := int((length + 2 * over) / step) + 1
	var nz := int((depth + 2 * over) / step) + 1
	var cloth := FastNoiseLite.new()
	cloth.seed = 1801
	cloth.frequency = 3.2
	# the body's height under the cloth
	var hgt := PackedFloat32Array()
	hgt.resize(nx * nz)
	for j in nz:
		for i in nx:
			var x := -hx - over + i * step
			var z := -hz - over + j * step
			var hmax := 0.0
			for pt in parts:
				var dx: float = (x - pt[0]) / pt[2]
				var dz: float = (z - pt[1]) / pt[3]
				var q := 1.0 - dx * dx - dz * dz
				if q > 0.0:
					hmax = maxf(hmax, pt[4] * sqrt(q))
			hgt[j * nx + i] = hmax
	# the sheet does not cling: let it settle across the hollows (a few passes of smoothing that
	# only ever lift it)
	for pass_i in 6:
		var nh := hgt.duplicate()
		for j in range(1, nz - 1):
			for i in range(1, nx - 1):
				var avg := (hgt[j * nx + i - 1] + hgt[j * nx + i + 1] + hgt[(j - 1) * nx + i] + hgt[(j + 1) * nx + i]) * 0.25
				nh[j * nx + i] = maxf(hgt[j * nx + i], avg * 0.97)
		hgt = nh
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for j in nz:
		for i in nx:
			var x := -hx - over + i * step
			var z := -hz - over + j * step
			var cx := clampf(x, -hx - 0.01, hx + 0.01)
			var cz := clampf(z, -hz - 0.01, hz + 0.01)
			# past the edge of the slab the cloth falls straight down
			var fall := maxf(absf(x) - hx, 0.0) + maxf(absf(z) - hz, 0.0)
			var y := hgt[j * nx + i] + 0.012 - fall
			var folds := cloth.get_noise_2d(x * 1.0, z * 2.2) * 0.012 + cloth.get_noise_2d(x * 0.4 + 9.0, z * 5.0) * 0.008 * (1.0 + fall * 6.0)
			var pos := Vector3(cx, y + folds, cz)
			if fall > 0.0:
				# hanging folds swing a little out from the slab
				var outv := Vector2(x - cx, z - cz).normalized() * folds * 2.5
				pos += Vector3(outv.x, 0, outv.y)
			st.set_uv(Vector2(x, z))
			st.add_vertex(pos)
	for j in nz - 1:
		for i in nx - 1:
			var a := j * nx + i
			st.add_index(a)
			st.add_index(a + nx)
			st.add_index(a + 1)
			st.add_index(a + 1)
			st.add_index(a + nx)
			st.add_index(a + nx + 1)
	st.generate_normals()
	return st.commit()


## The telegram as a real printed form: a page drawn in the game's own type, used as the
## paper's picture.
func _telegram_texture() -> Texture2D:
	var vp := SubViewport.new()
	vp.size = Vector2i(1100, 780)
	vp.disable_3d = true
	vp.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(vp)
	var bg := ColorRect.new()
	bg.color = Color(0.9, 0.86, 0.76)
	bg.size = Vector2(vp.size)
	vp.add_child(bg)
	var ink := Color(0.13, 0.1, 0.08)
	var rule := ColorRect.new()
	rule.color = Color(ink, 0.7)
	rule.position = Vector2(60, 150)
	rule.size = Vector2(980, 3)
	vp.add_child(rule)
	var rule2 := rule.duplicate()
	rule2.position = Vector2(60, 700)
	vp.add_child(rule2)
	var head := Label.new()
	head.text = "TELEGRAMM"
	head.add_theme_font_override("font", load("res://fonts/IMFeENsc28P.ttf"))
	head.add_theme_font_size_override("font_size", 64)
	head.add_theme_color_override("font_color", ink)
	head.position = Vector2(60, 50)
	head.size = Vector2(980, 90)
	head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	vp.add_child(head)
	var meta := Label.new()
	meta.text = "Aufgegeben in BISTRITZ          an Herrn Delbrück, Hotel Quatre Saisons, MÜNCHEN"
	meta.add_theme_font_override("font", load("res://fonts/OldStandard-Regular.ttf"))
	meta.add_theme_font_size_override("font_size", 22)
	meta.add_theme_color_override("font_color", Color(ink, 0.8))
	meta.position = Vector2(60, 166)
	vp.add_child(meta)
	var body := Label.new()
	body.text = "Be careful of my guest—his safety is most precious to me. Should aught happen to him, or if he be missed, spare nothing to find him and ensure his safety. He is English and therefore adventurous. There is often danger from snow and wolves and night. Lose not a moment if you suspect harm to him. I answer your zeal with my fortune."
	body.add_theme_font_override("font", load("res://fonts/OldStandard-Italic.ttf"))
	body.add_theme_font_size_override("font_size", 38)
	body.add_theme_color_override("font_color", ink)
	body.add_theme_constant_override("line_spacing", 6)
	body.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	body.position = Vector2(70, 220)
	body.size = Vector2(960, 400)
	vp.add_child(body)
	var sign := Label.new()
	sign.text = "Dracula."
	sign.add_theme_font_override("font", load("res://fonts/IMFeENsc28P.ttf"))
	sign.add_theme_font_size_override("font_size", 46)
	sign.add_theme_color_override("font_color", ink)
	sign.position = Vector2(700, 625)
	vp.add_child(sign)
	return vp.get_texture()


func _build_stations() -> void:
	for r in ROUTE:
		if r[0] == "":
			continue
		var p: Vector2 = r[1]
		stations[r[0]] = _ground(p.x, p.y)
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
			var to: Vector3 = stations[name]
			# arrive facing on down the road, as a walker would
			var from := player.global_position
			player.global_position = to + Vector3(0, 0.5, 0)
			player.face(to + (to - from).normalized() * 10.0 + Vector3(0, 1.5, 0))
			# let some cold accumulate on the way
			Story.nudge({"cold": 4.0})
			return
	push_error("autoplay: walked the whole route without reaching an ending")
	get_tree().quit(1)


## --views=<folder>: a still of each composed shot in its own weather and look (no story), then quit.
## --only=<passage>,<passage> limits it to those passages.
func _render_views(dir: String) -> void:
	_shots_dir = dir
	ui.hint.visible = false
	var only: Array = []
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--only="):
			only = a.substr(7).split(",")
	var feel := {"Walpurgis Night": [0.6, 0.6], "The Hail": [0.7, 0.7], "The Bier": [0.9, 0.7], "The Wolf": [1.0, 0.8], "The Cypress Alley": [0.5, 0.5], "The Tomb": [0.5, 0.5], "Holloa": [0.3, 0.9], "The Deserted Village": [0.3, 0.4]}
	for name in Story.data.passages:
		var p: Dictionary = Story.data.passages[name]
		var scene: Dictionary = p.get("scene", {})
		var slug: String = name.to_lower().replace(" ", "_").replace(",", "").replace("'", "")
		if not only.is_empty() and not only.has(slug):
			continue
		if not shots.has(name):
			continue
		var f: Array = feel.get(name, [0.0, 0.0])
		Story.S["dread"] = f[0] * 60.0
		Story.S["cold"] = f[1] * 60.0
		ground_snow = 1.0 if scene.get("atmosphere", "") in ["snow", "storm", "hail", "moon", "dawn"] or scene.get("at", "") in ["tomb", "gate", "village"] else 0.0
		_look_from_tag = false
		_apply_scene(scene)
		_apply_weather(scene.get("atmosphere", weather), true)
		if scene.has("at") and stations.has(scene.at):
			player.global_position = stations[scene.at] + Vector3(0, 0.5, 4)
		player.set_physics_process(false)
		var shot := _shot_for(name, scene)
		letterbox = 1.0
		_frame(shot)
		_shot_tween.kill()
		for i in 6:
			_feel(10.0)
		ui.begin_passage(shot.get("side", "left"))
		var text := ""
		for op in p.get("ops", []):
			if op.get("t", "") == "text":
				text = op.get("text", "")
				break
		if text != "":
			ui.add_text(text)
		if shot.get("open", false):
			door_left.rotation.y = -1.25
			door_right.rotation.y = 1.1
		await get_tree().create_timer(2.5).timeout
		ui.settle()
		await get_tree().process_frame
		await _shot("view_" + slug)
		print("[view] ", name)
	get_tree().quit(0)


func _shot(name: String) -> void:
	if _shots_dir == "":
		return
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img:
		img.save_png("%s/%s.png" % [_shots_dir, name])
