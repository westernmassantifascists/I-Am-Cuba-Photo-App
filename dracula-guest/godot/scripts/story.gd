extends Node
## Darkroom story runtime for Godot (autoload "Story").
## Plays a story compiled by Darkroom (data/story.json): passages, feelings (meters), conditions,
## threshold turns (@turn), drifting scenes (@drift), endings. It knows nothing about the 3D world:
## it emits signals, and the world (main.gd) answers them. Reusable for any Darkroom story.

signal passage_started(name: String, scene: Dictionary)
signal text_shown(bbcode: String)
signal choices_shown(labels: Array)
signal video_requested(path: String, skippable: bool)
signal sfx_requested(path: String, volume: float)
signal card_requested(title: String, kicker: String, sub: String)
signal fx_requested(kind: String, seconds: float)
signal walk_requested
signal ending_reached(id: String, title: String)
signal meters_changed
signal scene_changed(changes: Dictionary)   # @atmosphere / @look / @music inside a passage

## The world emits these back when it has finished showing something.
signal video_done
signal card_done

const STORY_FILE := "res://data/story.json"
const SAVE_FILE := "user://darkroom.cfg"

var data: Dictionary = {}
var S: Dictionary = {}            # story variables, including the meters
var visited: Dictionary = {}
var fired: Dictionary = {}        # threshold turns that have happened
var resume_to := ""
var passage := ""
var running := false              # a passage is being shown (the world should not move on)
var ended := ""
var _choices: Array = []
var _last_by_pool: Dictionary = {}
var _helpers: Helpers


func _ready() -> void:
	var f := FileAccess.open(STORY_FILE, FileAccess.READ)
	if f == null:
		push_error("Story: cannot open %s" % STORY_FILE)
		return
	data = JSON.parse_string(f.get_as_text())
	_helpers = Helpers.new(self)


# ------------------------------------------------------------------ public API

func start() -> void:
	S.clear()
	visited.clear()
	fired.clear()
	resume_to = ""
	ended = ""
	for k in data.get("meters", {}):
		var m: Dictionary = data.meters[k]
		S[k] = float(m.get("start", m.get("min", 0)))
	await _run(data.get("init", []), [])
	go(data.start)


## Go to a passage, or a special target: "@drift <pool> else=X", "@resume", "@walk".
func go(target: String) -> void:
	var resolved := _resolve(target)
	if resolved == "@walk" or resolved == "":
		if resolved == "" and target != "@walk":
			push_warning("Story: nowhere to go from '%s'" % target)
		running = false
		walk_requested.emit()
		return
	if not data.passages.has(resolved):
		push_error("Story: no passage '%s'" % resolved)
		running = false
		walk_requested.emit()
		return
	var turn := _turn_for(resolved)
	if not turn.is_empty():
		fired[turn.passage] = true
		resume_to = resolved
		resolved = turn.passage
	await _enter(resolved)


## The world calls this while the player walks: a threshold turn may break in.
func check_turns() -> bool:
	if running or ended != "":
		return false
	var turn := _turn_for("")
	if turn.is_empty():
		return false
	fired[turn.passage] = true
	resume_to = "@walk"
	_enter(turn.passage)
	return true


func choose(index: int) -> void:
	if index < 0 or index >= _choices.size():
		return
	var c: Dictionary = _choices[index]
	_choices = []
	if c.has("set"):
		_assign(c.set)
	if c.has("nudge"):
		nudge(c.nudge)
	go(c.target)


func nudge(changes: Dictionary) -> void:
	for k in changes:
		var m: Dictionary = data.get("meters", {}).get(k, {})
		var lo := float(m.get("min", 0.0)) if not m.is_empty() else -INF
		var hi := float(m.get("max", 100.0)) if not m.is_empty() else INF
		S[k] = clampf(float(S.get(k, 0.0)) + float(changes[k]), lo, hi)
	meters_changed.emit()


func meter(name: String) -> float:
	return float(S.get(name, 0.0))


func dominant() -> String:
	var best := ""
	for k in data.get("meters", {}):
		if best == "" or meter(k) > meter(best):
			best = k
	return best


func runs() -> int:
	var cfg := ConfigFile.new()
	cfg.load(SAVE_FILE)
	return int(cfg.get_value("story", "runs", 0))


func endings_found() -> Array:
	var cfg := ConfigFile.new()
	cfg.load(SAVE_FILE)
	return cfg.get_value("story", "endings", [])


# ------------------------------------------------------------------ playing a passage

func _enter(name: String) -> void:
	running = true
	passage = name
	visited[name] = int(visited.get(name, 0)) + 1
	var p: Dictionary = data.passages[name]
	passage_started.emit(name, p.get("scene", {}))
	var choices: Array = []
	var r: String = await _run(p.ops, choices)
	if r == "stop":
		return
	if choices.is_empty():
		running = false
		walk_requested.emit()
		return
	_choices = choices
	var labels: Array = []
	for c in choices:
		labels.append(_fill(c.text, c.get("x", [])))
	choices_shown.emit(labels)


