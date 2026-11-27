extends Node
## Everything over the world, in three layers:
##   film (0)  public-domain film, graded with the world
##   grade (1) the film pass (grade.gdshader), developed from the material
##   page (10) the text, set into the composed shot; cards; the end
## Type: Old Standard (late-19th-century book type) for the text, IM Fell English small caps for titles.

signal choice_pressed(index: int)
signal begin_again

var grade_mat: ShaderMaterial
var ink := Color("dbe0e6")
var dim := Color("8d98a5")
var accent := Color("bfa888")

var body_font: Font
var italic_font: Font
var bold_font: Font
var display_font: FontVariation
var kicker_font: FontVariation

var page: Control
var scrim: TextureRect
var column: VBoxContainer
var paragraphs: VBoxContainer
var choices: VBoxContainer
var card: ColorRect
var card_kicker: Label
var card_title: Label
var card_sub: Label
var veil: ColorRect
var film_layer: CanvasLayer
var video: VideoStreamPlayer
var hint: Label
var end_screen: ColorRect
var end_title: Label
var end_found: Label
var side := "left"
var _queue: Array = []
var _revealing := false
var _pending_choices: Array = []
var _video_skippable := true
var _card_waiting := false
var _hint_shown := false


func _ready() -> void:
	_load_palette()
	body_font = load("res://fonts/OldStandard-Regular.ttf")
	italic_font = load("res://fonts/OldStandard-Italic.ttf")
	bold_font = load("res://fonts/OldStandard-Bold.ttf")
	display_font = FontVariation.new()
	display_font.base_font = load("res://fonts/IMFeENsc28P.ttf")
	display_font.spacing_glyph = 2
	kicker_font = FontVariation.new()
	kicker_font.base_font = body_font
	kicker_font.spacing_glyph = 5

	film_layer = CanvasLayer.new()
	film_layer.layer = 0
	add_child(film_layer)
	video = VideoStreamPlayer.new()
	video.set_anchors_preset(Control.PRESET_FULL_RECT)
	video.expand = true
	video.modulate.a = 0.0
	video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	video.finished.connect(_end_video)
	film_layer.add_child(video)

	var grade_layer := CanvasLayer.new()
	grade_layer.layer = 1
	add_child(grade_layer)
	var grade_rect := ColorRect.new()
	grade_rect.set_anchors_preset(Control.PRESET_FULL_RECT)
	grade_rect.mouse_filter = Control.MOUSE_FILTER_IGNORE
	grade_mat = ShaderMaterial.new()
	grade_mat.shader = load("res://scripts/grade.gdshader")
	grade_rect.material = grade_mat
	grade_layer.add_child(grade_rect)

	var top := CanvasLayer.new()
	top.layer = 10
	add_child(top)
	page = Control.new()
	page.set_anchors_preset(Control.PRESET_FULL_RECT)
	page.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(page)

	# a soft fall-off into black on the text's side of the frame: the text sits in the image
	scrim = TextureRect.new()
	scrim.set_anchors_preset(Control.PRESET_FULL_RECT)
	scrim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	scrim.stretch_mode = TextureRect.STRETCH_SCALE
	page.add_child(scrim)
	scrim.modulate.a = 0.0

	column = VBoxContainer.new()
	column.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_theme_constant_override("separation", 26)
	column.alignment = BoxContainer.ALIGNMENT_CENTER
	page.add_child(column)
	paragraphs = VBoxContainer.new()
	paragraphs.add_theme_constant_override("separation", 16)
	paragraphs.mouse_filter = Control.MOUSE_FILTER_IGNORE
	column.add_child(paragraphs)
	choices = VBoxContainer.new()
	choices.add_theme_constant_override("separation", 4)
	column.add_child(choices)

	veil = ColorRect.new()
	veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	veil.color = Color(0, 0, 0, 0)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	top.add_child(veil)

	card = ColorRect.new()
	card.color = Color(0, 0, 0, 1)
	card.set_anchors_preset(Control.PRESET_FULL_RECT)
	card.visible = false
	card.gui_input.connect(func(e): if e is InputEventMouseButton and e.pressed: _close_card())
	top.add_child(card)
	var cbox := VBoxContainer.new()
	cbox.set_anchors_preset(Control.PRESET_CENTER)
	cbox.grow_horizontal = Control.GROW_DIRECTION_BOTH
	cbox.grow_vertical = Control.GROW_DIRECTION_BOTH
	cbox.add_theme_constant_override("separation", 14)
	card.add_child(cbox)
	card_kicker = _label(cbox, kicker_font, 15, dim)
	card_title = _label(cbox, display_font, 72, ink)
	card_sub = _label(cbox, italic_font, 20, dim)

	hint = _label(page, kicker_font, 12, Color(ink, 0.5))
	hint.text = "WALK   W A S D        LOOK   MOUSE        HURRY   SHIFT"
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.position.y -= 54
	hint.modulate.a = 0.0

	end_screen = ColorRect.new()
	end_screen.color = Color(0, 0, 0, 1)
	end_screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	end_screen.visible = false
	top.add_child(end_screen)
	var ebox := VBoxContainer.new()
	ebox.set_anchors_preset(Control.PRESET_CENTER)
	ebox.grow_horizontal = Control.GROW_DIRECTION_BOTH
	ebox.grow_vertical = Control.GROW_DIRECTION_BOTH
	ebox.add_theme_constant_override("separation", 18)
	end_screen.add_child(ebox)
	_label(ebox, kicker_font, 14, dim).text = "ENDING"
	end_title = _label(ebox, display_font, 56, ink)
	end_found = _label(ebox, italic_font, 18, dim)
	var again := _choice_button("Begin again")
	again.pressed.connect(func(): begin_again.emit())
	var holder := CenterContainer.new()
	holder.add_child(again)
	ebox.add_child(holder)
	var credits := _label(ebox, italic_font, 14, dim)
	credits.text = "Bram Stoker, Dracula's Guest, 1914.\nPhotogrammetry, surfaces and skies from Poly Haven (CC0). Public-domain film from Wikimedia Commons.\nScore played on VSCO 2 CE (CC0) by the Darkroom groovebox. The Countess: Microsoft Rocketbox (MIT).\nWolves: US Fish & Wildlife Service (PD). Thunder: Bidgee (CC BY 3.0), Caesar (PD), via Wikimedia Commons.\nType: Old Standard and IM Fell English (SIL OFL)."
	_layout("left")


