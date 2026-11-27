shader_type spatial;
// Valley ground: scanned textures blended by road (vertex colour red), slope and snow cover.
uniform sampler2D ground_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D ground_nor : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D road_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D road_nor : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D rock_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D snow_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform sampler2D snow_nor : hint_normal, filter_linear_mipmap, repeat_enable;
uniform float tile = 0.25;
uniform float snow_amount : hint_range(0.0, 1.0) = 0.0;

varying vec3 world_pos;
varying vec3 world_nrm;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_nrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 uv = world_pos.xz * tile;
	float road = COLOR.r;
	float slope = 1.0 - clamp(world_nrm.y, 0.0, 1.0);
	float rockw = smoothstep(0.25, 0.5, slope);
	vec3 g = texture(ground_tex, uv).rgb;
	vec3 r = texture(road_tex, uv * 1.5).rgb;
	vec3 k = texture(rock_tex, uv * 0.6).rgb;
	vec3 s = texture(snow_tex, uv * 0.8).rgb;
	vec3 base = mix(mix(g, r, road), k, rockw * (1.0 - road));
	// snow settles on flat ground first, on the road a little later
	float snoww = clamp(snow_amount * 1.4 - slope * 0.8 - road * 0.25, 0.0, 1.0);
	ALBEDO = mix(base, s, snoww);
	vec3 n = mix(mix(texture(ground_nor, uv).rgb, texture(road_nor, uv * 1.5).rgb, road), texture(snow_nor, uv * 0.8).rgb, snoww);
	NORMAL_MAP = n;
	ROUGHNESS = mix(0.92, 0.7, snoww);
}
