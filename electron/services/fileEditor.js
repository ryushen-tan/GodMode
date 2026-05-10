const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const GAME_ROOT = path.join(__dirname, '..', '..', 'example_game', 'godot-FirstPersonStarter-main');
const MAIN_SCRIPT_PATH = 'Levels/Main/L_Main.gd';
const MOVEMENT_SCRIPT_PATH = 'Player/MovementController.gd';

const BASE_MAIN_SCRIPT = `extends Node

# Fast Close implementation to ensure we can quickly close the application if needed.

func _input(event):
\tif event.is_action_pressed("ui_cancel"):
\t\tget_tree().quit()
`;

const BASE_MOVEMENT_CONTROLLER_SCRIPT = `extends CharacterBody3D
class_name MovementController


@export var gravity_multiplier := 3.0
@export var speed := 5  # Decreased speed
@export var acceleration := 10  # Decreased acceleration
@export var deceleration := 5  # Decreased deceleration
@export_range(0.0, 1.0, 0.05) var air_control := 0.3
@export var jump_height := 10  # Decreased jump height
var direction := Vector3()
var input_axis := Vector2()
# Get the gravity from the project settings to be synced with RigidDynamicBody nodes.
@onready var gravity: float = (ProjectSettings.get_setting("physics/3d/default_gravity")
\t\t* gravity_multiplier)


# Called every physics tick. 'delta' is constant
func _physics_process(delta: float) -> void:
\tinput_axis = Input.get_vector("move_back", "move_forward",
\t\t\t"move_left", "move_right")
\tdirection_input()
\t
\tif is_on_floor():
\t\tif Input.is_action_just_pressed("jump"):
\t\t\tvelocity.y = jump_height
\telse:
\t\tvelocity.y -= gravity * delta
\t
\taccelerate(delta)
\t
\tmove_and_slide()


func direction_input() -> void:
\tdirection = Vector3()
\tvar aim: Basis = get_global_transform().basis
\tdirection = aim.z * -input_axis.x + aim.x * input_axis.y


func accelerate(delta: float) -> void:
\t# Using only the horizontal velocity, interpolate towards the input.
\tvar temp_vel := velocity
\ttemp_vel.y = 0
\t
\tvar temp_accel: float
\tvar target: Vector3 = direction * speed
\t
\tif direction.dot(temp_vel) > 0:
\t\ttemp_accel = acceleration
\telse:
\t\ttemp_accel = deceleration
\t
\tif not is_on_floor():
\t\ttemp_accel *= air_control
\t
\tvar accel_weight = clamp(temp_accel * delta, 0.0, 1.0)
\ttemp_vel = temp_vel.lerp(target, accel_weight)
\t
\tvelocity.x = temp_vel.x
\tvelocity.z = temp_vel.z
`;