func _load_palette() -> void:
	var f := FileAccess.open("res://data/look.json", FileAccess.READ)
	if f == null:
		return
	var look: Dictionary = JSON.parse_string(f.get_as_text())
	var p: Dictionary = look.get("palette", {})
	if p.has("text"):
		ink = Color(p.text)
		dim = Color(p.dim)
		accent = Color(p.accent)


func apply_grade(look: Dictionary) -> void:
	var g: Dictionary = look.get("grade", {})
	for k in ["saturation", "contrast", "grain"]:
		if g.has(k):
			grade_mat.set_shader_parameter(k, float(g[k]))
	for k in ["shadow_tint", "highlight_tint"]:
		if g.has(k):
			grade_mat.set_shader_parameter(k, Vector3(g[k][0], g[k][1], g[k][2]))


func _label(parent: Node, font: Font, size: int, color: Color) -> Label:
	var l := Label.new()
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_override("font", font)
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	parent.add_child(l)
	return l


func _choice_button(text: String) -> Button:
	var b := Button.new()
	b.text = text
	b.flat = true
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.add_theme_font_override("font", display_font)
	b.add_theme_font_size_override("font_size", 21)
	b.add_theme_color_override("font_color", accent)
	b.add_theme_color_override("font_hover_color", ink)
	b.add_theme_color_override("font_focus_color", ink)
	b.add_theme_color_override("font_pressed_color", ink)
	var empty := StyleBoxEmpty.new()
	for s in ["normal", "hover", "pressed", "focus", "disabled"]:
		b.add_theme_stylebox_override(s, empty)
	return b


