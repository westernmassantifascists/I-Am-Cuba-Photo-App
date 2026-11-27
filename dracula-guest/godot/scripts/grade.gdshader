shader_type canvas_item;
// The film pass over every frame. Its numbers come from data/look.json, which tools/develop-look.mjs
// developed from the piece's own scans, textures and skies: how saturated the material is, its contrast,
// the tint of its darkest and lightest colours. The current place's developed mood is blended in on top.

uniform sampler2D screen : hint_screen_texture, filter_linear;
// developed base grade
uniform float saturation = 0.7;
uniform float contrast = 1.15;
uniform vec3 shadow_tint = vec3(0.28, 0.3, 0.3);
uniform vec3 highlight_tint = vec3(0.86, 0.88, 0.9);
uniform float grain = 0.04;
// the place's developed mood (look-<mood>)
uniform float mood_brightness = 1.0;
uniform float mood_contrast = 1.0;
uniform float mood_saturation = 1.0;
uniform float mood_sepia = 0.0;
uniform vec3 mood_tint = vec3(0.5);
uniform float mood_tint_amount = 0.15;
// feelings
uniform float dread = 0.0;
uniform float cold = 0.0;
// frame
uniform float letterbox = 0.0;      // 0 = full frame, 1 = 2.39:1
uniform float vignette = 0.55;
uniform float halation = 0.35;
uniform float weave = 1.0;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void fragment() {
	vec2 uv = SCREEN_UV;
	// gate weave: the frame drifts a fraction of a pixel, as film does in a projector gate
	float t = floor(TIME * 18.0);
	uv += weave * (vec2(hash(vec2(t, 1.0)), hash(vec2(t, 7.0))) - 0.5) * SCREEN_PIXEL_SIZE * 1.2;
	vec3 c = texture(screen, uv).rgb;

	// halation: bright areas bleed a warm glow into the dark around them
	// (a ring of wide taps rather than mipmaps, so it also runs in a browser)
	vec3 glow = vec3(0.0);
	for (int i = 0; i < 8; i++) {
		float a = float(i) * 0.785398;
		vec2 o = vec2(cos(a), sin(a)) * SCREEN_PIXEL_SIZE;
		glow += texture(screen, uv + o * 14.0).rgb + texture(screen, uv + o * 34.0).rgb;
	}
	glow /= 16.0;
	float gl = max(dot(glow, vec3(0.333)) - 0.55, 0.0) * 2.0;
	c += halation * gl * vec3(1.0, 0.72, 0.55);

	// developed grade, then the place's mood
	float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
	float sat = saturation * mood_saturation * (1.0 - 0.55 * dread) * (1.0 - 0.35 * cold);
	c = mix(vec3(l), c, sat);
	c *= mood_brightness * (1.0 - 0.18 * dread);
	float k = contrast * mood_contrast * (1.0 + 0.2 * dread);
	c = (c - 0.45) * k + 0.45;
	// split-tone: shadows toward the material's darkest colour, highlights toward its lightest
	l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
	vec3 toned = mix(shadow_tint * l * 2.2, mix(vec3(l), highlight_tint, 0.6), smoothstep(0.15, 0.85, l));
	c = mix(c, toned, 0.45);
	vec3 sepia = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
	c = mix(c, sepia, mood_sepia);
	c = mix(c, c * (mood_tint * 2.0), mood_tint_amount);
	c = mix(c, c * vec3(0.86, 0.94, 1.08), cold * 0.5);

	// grain, a little heavier in the shadows; a faint flicker
	float n = hash(uv * vec2(1931.0, 1213.0) + fract(TIME * 7.13)) - 0.5;
	c += n * grain * (1.4 - l);
	c *= 1.0 + (hash(vec2(t, 3.0)) - 0.5) * 0.012;

	// vignette
	vec2 d = (SCREEN_UV - 0.5) * vec2(1.0, 0.85);
	c *= mix(1.0, smoothstep(0.85, 0.2, length(d)), vignette);

	// letterbox
	float bar = letterbox * 0.5 * (1.0 - (1.0 / SCREEN_PIXEL_SIZE.x) / (1.0 / SCREEN_PIXEL_SIZE.y) / 2.39);
	if (SCREEN_UV.y < bar || SCREEN_UV.y > 1.0 - bar) c = vec3(0.0);
	COLOR = vec4(clamp(c, 0.0, 1.0), 1.0);
}