const MULTIPLAYER_MAIN_SCRIPT = `extends Node

const GODMODE_MULTIPLAYER_ENABLED := true
const MULTIPLAYER_HOST := "127.0.0.1"
const STATE_SEND_INTERVAL := 0.05
const FILE_SYNC_STALE_SECONDS := 5.0

var multiplayer_port := 4242
var network_peer: ENetMultiplayerPeer
var remote_avatars := {}
var state_send_timer := 0.0
var is_client_instance := false
var test_log_path := ""
var file_sync_id := ""
var file_sync_path := ""
@onready var local_player := get_node_or_null("Player") as Node3D
@onready var remote_players_root := Node3D.new()


func _ready() -> void:
	remote_players_root.name = "RemotePlayers"
	add_child(remote_players_root)
	multiplayer_port = _get_cmdline_port()
	test_log_path = _get_cmdline_value("--godmode-test-log=")

	is_client_instance = "--godmode-client" in OS.get_cmdline_user_args()
	file_sync_id = ("client_%s" if is_client_instance else "host_%s") % OS.get_process_id()
	file_sync_path = "/tmp/godmode_multiplayer_state_%s.json" % multiplayer_port
	if is_client_instance:
		_offset_client_player()

	if is_client_instance:
		connect_to_host()
	else:
		host_game()


func _physics_process(delta: float) -> void:
	if local_player == null:
		return

	state_send_timer -= delta
	if state_send_timer > 0.0:
		return

	state_send_timer = STATE_SEND_INTERVAL
	_sync_file_multiplayer()

	if multiplayer.multiplayer_peer == null:
		return

	if multiplayer.is_server():
		rpc("_receive_player_state", multiplayer.get_unique_id(), local_player.global_position, local_player.global_rotation.y)
	else:
		rpc_id(1, "_submit_player_state", local_player.global_position, local_player.global_rotation.y)


func host_game() -> void:
	if multiplayer.multiplayer_peer != null:
		return

	network_peer = ENetMultiplayerPeer.new()
	var error := network_peer.create_server(multiplayer_port, 8)
	if error != OK:
		push_warning("GodMode multiplayer host failed on port %s: %s" % [multiplayer_port, error])
		is_client_instance = true
		_offset_client_player()
		connect_to_host()
		return

	multiplayer.multiplayer_peer = network_peer
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	_test_log("host_listening")
	print("GodMode multiplayer host listening on port %s" % multiplayer_port)


func connect_to_host(host := MULTIPLAYER_HOST) -> void:
	if multiplayer.multiplayer_peer != null:
		return

	network_peer = ENetMultiplayerPeer.new()
	var error := network_peer.create_client(host, multiplayer_port)
	if error != OK:
		push_warning("GodMode multiplayer client failed to start: %s" % error)
		return

	multiplayer.multiplayer_peer = network_peer
	multiplayer.connected_to_server.connect(_on_connected_to_server)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)
	_test_log("client_connecting")
	print("GodMode multiplayer client connecting to %s:%s" % [host, multiplayer_port])


func _on_peer_connected(peer_id: int) -> void:
	var avatar := _ensure_remote_avatar(peer_id)
	avatar.global_position = _default_remote_position(peer_id)
	avatar.global_rotation = Vector3(0, PI, 0)
	_test_log("peer_connected:%s" % peer_id)
	print("GodMode multiplayer peer connected: %s" % peer_id)


func _on_peer_disconnected(peer_id: int) -> void:
	print("GodMode multiplayer peer disconnected: %s" % peer_id)
	_remove_remote_avatar(peer_id)


func _on_connected_to_server() -> void:
	_offset_client_player()
	var host_avatar := _ensure_remote_avatar(1)
	host_avatar.global_position = Vector3(0, 2.7, 0)
	host_avatar.global_rotation = Vector3.ZERO
	_test_log("client_connected")
	print("GodMode multiplayer client connected")


func _on_connection_failed() -> void:
	push_warning("GodMode multiplayer client connection failed")


func _on_server_disconnected() -> void:
	push_warning("GodMode multiplayer server disconnected")
	for peer_id in remote_avatars.keys():
		_remove_remote_avatar(peer_id)


@rpc("any_peer", "unreliable")
func _submit_player_state(position: Vector3, rotation_y: float) -> void:
	if not multiplayer.is_server():
		return

	var peer_id: int = multiplayer.get_remote_sender_id()
	_receive_player_state(peer_id, position, rotation_y)
	rpc("_receive_player_state", peer_id, position, rotation_y)


@rpc("any_peer", "unreliable")
func _receive_player_state(peer_id: int, position: Vector3, rotation_y: float) -> void:
	if peer_id == multiplayer.get_unique_id():
		return

	var avatar := _ensure_remote_avatar(peer_id)
	avatar.global_position = position + Vector3(0, 0.7, 0)
	avatar.global_rotation = Vector3(0, rotation_y, 0)


func _sync_file_multiplayer() -> void:
	var states := _read_file_sync_states()
	var now := Time.get_unix_time_from_system()
	states[file_sync_id] = {
		"position": [local_player.global_position.x, local_player.global_position.y, local_player.global_position.z],
		"rotation_y": local_player.global_rotation.y,
		"time": now
	}

	var active_remote_ids := {}
	for peer_key in states.keys():
		var entry = states[peer_key]
		if typeof(entry) != TYPE_DICTIONARY:
			continue
		if now - float(entry.get("time", 0.0)) > FILE_SYNC_STALE_SECONDS:
			states.erase(peer_key)
			continue
		if peer_key == file_sync_id:
			continue
		var raw_position = entry.get("position", [])
		if typeof(raw_position) != TYPE_ARRAY or raw_position.size() < 3:
			continue
		var position := Vector3(float(raw_position[0]), float(raw_position[1]), float(raw_position[2]))
		var rotation_y := float(entry.get("rotation_y", 0.0))
		_receive_file_player_state(peer_key, position, rotation_y)
		active_remote_ids[peer_key] = true

	for peer_key in remote_avatars.keys():
		if typeof(peer_key) == TYPE_STRING and not active_remote_ids.has(peer_key):
			_remove_remote_avatar(peer_key)

	var file := FileAccess.open(file_sync_path, FileAccess.WRITE)
	if file:
		file.store_string(JSON.stringify(states))


func _read_file_sync_states() -> Dictionary:
	if file_sync_path == "" or not FileAccess.file_exists(file_sync_path):
		return {}
	var file := FileAccess.open(file_sync_path, FileAccess.READ)
	if not file:
		return {}
	var parsed = JSON.parse_string(file.get_as_text())
	if typeof(parsed) == TYPE_DICTIONARY:
		return parsed
	return {}


func _receive_file_player_state(peer_key: String, position: Vector3, rotation_y: float) -> void:
	var avatar := _ensure_remote_avatar(peer_key)
	avatar.global_position = position + Vector3(0, 0.7, 0)
	avatar.global_rotation = Vector3(0, rotation_y, 0)


func _ensure_remote_avatar(peer_id) -> Node3D:
	if remote_avatars.has(peer_id):
		return remote_avatars[peer_id]

	var avatar := Node3D.new()
	avatar.name = "RemotePlayer%s" % peer_id

	var avocado_scene := load("res://sprites/Avocado.glb") as PackedScene
	if avocado_scene:
		var avocado := avocado_scene.instantiate() as Node3D
		avocado.name = "AvocadoModel"
		avocado.scale = Vector3(2.0, 2.0, 2.0)
		avatar.add_child(avocado)
		_enable_avatar_shadows(avocado)
	else:
		avatar.add_child(_make_fallback_avatar_box())

	remote_players_root.add_child(avatar)
	remote_avatars[peer_id] = avatar
	_test_log("remote_avatar_created:%s" % peer_id)
	print("GodMode visible Avocado player model created for peer %s" % peer_id)
	return avatar


func _make_fallback_avatar_box() -> MeshInstance3D:
	var box := MeshInstance3D.new()
	box.name = "FallbackPlayerBox"
	var mesh := BoxMesh.new()
	mesh.size = Vector3(1.0, 2.0, 1.0)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.0, 0.85, 1.0, 1.0)
	material.emission_enabled = true
	material.emission = Color(0.0, 0.45, 1.0, 1.0)
	material.emission_energy_multiplier = 1.5
	mesh.material = material
	box.mesh = mesh
	box.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	return box


func _enable_avatar_shadows(node: Node) -> void:
	if node is GeometryInstance3D:
		node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	for child in node.get_children():
		_enable_avatar_shadows(child)


func _remove_remote_avatar(peer_id) -> void:
	if not remote_avatars.has(peer_id):
		return

	var avatar: Node = remote_avatars[peer_id]
	remote_avatars.erase(peer_id)
	avatar.queue_free()


func _offset_client_player() -> void:
	if local_player == null:
		return

	var id: int = multiplayer.get_unique_id()
	var lane := 1
	if id > 1:
		lane = int(id % 4) + 1
	local_player.global_position = Vector3((lane - 2) * 2.0, local_player.global_position.y, -5.0 - lane)
	local_player.global_rotation = Vector3(0, PI, 0)


func _default_remote_position(peer_id: int) -> Vector3:
	var lane := int(peer_id % 4) + 1
	return Vector3((lane - 2) * 2.0, 2.7, -5.0 - lane)


func _get_cmdline_port() -> int:
	var raw := _get_cmdline_value("--godmode-port=")
	if raw != "":
		var value := raw.to_int()
		if value > 0:
			return value
	return 4242


func _get_cmdline_value(prefix: String) -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(prefix):
			return arg.trim_prefix(prefix)
	return ""


func _test_log(message: String) -> void:
	if test_log_path == "":
		return

	var file := FileAccess.open(test_log_path, FileAccess.WRITE)
	if file:
		file.store_line(message)


func _input(event):
	if event.is_action_pressed("ui_cancel"):
		get_tree().quit()
`;

