extends CanvasLayer
## Everything drawn over the world: the passage text and choices, chapter cards, film,
## flashes and fades, the hint line and the end screen. Built in code; no scene files.

signal choice_pressed(index: int)
signal begin_again

const INK := Color("e9e3d6")
const DIM := Color("a9a294")
const PAPER := Color(0.04, 0.04, 0.05, 0.8)

var panel: PanelContainer
var text: RichTextLabel
var choices: VBoxContainer
var card: Control
var card_kicker: Label
var card_title: Label
var card_sub: Label
var veil: ColorRect
var video: VideoStreamPlayer
var video_box: ColorRect
var hint: Label
var end_screen: Control
var end_title: Label
var end_found: Label
var _video_skippable := true
var _card_waiting := false
var _paragraphs := 0


func _ready() -> void:
	layer = 10
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	veil = ColorRect.new()
	veil.set_anchors_preset(Control.PRESET_FULL_RECT)
	veil.color = Color(0, 0, 0, 0)
	veil.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(veil)

	# passage text: a dark page on the right-hand side, so the scene stays visible
	panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = PAPER
	sb.content_margin_left = 34
	sb.content_margin_right = 34
	sb.content_margin_top = 28
	sb.content_margin_bottom = 28
	sb.border_color = Color(1, 1, 1, 0.08)
	sb.set_border_width_all(1)
	panel.add_theme_stylebox_override("panel", sb)
	panel.anchor_left = 0.5
	panel.anchor_right = 0.5
	panel.anchor_top = 0.08
	panel.anchor_bottom = 0.92
	panel.offset_left = -20
	panel.offset_right = 640
	panel.visible = false
	root.add_child(panel)
	var scroll := ScrollContainer.new()
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	panel.add_child(scroll)
	var col := VBoxContainer.new()
	col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	col.add_theme_constant_override("separation", 18)
	scroll.add_child(col)
	text = RichTextLabel.new()
	text.bbcode_enabled = true
	text.fit_content = true
	text.scroll_active = false
	text.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	text.add_theme_color_override("default_color", INK)
	text.add_theme_font_size_override("normal_font_size", 20)
	text.add_theme_font_size_override("italics_font_size", 20)
	text.add_theme_font_size_override("bold_font_size", 20)
	text.add_theme_constant_override("line_separation", 6)
	col.add_child(text)
	choices = VBoxContainer.new()
	choices.add_theme_constant_override("separation", 6)
	col.add_child(choices)

	# chapter card
	card = ColorRect.new()
	card.color = Color(0, 0, 0, 0.88)
	card.set_anchors_preset(Control.PRESET_FULL_RECT)
	card.visible = false
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.gui_input.connect(func(e): if e is InputEventMouseButton and e.pressed: _close_card())
	root.add_child(card)
	var cbox := VBoxContainer.new()
	cbox.set_anchors_preset(Control.PRESET_CENTER)
	cbox.alignment = BoxContainer.ALIGNMENT_CENTER
	cbox.grow_horizontal = Control.GROW_DIRECTION_BOTH
	cbox.grow_vertical = Control.GROW_DIRECTION_BOTH
	card.add_child(cbox)
	card_kicker = _label(cbox, 16, DIM)
	card_title = _label(cbox, 54, INK)
	card_sub = _label(cbox, 20, DIM)

	# film
	video_box = ColorRect.new()
	video_box.color = Color.BLACK
	video_box.set_anchors_preset(Control.PRESET_FULL_RECT)
	video_box.visible = false
	video_box.gui_input.connect(func(e): if e is InputEventMouseButton and e.pressed and _video_skippable: _end_video())
	root.add_child(video_box)
	video = VideoStreamPlayer.new()
	video.set_anchors_preset(Control.PRESET_FULL_RECT)
	video.expand = true
	video.mouse_filter = Control.MOUSE_FILTER_IGNORE
	video.finished.connect(_end_video)
	video_box.add_child(video)

	hint = Label.new()
	hint.text = "W A S D  walk     mouse  look     Shift  hurry     Esc  release the mouse"
	hint.add_theme_color_override("font_color", Color(1, 1, 1, 0.45))
	hint.add_theme_font_size_override("font_size", 14)
	hint.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	hint.position.y -= 40
	hint.grow_horizontal = Control.GROW_DIRECTION_BOTH
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(hint)

	end_screen = ColorRect.new()
	end_screen.color = Color(0, 0, 0, 0.92)
	end_screen.set_anchors_preset(Control.PRESET_FULL_RECT)
	end_screen.visible = false
	root.add_child(end_screen)
	var ebox := VBoxContainer.new()
	ebox.set_anchors_preset(Control.PRESET_CENTER)
	ebox.grow_horizontal = Control.GROW_DIRECTION_BOTH
	ebox.grow_vertical = Control.GROW_DIRECTION_BOTH
	ebox.add_theme_constant_override("separation", 14)
	end_screen.add_child(ebox)
	_label(ebox, 16, DIM).text = "ENDING"
	end_title = _label(ebox, 44, INK)
	end_found = _label(ebox, 16, DIM)
	var again := _button("Begin again")
	again.pressed.connect(func(): begin_again.emit())
	ebox.add_child(again)
	var credits := _label(ebox, 13, DIM)
	credits.text = "Bram Stoker, Dracula's Guest (1914). Scans, textures and skies: Poly Haven (CC0).\nFilm: public domain, Wikimedia Commons. Music: the Darkroom groovebox. See CREDITS.md."


