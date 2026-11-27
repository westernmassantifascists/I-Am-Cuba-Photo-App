shader_type spatial;
// A baked conifer standing as crossed cards: cut out, lit as a soft mass of needles
// (normals bent towards the sky and the viewer, light passing through the edges).
render_mode cull_disabled;

uniform sampler2D tex : source_color, filter_linear_mipmap, repeat_disable;

void fragment() {
	vec4 c = texture(tex, UV);
	ALBEDO = c.rgb * 0.9;
	ALPHA = c.a;
	ALPHA_SCISSOR_THRESHOLD = 0.45;
	vec3 up = (VIEW_MATRIX * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
	NORMAL = normalize(mix(NORMAL * (FRONT_FACING ? 1.0 : -1.0), normalize(up + VIEW), 0.55));
	ROUGHNESS = 1.0;
	SPECULAR = 0.1;
	BACKLIGHT = vec3(0.18, 0.2, 0.12);
}
