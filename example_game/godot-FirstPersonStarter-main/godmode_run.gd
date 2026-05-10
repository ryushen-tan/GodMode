extends SceneTree


func _init() -> void:
	var packed: PackedScene = load("res://Levels/Main/L_Main.tscn")
	var scene: Node = packed.instantiate()
	root.add_child(scene)
	current_scene = scene
	await process_frame
	while true:
		await create_timer(1.0).timeout