function resolveGamePath(relativePath = '') {
  return path.join(GAME_ROOT, relativePath);
}

function listFiles(dir = '') {
  const root = resolveGamePath(dir);
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...listFiles(relative));
    } else {
      result.push(relative);
    }
  }
  return result;
}

function readFile(relativePath) {
  return fs.readFileSync(resolveGamePath(relativePath), 'utf8');
}

function writeFile(relativePath, content) {
  const fullPath = resolveGamePath(relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  if (fs.existsSync(fullPath)) {
    fs.copyFileSync(fullPath, `${fullPath}.bak`);
  }
  fs.writeFileSync(fullPath, content);
}

function restoreFileBackup(relativePath) {
  const fullPath = resolveGamePath(relativePath);
  const backupPath = `${fullPath}.bak`;
  if (!fs.existsSync(backupPath)) return false;
  fs.copyFileSync(backupPath, fullPath);
  return true;
}

function isGodotMultiplayerInstalled() {
  try {
    return readFile(MAIN_SCRIPT_PATH).includes('GODMODE_MULTIPLAYER_ENABLED');
  } catch {
    return false;
  }
}

function findGodotBinary() {
  const candidates = [
    '/Applications/Godot.app/Contents/MacOS/Godot',
    '/Applications/Godot_mono.app/Contents/MacOS/Godot',
    path.join(process.env.HOME || '', 'Applications/Godot.app/Contents/MacOS/Godot')
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  try {
    const output = execSync("ps aux | grep -i 'Godot.app/Contents/MacOS/Godot' | grep -v grep", { encoding: 'utf8' });
    const match = output.match(/(\/\S+Godot\.app\/Contents\/MacOS\/Godot)/);
    if (match && fs.existsSync(match[1])) return match[1];
  } catch {
    // No running Godot process found.
  }
  return null;
}

function makeGodotMultiplayer() {
  writeFile(MAIN_SCRIPT_PATH, MULTIPLAYER_MAIN_SCRIPT);
  return {
    changed: true,
    filesChanged: [MAIN_SCRIPT_PATH],
    message: 'Installed deterministic Godot multiplayer with visible Avocado player models.'
  };
}

function removeGodotMultiplayer() {
  writeFile(MAIN_SCRIPT_PATH, BASE_MAIN_SCRIPT);
  writeFile(MOVEMENT_SCRIPT_PATH, BASE_MOVEMENT_CONTROLLER_SCRIPT);
  return {
    changed: true,
    filesChanged: [MAIN_SCRIPT_PATH, MOVEMENT_SCRIPT_PATH],
    message: 'Removed Godot multiplayer code from the game project. Agent multiplayer actions are still available.'
  };
}

function sanitizeGodotConnectSyntax(content) {
  const objectExpr = String.raw`(get_tree\(\)\.multiplayer|multiplayer|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)`;
  const targetExpr = String.raw`(?:self|this|"res:\/\/[^"]+"|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)`;

  return String(content)
    .replace(new RegExp(String.raw`\b${objectExpr}\.connect\(\s*"([A-Za-z_]\w*)"\s*,\s*${targetExpr}\s*,\s*"([A-Za-z_]\w*)"\s*\)`, 'g'), '$1.$2.connect($3)')
    .replace(new RegExp(String.raw`\b(${objectExpr}\.[A-Za-z_]\w*)\.connect\(\s*${targetExpr}\s*,\s*"([A-Za-z_]\w*)"\s*\)`, 'g'), '$1.connect($3)');
}

function sanitizeGodotContent(relativePath, content) {
  if (!String(relativePath || '').endsWith('.gd')) return content;

  return sanitizeGodotConnectSyntax(content)
    .replace(/\bget_tree\s*\(\s*\)\s*\.\s*has_multiplayer_peer\s*\(\s*\)/g, 'get_tree().multiplayer.multiplayer_peer != null')
    .replace(/\bget_tree\s*\(\s*\)\s*\.\s*multiplayer\s*\.\s*peer\s*=/g, 'get_tree().multiplayer.multiplayer_peer =')
    .replace(/\bget_tree\s*\(\s*\)\s*\.\s*network_peer\b/g, 'get_tree().multiplayer.multiplayer_peer')
    .replace(/\bis_network_master\s*\(\s*\)/g, 'is_multiplayer_authority()')
    .replace(/\bset_network_master\s*\(/g, 'set_multiplayer_authority(')
    .replace(/\bget_tree\s*\(\s*\)\s*\.\s*get_network_unique_id\s*\(\s*\)/g, 'get_tree().multiplayer.get_unique_id()')
    .replace(/\bget_tree\s*\(\s*\)\s*\.\s*get_network_connected_peers\s*\(\s*\)/g, 'multiplayer.get_peers()')
    .replace(/\bget_tree\s*\(\s*\)\s*\.\s*set_network_peer\s*\(([^)]*)\)/g, 'get_tree().multiplayer.multiplayer_peer = $1');
}

function validateGodotContent(relativePath, content) {
  if (!String(relativePath || '').endsWith('.gd')) return { success: true };
  const text = String(content);

  const invalidPatterns = [
    {
      pattern: /\bget_tree\s*\(\s*\)\s*\.\s*has_multiplayer_peer\s*\(/,
      message: 'Invalid Godot 4 API: SceneTree has no has_multiplayer_peer(). Use get_tree().multiplayer.multiplayer_peer != null or multiplayer.has_multiplayer_peer().'
    },
    {
      pattern: /\bget_tree\s*\(\s*\)\s*\.\s*multiplayer\s*\.\s*peer\s*=/,
      message: 'Invalid Godot 4 API: MultiplayerAPI has no peer property. Use get_tree().multiplayer.multiplayer_peer = peer.'
    },
    {
      pattern: /\b(get_tree\s*\(\s*\)\s*\.\s*network_peer|is_network_master\s*\(|set_network_master\s*\(|remote\s+func|master\s+func|puppet\s+func)/,
      message: 'Invalid legacy Godot multiplayer API. Use Godot 4 multiplayer_peer, is_multiplayer_authority(), set_multiplayer_authority(), and @rpc.'
    },
    {
      pattern: /\.connect\s*\(\s*"[^"]+"\s*,\s*(?:self|this|"res:\/\/[^"]+"|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*,\s*"[^"]+"\s*\)/,
      message: 'Invalid Godot 3 signal connect syntax. In Godot 4 use signal.connect(method), e.g. get_tree().multiplayer.peer_connected.connect(_on_peer_connected).'
    },
    {
      pattern: /\.[A-Za-z_]\w*\.connect\s*\(\s*(?:self|this|"res:\/\/[^"]+"|[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*,\s*"[^"]+"\s*\)/,
      message: 'Invalid Godot 4 signal connect arguments. Signal.connect() expects a Callable, e.g. get_tree().multiplayer.peer_connected.connect(_on_peer_connected).'
    },
    {
      pattern: /\.connect\s*\([^)]*"res:\/\/[^"]+"/,
      message: 'Invalid Godot 4 signal connect target: never pass a script path string to connect(); pass a Callable or method reference.'
    }
  ];

  for (const { pattern, message } of invalidPatterns) {
    if (pattern.test(text)) {
      return { success: false, error: message };
    }
  }

  const topLevelCall = text
    .split(/\r?\n/)
    .find((line) => /^[^\s#].*\b(get_tree|rpc|rpc_id|Input|move_and_slide|velocity|multiplayer)\b.*(?:\(|=)/.test(line)
      && !/^(extends|class_name|class|signal|enum|const|var|@|func|static func)\b/.test(line));
  if (topLevelCall) {
    return {
      success: false,
      error: `Invalid GDScript class body statement: "${topLevelCall.trim()}". Put runtime calls inside a function like _ready() or _physics_process().`
    };
  }

  return { success: true };
}

function parseSpritePath(value) {
  const match = String(value || '').match(/res:\/\/sprites\/([^"'\s)]+\.glb)/i);
  if (!match) return null;
  const filename = path.basename(match[1]);
  return {
    filename,
    resPath: `res://sprites/${filename}`,
    fullPath: resolveGamePath(`sprites/${filename}`)
  };
}

function makeSceneId(prefix, input) {
  const hash = crypto.createHash('sha1').update(input).digest('hex').slice(0, 8);
  return `${prefix}_${hash}`;
}

function makeNodeName(filename, sceneContent) {
  const base = path.basename(filename, '.glb')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') || 'GeneratedModel';

  let name = base;
  let i = 2;
  while (sceneContent.includes(`[node name="${name}"`)) {
    name = `${base}${i++}`;
  }
  return name;
}

function parsePosition(prompt) {
  const match = String(prompt || '').match(/position\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i);
  if (!match) return { x: 0, y: 2, z: 0 };
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function importDestinationsExist(importPath) {
  if (!fs.existsSync(importPath)) return false;
  const content = fs.readFileSync(importPath, 'utf8');
  const match = content.match(/^dest_files=\[(.*)\]/m);
  if (!match) return false;
  const destFiles = [...match[1].matchAll(/"res:\/\/([^"]+)"/g)]
    .map((item) => path.join(GAME_ROOT, item[1]));
  return destFiles.length > 0 && destFiles.every((file) => fs.existsSync(file));
}

function runGodotImport() {
  const godotBin = findGodotBinary();
  if (!godotBin) {
    return { success: true, warning: 'Godot binary not found - import will run when Godot opens' };
  }

  try {
    execSync(`"${godotBin}" --headless --path "${GAME_ROOT}" --import 2>&1`, {
      timeout: 90000,
      encoding: 'utf8'
    });
    return { success: true };
  } catch (e) {
    const output = e.stdout || e.stderr || e.message || '';
    const errors = extractGodotErrors(output);
    if (!errors) return { success: true };
    return { success: false, error: errors };
  }
}

function extractGodotErrors(output) {
  const errorPatterns = [
    'ERROR:',
    'SCRIPT ERROR:',
    'Parse Error',
    'Parser Error',
    'Invalid call',
    'Nonexistent function',
    'Identifier not found',
    'Cannot find member'
  ];

  return String(output || '')
    .split('\n')
    .filter(line => errorPatterns.some(pattern => line.includes(pattern)))
    .filter(line => !line.includes('Godot Engine'))
    .filter(line => !line.includes('https://godotengine.org'))
    .join('\n')
    .trim();
}

function ensureSpriteImport(sprite) {
  if (!fs.existsSync(sprite.fullPath)) {
    throw new Error(`Sprite GLB not found: ${sprite.resPath}`);
  }

  const importPath = `${sprite.fullPath}.import`;
  let created = false;

  if (!fs.existsSync(importPath)) {
    const { createImportFile } = require('../../backend/ensure-imports');
    createImportFile(sprite.fullPath);
    created = true;
  }

  if (!importDestinationsExist(importPath)) {
    const imported = runGodotImport();
    if (!imported.success) {
      throw new Error(`Godot failed to import ${sprite.resPath}:\n${imported.error}`);
    }
  }

  return { created, importPath };
}

function getImportUid(importPath, sprite) {
  if (fs.existsSync(importPath)) {
    const content = fs.readFileSync(importPath, 'utf8');
    const match = content.match(/^uid="([^"]+)"/m);
    if (match) return match[1];
  }
  return `uid://${makeSceneId('gm', sprite.filename)}`;
}

function findExtResourceId(sceneContent, resPath) {
  const escapedPath = resPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = sceneContent.match(new RegExp(`\\[ext_resource[^\\]]*path="${escapedPath}"[^\\]]*id="([^"]+)"[^\\]]*\\]`));
  return match ? match[1] : null;
}

function insertExtResource(sceneContent, line) {
  const firstSubResource = sceneContent.search(/\n\[sub_resource /);
  const firstNode = sceneContent.search(/\n\[node /);
  const insertAt = firstSubResource !== -1 ? firstSubResource : firstNode;
  if (insertAt === -1) return `${sceneContent.trimEnd()}\n${line}\n`;
  return `${sceneContent.slice(0, insertAt)}\n${line}${sceneContent.slice(insertAt)}`;
}

function addSpriteToMainScene(prompt) {
  const sprite = parseSpritePath(prompt);
  if (!sprite) {
    throw new Error('No res://sprites/*.glb path found in prompt');
  }

  const importResult = ensureSpriteImport(sprite);
  const scenePath = 'Levels/Main/L_Main.tscn';
  let sceneContent = readFile(scenePath);
  if (sceneContent.startsWith('ERROR:')) {
    throw new Error(sceneContent);
  }

  let resourceId = findExtResourceId(sceneContent, sprite.resPath);
  if (!resourceId) {
    resourceId = makeSceneId('gm', sprite.filename);
    const uid = getImportUid(importResult.importPath, sprite);
    const extLine = `[ext_resource type="PackedScene" uid="${uid}" path="${sprite.resPath}" id="${resourceId}"]`;
    sceneContent = insertExtResource(sceneContent, extLine);
  }

  if (sceneContent.includes(`instance=ExtResource("${resourceId}")`)) {
    return {
      scenePath,
      spritePath: sprite.resPath,
      importCreated: importResult.created,
      changed: importResult.created,
      message: `${sprite.resPath} is already instanced in ${scenePath}`
    };
  }

  const pos = parsePosition(prompt);
  const nodeName = makeNodeName(sprite.filename, sceneContent);
  const uniqueId = Number.parseInt(crypto.randomBytes(4).toString('hex'), 16) % 2000000000;
  const nodeBlock = [
    '',
    `[node name="${nodeName}" parent="." unique_id=${uniqueId} instance=ExtResource("${resourceId}")]`,
    `transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${pos.x}, ${pos.y}, ${pos.z})`,
    ''
  ].join('\n');

  writeFile(scenePath, `${sceneContent.trimEnd()}${nodeBlock}`);
  return {
    scenePath,
    spritePath: sprite.resPath,
    nodeName,
    importCreated: importResult.created,
    changed: true,
    message: `Added ${sprite.resPath} to ${scenePath} as ${nodeName}`
  };
}

function grepFiles(pattern) {
  try {
    const result = execSync(
      `grep -rn ${JSON.stringify(pattern)} ${JSON.stringify(GAME_ROOT)} --include="*.gd" --include="*.tscn" 2>/dev/null`,
      { timeout: 5000 }
    ).toString().trim();
    // Strip the absolute game root prefix from paths for readability
    return result.replace(new RegExp(GAME_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/', 'g'), '');
  } catch (e) {
    if (e.status === 1) return 'No matches found.';
    return `ERROR: ${e.message}`;
  }
}

function checkGodotErrors() {
  const importResult = runGodotImport();
  if (!importResult.success) {
    return { success: false, error: importResult.error };
  }

  const godotBin = findGodotBinary();
  if (!godotBin) {
    return { success: true, warning: 'Godot binary not found - skipping error check' };
  }
  
  // Run Godot headless to check for parse errors
  try {
    const result = execSync(
      `"${godotBin}" --headless --path "${GAME_ROOT}" --check-only 2>&1`,
      { timeout: 10000, encoding: 'utf8' }
    );
    
    // Check if there are actual ERROR lines (not just version info)
    const errors = extractGodotErrors(result);
    
    if (errors) {
      return { success: false, error: errors };
    }
    
    return { success: true };
  } catch (e) {
    const output = e.stdout || e.stderr || e.message || '';
    
    // Extract only real ERROR lines, ignore version banner
    const errors = extractGodotErrors(output);
    
    // If no real errors found, consider it success
    if (!errors) {
      return { success: true };
    }
    
    return { success: false, error: errors };
  }
}

module.exports = {
  listFiles,
  readFile,
  writeFile,
  restoreFileBackup,
  isGodotMultiplayerInstalled,
  makeGodotMultiplayer,
  removeGodotMultiplayer,
  sanitizeGodotContent,
  validateGodotContent,
  grepFiles,
  checkGodotErrors,
  addSpriteToMainScene,
  GAME_ROOT
};