# ---------------------------------------------------------------- the page

## side: "left" or "right" — the half of the frame the shot leaves free for text.
func _layout(new_side: String) -> void:
	side = new_side
	var left := side != "right"
	column.anchor_top = 0.16
	column.anchor_bottom = 0.86
	column.anchor_left = 0.07 if left else 0.58
	column.anchor_right = 0.42 if left else 0.93
	column.offset_left = 0
	column.offset_right = 0
	column.offset_top = 0
	column.offset_bottom = 0
	var grad := Gradient.new()
	grad.offsets = PackedFloat32Array([0.0, 0.5, 1.0])
	var dark := [Color(0, 0, 0, 0.84), Color(0, 0, 0, 0.5), Color(0, 0, 0, 0)]
	if not left:
		dark.reverse()
	grad.colors = PackedColorArray(dark)
	var tex := GradientTexture2D.new()
	tex.gradient = grad
	tex.width = 256
	tex.height = 4
	scrim.texture = tex


func begin_passage(new_side: String) -> void:
	for c in paragraphs.get_children():
		c.queue_free()
	_clear_choices()
	_queue.clear()
	_pending_choices = []
	_layout(new_side)
	var tw := create_tween()
	tw.tween_property(scrim, "modulate:a", 1.0, 1.2)
	create_tween().tween_property(hint, "modulate:a", 0.0, 0.5)


func add_text(bbcode: String) -> void:
	var rt := RichTextLabel.new()
	rt.bbcode_enabled = true
	rt.fit_content = true
	rt.scroll_active = false
	rt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	rt.add_theme_font_override("normal_font", body_font)
	rt.add_theme_font_override("italics_font", italic_font)
	rt.add_theme_font_override("bold_font", bold_font)
	rt.add_theme_font_size_override("normal_font_size", 22)
	rt.add_theme_font_size_override("italics_font_size", 22)
	rt.add_theme_font_size_override("bold_font_size", 22)
	rt.add_theme_color_override("default_color", ink)
	rt.add_theme_constant_override("line_separation", 7)
	rt.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.6))
	rt.add_theme_constant_override("shadow_offset_y", 1)
	rt.text = bbcode
	rt.modulate.a = 0.0
	paragraphs.add_child(rt)
	_queue.append(rt)
	if not _revealing:
		_reveal()


## Paragraphs come one after another; a click or a key shows the rest at once.
func _reveal() -> void:
	_revealing = true
	while not _queue.is_empty():
		var rt: Control = _queue.pop_front()
		if not is_instance_valid(rt):
			continue
		var tw := create_tween()
		tw.tween_property(rt, "modulate:a", 1.0, 1.1)
		await get_tree().create_timer(1.4 + min(2.5, rt.get_parsed_text().length() / 260.0)).timeout
	_revealing = false
	if not _pending_choices.is_empty():
		_show_choices_now()


func _finish_reveal() -> void:
	for rt in _queue:
		if is_instance_valid(rt):
			rt.modulate.a = 1.0
	_queue.clear()


## Everything shown at once, no fades (for stills).
func settle() -> void:
	_finish_reveal()
	for c in paragraphs.get_children():
		c.modulate.a = 1.0
	scrim.modulate.a = 1.0
	veil.color.a = 0.0


func show_choices(labels: Array) -> void:
	_pending_choices = labels
	if not _revealing:
		_show_choices_now()


func _show_choices_now() -> void:
	_clear_choices()
	var labels := _pending_choices
	_pending_choices = []
	for i in labels.size():
		var b := _choice_button("—  " + labels[i])
		b.pressed.connect(func(): choice_pressed.emit(i))
		b.modulate.a = 0.0
		choices.add_child(b)
		create_tween().tween_property(b, "modulate:a", 1.0, 0.8).set_delay(0.15 * i)
	if choices.get_child_count() > 0:
		(choices.get_child(0) as Button).grab_focus()