func _run(ops: Array, choices: Array) -> String:
	for op in ops:
		match op.t:
			"text":
				text_shown.emit(_fill(op.text, op.get("x", [])))
			"choice":
				choices.append(op)
			"set":
				_assign(op)
			"unset":
				S.erase(op.var)
			"nudge":
				nudge(op.changes)
			"if":
				var chosen = null
				for b in op.branches:
					if _truthy(_eval(b.cond)):
						chosen = b.ops
						break
				if chosen == null and op.get("else") != null:
					chosen = op.else
				if chosen != null:
					var r: String = await _run(chosen, choices)
					if r == "stop":
						return r
			"goto":
				var target: String = op.get("special", op.get("target", ""))
				if op.has("expr"):
					target = str(_eval(op.expr))
				call_deferred("go", target)
				return "stop"
			"include":
				var inc: Dictionary = data.passages.get(op.target, {})
				var r2: String = await _run(inc.get("ops", []), choices)
				if r2 == "stop":
					return r2
			"video":
				if ResourceLoader.exists(op.src):
					video_requested.emit(op.src, op.get("skip", true))
					await video_done
			"sfx", "voice":
				sfx_requested.emit(op.src, float(op.get("volume", 1.0)))
			"card":
				card_requested.emit(op.get("title", ""), op.get("kicker", ""), op.get("sub", ""))
				await card_done
			"fx":
				var secs := float(op.get("s", 1.5)) if op.get("s") != null else (0.6 if op.kind == "flash" else 1.5)
				fx_requested.emit(op.kind, secs)
				if op.kind in ["fadeout", "fadein"]:
					await get_tree().create_timer(secs).timeout
			"wait":
				await get_tree().create_timer(float(op.get("s", 1.0))).timeout
			"ending":
				_ending(op.id, op.title)
			"atmosphere":
				scene_changed.emit({"atmosphere": op.name})
			"look":
				scene_changed.emit({"look": op.look})
			"music":
				if op.get("mood", "") != "":
					scene_changed.emit({"music": op.mood})
			_:
				pass # web-only ops (bg, image, music files, textbox …) have no meaning in the 3D world
	return "ok"


func _ending(id: String, title: String) -> void:
	ended = id
	var cfg := ConfigFile.new()
	cfg.load(SAVE_FILE)
	var found: Array = cfg.get_value("story", "endings", [])
	if not found.has(id):
		found.append(id)
	cfg.set_value("story", "endings", found)
	cfg.set_value("story", "runs", int(cfg.get_value("story", "runs", 0)) + 1)
	cfg.save(SAVE_FILE)
	ending_reached.emit(id, title)


# ------------------------------------------------------------------ turns and drift

func _turn_for(target: String) -> Dictionary:
	for t in data.get("turns", []):
		if t.passage == target or t.passage == passage:
			continue
		if t.get("once", true) and fired.has(t.passage):
			continue
		if _truthy(_eval(t.cond)):
			return t
	return {}


func _resolve(target: String) -> String:
	var t := target.strip_edges()
	if t == "@walk":
		return "@walk"
	if t == "@resume":
		return resume_to if resume_to != "" else "@walk"
	if t.begins_with("@drift"):
		var rest := t.substr(6).strip_edges()
		var fallback := ""
		var at := rest.find(" else")
		if at >= 0:
			fallback = rest.substr(at).split("=", true, 1)[1].strip_edges()
			rest = rest.substr(0, at).strip_edges()
		var pick := _drift(rest)
		return pick if pick != "" else fallback
	return t


## The unvisited scene in the pool whose feel- tags add up to the most feeling right now.
func _drift(pool: String) -> String:
	var best := -INF
	var top: Array = []
	for n in data.get("pools", {}).get(pool, []):
		if visited.has(n) or n == passage:
			continue
		var p: Dictionary = data.passages[n]
		if p.has("when") and not _truthy(_eval(p.when)):
			continue
		var fit := 0.0
		for f in p.get("feel", []):
			fit += meter(f)
		if fit > best:
			best = fit
			top = [n]
		elif fit == best:
			top.append(n)
	if top.is_empty():
		return ""
	return top[randi() % top.size()]


# ------------------------------------------------------------------ expressions

func _eval(code: String) -> Variant:
	var e := Expression.new()
	if e.parse(code, ["S"]) != OK:
		push_error("Story: cannot read '%s': %s" % [code, e.get_error_text()])
		return null
	var v = e.execute([S], _helpers, false)
	if e.has_execute_failed():
		push_error("Story: '%s' failed in %s" % [code, passage])
		return null
	return v


func _truthy(v: Variant) -> bool:
	if v == null:
		return false
	if v is bool:
		return v
	if v is float or v is int:
		return v != 0
	if v is String:
		return v != ""
	return true


func _assign(a: Dictionary) -> void:
	if a.get("t") == "noop":
		return
	var v = _eval(a.expr)
	var cur = S.get(a.var, 0)
	match a.op:
		"=":
			S[a.var] = v
		"+=":
			S[a.var] = cur + v
		"-=":
			S[a.var] = cur - v
		"*=":
			S[a.var] = cur * v
		"/=":
			S[a.var] = cur / v if v != 0 else cur
	if data.get("meters", {}).has(a.var):
		meters_changed.emit()


func _fill(text: String, x: Array) -> String:
	var out := text
	for i in x.size():
		var v = _eval(x[i])
		out = out.replace(char(1) + str(i) + char(1), "" if v == null else str(v))
	return out


## Functions available inside story conditions: visited("X"), dominant(), runs(), random(a, b), either(…)
class Helpers:
	extends RefCounted
	var story

	func _init(s) -> void:
		story = s

	func visited(name: String = "") -> int:
		return int(story.visited.get(name if name != "" else story.passage, 0))

	func dominant() -> String:
		return story.dominant()

	func runs() -> int:
		return story.runs()

	func random(a: int, b: int = -1) -> int:
		return randi() % a if b < 0 else randi_range(a, b)

	func either(a = null, b = null, c = null, d = null):
		var xs := [a, b, c, d].filter(func(v): return v != null)
		return xs[randi() % xs.size()]

	func passage() -> String:
		return story.passage