func _label(parent: Node, size: int, color: Color) -> Label:
	var l := Label.new()
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	parent.add_child(l)
	return l


func _button(label: String) -> Button:
	var b := Button.new()
	b.text = label
	b.alignment = HORIZONTAL_ALIGNMENT_LEFT
	b.flat = true
	b.add_theme_font_size_override("font_size", 19)
	b.add_theme_color_override("font_color", Color("d9c39a"))
	b.add_theme_color_override("font_hover_color", Color("f3e2bd"))
	b.add_theme_color_override("font_focus_color", Color("f3e2bd"))
	return b


# ---------------------------------------------------------------- passages

func begin_passage() -> void:
	text.clear()
	_paragraphs = 0
	_clear_choices()
	panel.visible = true
	panel.modulate.a = 0.0
	create_tween().tween_property(panel, "modulate:a", 1.0, 0.6)
	hint.visible = false


func add_text(bbcode: String) -> void:
	if not panel.visible:
		begin_passage()
	if _paragraphs > 0:
		text.append_text("\n\n")
	text.append_text(bbcode)
	_paragraphs += 1


func show_choices(labels: Array) -> void:
	_clear_choices()
	for i in labels.size():
		var b := _button("—  " + labels[i])
		b.pressed.connect(func(): choice_pressed.emit(i))
		choices.add_child(b)
	if choices.get_child_count() > 0:
		(choices.get_child(0) as Button).grab_focus()


func hide_passage() -> void:
	_clear_choices()
	var tw := create_tween()
	tw.tween_property(panel, "modulate:a", 0.0, 0.5)
	tw.tween_callback(func(): panel.visible = false)
	hint.visible = true


func _clear_choices() -> void:
	for c in choices.get_children():
		c.queue_free()


# ---------------------------------------------------------------- cards, film, effects

func show_card(title: String, kicker: String, sub: String) -> void:
	card_title.text = title
	card_kicker.text = kicker.to_upper()
	card_sub.text = sub
	card.visible = true
	card.modulate.a = 0.0
	create_tween().tween_property(card, "modulate:a", 1.0, 1.0)
	_card_waiting = true
	await get_tree().create_timer(4.0).timeout
	_close_card()


func _close_card() -> void:
	if not _card_waiting:
		return
	_card_waiting = false
	var tw := create_tween()
	tw.tween_property(card, "modulate:a", 0.0, 0.8)
	tw.tween_callback(func(): card.visible = false)
	Story.card_done.emit()


func play_video(path: String, skippable: bool) -> void:
	_video_skippable = skippable
	var stream = load(path)
	if stream == null:
		Story.video_done.emit.call_deferred()
		return
	video.stream = stream
	video_box.visible = true
	video.play()
	# a safety net in case the clip never reports that it finished
	get_tree().create_timer(30.0).timeout.connect(func(): if video_box.visible and video.stream == stream: _end_video())


func _end_video() -> void:
	if not video_box.visible:
		return
	video.stop()
	video_box.visible = false
	Story.video_done.emit()


func fx(kind: String, seconds: float) -> void:
	var tw := create_tween()
	match kind:
		"flash":
			veil.color = Color(1, 1, 1, 0.9)
			tw.tween_property(veil, "color:a", 0.0, seconds)
		"fadeout":
			veil.color = Color(0, 0, 0, veil.color.a)
			tw.tween_property(veil, "color:a", 1.0, seconds)
		"fadein":
			tw.tween_property(veil, "color:a", 0.0, seconds)
		"shake":
			pass


func dip(seconds: float) -> void:
	# a quick fade through black, e.g. when the story moves you somewhere else
	veil.color = Color(0, 0, 0, 1)
	create_tween().tween_property(veil, "color:a", 0.0, seconds)


func show_end(title: String, found: int, total: int) -> void:
	end_title.text = title
	end_found.text = "%d of %d endings found" % [found, total]
	end_screen.visible = true
	end_screen.modulate.a = 0.0
	create_tween().tween_property(end_screen, "modulate:a", 1.0, 2.0)


func hide_end() -> void:
	end_screen.visible = false


func _unhandled_input(event: InputEvent) -> void:
	if video_box.visible and _video_skippable and event is InputEventKey and event.pressed:
		_end_video()
	elif _card_waiting and event is InputEventKey and event.pressed:
		_close_card()