func hide_passage() -> void:
	_clear_choices()
	var tw := create_tween().set_parallel(true)
	tw.tween_property(scrim, "modulate:a", 0.0, 0.8)
	for c in paragraphs.get_children():
		tw.tween_property(c, "modulate:a", 0.0, 0.6)
	if not _hint_shown:
		_hint_shown = true
		var th := create_tween()
		th.tween_property(hint, "modulate:a", 1.0, 1.5).set_delay(1.0)
		th.tween_property(hint, "modulate:a", 0.0, 2.0).set_delay(7.0)


func _clear_choices() -> void:
	for c in choices.get_children():
		c.queue_free()


# ---------------------------------------------------------------- cards, film, effects

func show_card(title: String, kicker: String, sub: String) -> void:
	card_title.text = title
	card_kicker.text = kicker.to_upper()
	card_sub.text = sub
	card.visible = true
	for l in [card_kicker, card_title, card_sub]:
		l.modulate.a = 0.0
	card.modulate.a = 1.0
	create_tween().tween_property(card_kicker, "modulate:a", 1.0, 1.4).set_delay(0.4)
	create_tween().tween_property(card_title, "modulate:a", 1.0, 2.0).set_delay(1.1)
	create_tween().tween_property(card_sub, "modulate:a", 1.0, 1.4).set_delay(2.4)
	_card_waiting = true
	await get_tree().create_timer(5.5).timeout
	_close_card()


func _close_card() -> void:
	if not _card_waiting:
		return
	_card_waiting = false
	var tw := create_tween()
	tw.tween_property(card, "modulate:a", 0.0, 1.4)
	tw.tween_callback(func(): card.visible = false)
	Story.card_done.emit()


func play_video(path: String, skippable: bool) -> void:
	_video_skippable = skippable
	var stream = load(path)
	if stream == null:
		Story.video_done.emit.call_deferred()
		return
	video.stream = stream
	video.play()
	create_tween().tween_property(video, "modulate:a", 1.0, 1.0)
	get_tree().create_timer(30.0).timeout.connect(func(): if video.is_playing() and video.stream == stream: _end_video())


func _end_video() -> void:
	if video.modulate.a <= 0.0 and not video.is_playing():
		return
	var tw := create_tween()
	tw.tween_property(video, "modulate:a", 0.0, 1.2)
	tw.tween_callback(video.stop)
	Story.video_done.emit()


func fx(kind: String, seconds: float) -> void:
	var tw := create_tween()
	match kind:
		"flash":
			veil.color = Color(1, 1, 1, 0.95)
			tw.tween_property(veil, "color:a", 0.0, seconds)
		"fadeout":
			veil.color = Color(0, 0, 0, veil.color.a)
			tw.tween_property(veil, "color:a", 1.0, seconds)
		"fadein":
			tw.tween_property(veil, "color:a", 0.0, seconds)


## A cut through black.
func dip(seconds: float) -> void:
	veil.color = Color(0, 0, 0, 1)
	create_tween().tween_property(veil, "color:a", 0.0, seconds)


func show_end(title: String, found: int, total: int) -> void:
	end_title.text = title
	end_found.text = "%d of %d endings found" % [found, total]
	end_screen.visible = true
	end_screen.modulate.a = 0.0
	create_tween().tween_property(end_screen, "modulate:a", 1.0, 2.5)


func _unhandled_input(event: InputEvent) -> void:
	var pressed: bool = (event is InputEventKey and event.pressed) or (event is InputEventMouseButton and event.pressed)
	if not pressed:
		return
	if video.is_playing() and _video_skippable:
		_end_video()
	elif _card_waiting:
		_close_card()
	elif not _queue.is_empty():
		_finish_reveal()
