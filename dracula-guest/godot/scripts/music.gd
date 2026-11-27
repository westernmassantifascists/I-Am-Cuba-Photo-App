extends Node
## Adaptive score. All beds and feeling layers (rendered by the Darkroom groovebox at the same
## tempo and length) start together and loop in sync; the passage's music- tag picks the bed,
## and the feelings fade their layers in: dread, cold, defiance.

const DIR := "res://assets/music/"
const BEDS := ["munich", "valley", "village", "storm", "tomb", "dawn"]
const LAYERS := {"dread": "layer_dread", "cold": "layer_cold", "defiance": "layer_defiance"}

var players := {}
var bed := ""
var _started := false


func _ready() -> void:
	for b in BEDS:
		_add("bed_" + b)
	for k in LAYERS:
		_add(LAYERS[k])


func _add(name: String) -> void:
	var path := DIR + name + ".ogg"
	if not ResourceLoader.exists(path):
		return
	var stream: AudioStreamOggVorbis = load(path)
	stream.loop = true
	var p := AudioStreamPlayer.new()
	p.stream = stream
	p.volume_db = -80
	add_child(p)
	players[name] = p


func start() -> void:
	if _started:
		return
	_started = true
	for p in players.values():
		p.play()


## music-<bed> from the passage tags; "silence" fades every bed out.
func set_bed(name: String) -> void:
	start()
	bed = name
	for b in BEDS:
		var p: AudioStreamPlayer = players.get("bed_" + b)
		if p:
			_fade(p, -6.0 if b == name else -80.0, 4.0)


## Called a few times a second with the current feelings.
func mix(dread: float, cold: float, defiance: float) -> void:
	var levels := {"dread": dread, "cold": cold, "defiance": defiance * 0.6}
	for k in LAYERS:
		var p: AudioStreamPlayer = players.get(LAYERS[k])
		if p:
			var v: float = clampf((levels[k] - 15.0) / 70.0, 0.0, 1.0)
			_fade(p, linear_to_db(v) - 8.0 if v > 0.01 else -80.0, 1.5)


func _fade(p: AudioStreamPlayer, db: float, seconds: float) -> void:
	if absf(p.volume_db - db) < 0.5:
		return
	var tw := create_tween()
	tw.tween_property(p, "volume_db", db, seconds)


## One-shot effects (thunder, the howl, the bell): their own player each time.
func sfx(path: String, volume := 1.0) -> void:
	if not ResourceLoader.exists(path):
		return
	var p := AudioStreamPlayer.new()
	var s = load(path)
	if s is AudioStreamOggVorbis:
		s = s.duplicate()
		s.loop = false
	p.stream = s
	p.volume_db = linear_to_db(volume) - 2.0
	add_child(p)
	p.play()
	p.finished.connect(p.queue_free)
