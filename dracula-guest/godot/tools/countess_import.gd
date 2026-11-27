@tool
extends EditorScenePostImport
## On import of the Countess (Rocketbox Female_Adult_08, facial rig): her eyes are closed by baking
## the library's own blink shapes into the mesh, and the other ~50 facial shapes are dropped, which
## takes the model from 26 MB to a few. She only ever sleeps.

func _post_import(scene: Node) -> Object:
	for mi in scene.find_children("*", "MeshInstance3D", true, false):
		var m := (mi as MeshInstance3D).mesh as ArrayMesh
		if m == null or m.get_blend_shape_count() == 0:
			continue
		var keep := []
		for i in m.get_blend_shape_count():
			if "EyeBlink" in String(m.get_blend_shape_name(i)):
				keep.append(i)
		var out := ArrayMesh.new()
		for s in m.get_surface_count():
			var arrays := m.surface_get_arrays(s)
			var shapes := m.surface_get_blend_shape_arrays(s)
			var base: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
			var pos := base.duplicate()
			for i in keep:
				var sp: PackedVector3Array = shapes[i][Mesh.ARRAY_VERTEX]
				for v in pos.size():
					pos[v] += sp[v] - base[v] if m.blend_shape_mode == Mesh.BLEND_SHAPE_MODE_NORMALIZED else sp[v]
			arrays[Mesh.ARRAY_VERTEX] = pos
			out.add_surface_from_arrays(m.surface_get_primitive_type(s), arrays)
			out.surface_set_material(s, m.surface_get_material(s))
			out.surface_set_name(s, m.surface_get_name(s))
		(mi as MeshInstance3D).mesh = out
	return scene
