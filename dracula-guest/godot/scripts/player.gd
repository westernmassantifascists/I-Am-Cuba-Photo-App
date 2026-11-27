extends CharacterBody3D
## First-person walker. WASD / arrows / left stick to walk, mouse / right stick to look,
## Shift to hurry. Snow slows you down.

var enabled := false
var snow_slow := 0.0        # 0..1, set by the weather
var look_sensitivity := 0.0025
var camera: Camera3D
var _pitch := 0.0
var _bob := 0.0

const WALK := 3.4
const HURRY := 6.0
const GRAVITY := 18.0


func _ready() -> void:
	_bind_inputs()
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.35
	cap.height = 1.75
	shape.shape = cap
	shape.position.y = 0.875
	add_child(shape)
	camera = Camera3D.new()
	camera.position.y = 1.65
	camera.fov = 70
	camera.far = 900
	add_child(camera)
	camera.make_current()
	floor_snap_length = 0.6
	floor_max_angle = deg_to_rad(50)


func _bind_inputs() -> void:
	var keys := {
		"walk_forward": [KEY_W, KEY_UP], "walk_back": [KEY_S, KEY_DOWN],
		"walk_left": [KEY_A, KEY_LEFT], "walk_right": [KEY_D, KEY_RIGHT], "hurry": [KEY_SHIFT],
	}
	for action in keys:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action)
		for k in keys[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)
	var axes := {"walk_forward": [JOY_AXIS_LEFT_Y, -1.0], "walk_back": [JOY_AXIS_LEFT_Y, 1.0], "walk_left": [JOY_AXIS_LEFT_X, -1.0], "walk_right": [JOY_AXIS_LEFT_X, 1.0]}
	for action in axes:
		var j := InputEventJoypadMotion.new()
		j.axis = axes[action][0]
		j.axis_value = axes[action][1]
		InputMap.action_add_event(action, j)


func _unhandled_input(event: InputEvent) -> void:
	if not enabled:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_look(event.relative * look_sensitivity)


func _look(delta: Vector2) -> void:
	rotate_y(-delta.x)
	_pitch = clampf(_pitch - delta.y, deg_to_rad(-80), deg_to_rad(80))
	camera.rotation.x = _pitch


func face(target: Vector3) -> void:
	var d := target - global_position
	rotation.y = atan2(-d.x, -d.z)
	_pitch = 0.0
	camera.rotation.x = 0.0


func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	var input := Vector2.ZERO
	if enabled:
		input = Input.get_vector("walk_left", "walk_right", "walk_forward", "walk_back")
		var stick := Vector2(Input.get_joy_axis(0, JOY_AXIS_RIGHT_X), Input.get_joy_axis(0, JOY_AXIS_RIGHT_Y))
		if stick.length() > 0.15:
			_look(stick * delta * 2.5)
	var speed := (HURRY if Input.is_action_pressed("hurry") else WALK) * (1.0 - 0.35 * snow_slow)
	var dir := (transform.basis * Vector3(input.x, 0, input.y)).normalized()
	velocity.x = dir.x * speed
	velocity.z = dir.z * speed
	move_and_slide()
	# a little head movement while walking
	if dir.length() > 0.1 and is_on_floor():
		_bob += delta * speed * 2.2
		camera.position.y = 1.65 + sin(_bob) * 0.035
	else:
		camera.position.y = lerpf(camera.position.y, 1.65, delta * 4.0)


func moving() -> bool:
	return enabled and Vector2(velocity.x, velocity.z).length() > 0.5
