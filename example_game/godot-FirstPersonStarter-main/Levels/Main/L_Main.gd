extends Node

# Fast Close implementation to ensure we can quickly close the application if needed.

func _input(event):
	if event.is_action_pressed("ui_cancel"):
		get_tree().quit()
