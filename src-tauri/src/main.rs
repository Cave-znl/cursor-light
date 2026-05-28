use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    env,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 18765;
const SNAP_DISTANCE: i32 = 24;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Orientation {
    Horizontal,
    Vertical,
}

impl Default for Orientation {
    fn default() -> Self {
        Self::Horizontal
    }
}

impl Orientation {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Horizontal => "horizontal",
            Self::Vertical => "vertical",
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LightState {
    status: String,
    event: String,
    message: String,
    received_at: String,
    raw: Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatePayload {
    current_state: LightState,
    history: Vec<LightState>,
    orientation: String,
    hooks_configured: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Settings {
    orientation: Orientation,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            orientation: Orientation::Horizontal,
        }
    }
}

struct AppData {
    current_state: LightState,
    history: Vec<LightState>,
    settings: Settings,
}

type SharedState = Arc<Mutex<AppData>>;

fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{secs}")
}

fn default_light_state() -> LightState {
    LightState {
        status: "green".to_string(),
        event: "ready".to_string(),
        message: "Waiting for Cursor hooks".to_string(),
        received_at: now_iso(),
        raw: Value::Null,
    }
}

fn normalize_status(status: Option<&str>, event_name: &str, payload: &Value) -> String {
    let text = status.unwrap_or(event_name).to_ascii_lowercase();
    let failed = payload.get("error").is_some()
        || payload
            .get("exitCode")
            .and_then(Value::as_i64)
            .map(|code| code > 0)
            .unwrap_or(false)
        || payload
            .get("success")
            .and_then(Value::as_bool)
            .map(|success| !success)
            .unwrap_or(false);

    if failed
        || ["fail", "error", "deny", "reject", "cancel", "exception"]
            .iter()
            .any(|needle| text.contains(needle))
    {
        return "red".to_string();
    }

    if [
        "before", "pre", "start", "running", "pending", "tooluse", "submit", "write", "edit",
        "shell",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return "yellow".to_string();
    }

    if [
        "after", "post", "stop", "done", "success", "complete", "accept", "green",
    ]
    .iter()
    .any(|needle| text.contains(needle))
    {
        return "green".to_string();
    }

    for color in ["red", "yellow", "green"] {
        if text.contains(color) {
            return color.to_string();
        }
    }

    "yellow".to_string()
}

fn summarize(payload: &Value) -> String {
    payload
        .get("message")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            payload
                .get("toolName")
                .or_else(|| payload.get("tool_name"))
                .and_then(Value::as_str)
                .map(|tool| format!("Tool: {tool}"))
        })
        .or_else(|| {
            payload
                .get("command")
                .and_then(Value::as_str)
                .map(|command| format!("Command: {command}"))
        })
        .or_else(|| payload.get("prompt").map(|_| "Prompt submitted".to_string()))
        .or_else(|| {
            payload
                .get("file")
                .or_else(|| payload.get("path"))
                .and_then(Value::as_str)
                .map(|file| format!("File: {file}"))
        })
        .unwrap_or_else(|| "Hook event received".to_string())
}

fn push_event(app: Option<&tauri::AppHandle>, state: &SharedState, payload: Value) -> LightState {
    let event_name = payload
        .get("event")
        .or_else(|| payload.get("hook"))
        .or_else(|| payload.get("hookEventName"))
        .or_else(|| payload.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("hook")
        .to_string();
    let status = normalize_status(
        payload.get("status").and_then(Value::as_str),
        &event_name,
        &payload,
    );
    let light_state = LightState {
        status,
        event: event_name,
        message: summarize(&payload),
        received_at: now_iso(),
        raw: payload,
    };

    let event_payload = {
        let mut data = state.lock().expect("state poisoned");
        data.current_state = light_state.clone();
        data.history.insert(0, light_state.clone());
        data.history.truncate(30);
        StatePayload {
            current_state: data.current_state.clone(),
            history: data.history.clone(),
            orientation: data.settings.orientation.as_str().to_string(),
            hooks_configured: has_cursor_hooks_config().unwrap_or(false),
        }
    };

    if let Some(app) = app {
        let _ = app.emit("hook-event", event_payload);
    }

    light_state
}

fn settings_path() -> PathBuf {
    dirs::data_local_dir()
        .unwrap_or_else(env::temp_dir)
        .join("Cursor Light")
        .join("settings.json")
}

fn load_settings() -> Settings {
    fs::read_to_string(settings_path())
        .ok()
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

fn hook_events() -> Vec<(&'static str, &'static str)> {
    vec![
        ("beforeSubmitPrompt", "yellow"),
        ("beforeShellExecution", "yellow"),
        ("beforeMCPExecution", "yellow"),
        ("afterAgentThought", "yellow"),
        ("afterShellExecution", "yellow"),
        ("afterFileEdit", "yellow"),
        ("afterAgentResponse", "green"),
        ("stop", "green"),
    ]
}

fn current_exe_path() -> Result<PathBuf, String> {
    env::current_exe().map_err(|error| error.to_string())
}

fn cursor_hooks_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Cannot resolve user home directory".to_string())?;
    Ok(home.join(".cursor").join("hooks.json"))
}

fn quote_for_command(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

fn hook_command(event_name: &str, status: &str) -> Result<String, String> {
    let exe = current_exe_path()?;
    Ok(format!(
        "{} --hook --event={} --status={}",
        quote_for_command(&exe.to_string_lossy()),
        event_name,
        status
    ))
}

fn read_cursor_hooks_config() -> Result<Value, String> {
    let path = cursor_hooks_path()?;
    if !path.exists() {
        return Ok(json!({ "version": 1, "hooks": {} }));
    }

    match fs::read_to_string(&path)
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok())
    {
        Some(mut config) => {
            if !config.get("hooks").map(Value::is_object).unwrap_or(false) {
                config["hooks"] = json!({});
            }
            if config.get("version").is_none() {
                config["version"] = json!(1);
            }
            Ok(config)
        }
        None => {
            let backup = path.with_extension(format!("invalid-{}.bak", now_iso()));
            fs::copy(&path, backup).map_err(|error| error.to_string())?;
            Ok(json!({ "version": 1, "hooks": {} }))
        }
    }
}

fn has_cursor_hooks_config() -> Result<bool, String> {
    let path = cursor_hooks_path()?;
    if !path.exists() {
        return Ok(false);
    }

    let config = read_cursor_hooks_config()?;
    let exe = current_exe_path()?.to_string_lossy().to_ascii_lowercase();
    let hooks = config
        .get("hooks")
        .and_then(Value::as_object)
        .ok_or_else(|| "Invalid hooks config".to_string())?;

    for (event, status) in hook_events() {
        let expected = hook_command(event, status)?.to_ascii_lowercase();
        let entries = hooks
            .get(event)
            .and_then(Value::as_array)
            .ok_or_else(|| "Missing hook event".to_string())?;
        let found = entries.iter().any(|entry| {
            entry
                .get("command")
                .and_then(Value::as_str)
                .map(|command| {
                    let command = command.to_ascii_lowercase();
                    command == expected || command.contains(&exe)
                })
                .unwrap_or(false)
        });

        if !found {
            return Ok(false);
        }
    }

    Ok(true)
}

fn configure_cursor_hooks_inner() -> Result<(), String> {
    let path = cursor_hooks_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let existed = path.exists();
    let mut config = read_cursor_hooks_config()?;

    if existed {
        fs::copy(&path, path.with_extension("json.bak")).map_err(|error| error.to_string())?;
    }

    for (event, status) in hook_events() {
        let command = hook_command(event, status)?;
        let hooks = config["hooks"]
            .as_object_mut()
            .ok_or_else(|| "Invalid hooks config".to_string())?;
        let entries = hooks.entry(event.to_string()).or_insert_with(|| json!([]));
        if !entries.is_array() {
            *entries = json!([]);
        }
        let array = entries.as_array_mut().expect("entries array");
        let exists = array
            .iter()
            .any(|entry| entry.get("command").and_then(Value::as_str) == Some(command.as_str()));
        if !exists {
            array.push(json!({ "command": command }));
        }
    }

    fs::write(
        path,
        format!(
            "{}\n",
            serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?
        ),
    )
    .map_err(|error| error.to_string())
}

fn widget_size(window: &WebviewWindow, orientation: &Orientation) -> Result<(u32, u32), String> {
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "Cannot resolve monitor".to_string())?;
    let size = monitor.size();
    let width = size.width;
    let height = size.height;
    Ok(match orientation {
        Orientation::Horizontal => ((width / 10).max(120), (height / 15).max(56)),
        Orientation::Vertical => ((width / 24).max(44), ((height as f64 / 5.5) as u32).max(180)),
    })
}

fn snap_window_inner(window: &WebviewWindow, state: &SharedState) -> Result<(), String> {
    let orientation = {
        state
            .lock()
            .map_err(|_| "state poisoned".to_string())?
            .settings
            .orientation
            .clone()
    };
    let monitor = window
        .current_monitor()
        .map_err(|error| error.to_string())?
        .or_else(|| window.primary_monitor().ok().flatten())
        .ok_or_else(|| "Cannot resolve monitor".to_string())?;
    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let (width, height) = widget_size(window, &orientation)?;
    let pos = window.outer_position().map_err(|error| error.to_string())?;

    let min_x = monitor_pos.x;
    let min_y = monitor_pos.y;
    let max_x = monitor_pos.x + monitor_size.width as i32 - width as i32;
    let max_y = monitor_pos.y + monitor_size.height as i32 - height as i32;

    let mut x = pos.x.clamp(min_x, max_x);
    let mut y = pos.y.clamp(min_y, max_y);

    if (x - min_x).abs() <= SNAP_DISTANCE {
        x = min_x;
    }
    if (y - min_y).abs() <= SNAP_DISTANCE {
        y = min_y;
    }
    if (x + width as i32 - (monitor_pos.x + monitor_size.width as i32)).abs() <= SNAP_DISTANCE {
        x = max_x;
    }
    if (y + height as i32 - (monitor_pos.y + monitor_size.height as i32)).abs() <= SNAP_DISTANCE {
        y = max_y;
    }

    window
        .set_size(Size::Physical(PhysicalSize { width, height }))
        .map_err(|error| error.to_string())?;
    window
        .set_position(Position::Physical(PhysicalPosition { x, y }))
        .map_err(|error| error.to_string())?;
    let _ = window.set_always_on_top(true);
    Ok(())
}

#[tauri::command]
fn get_state(state: tauri::State<'_, SharedState>) -> Result<StatePayload, String> {
    let data = state.lock().map_err(|_| "state poisoned".to_string())?;
    Ok(StatePayload {
        current_state: data.current_state.clone(),
        history: data.history.clone(),
        orientation: data.settings.orientation.as_str().to_string(),
        hooks_configured: has_cursor_hooks_config().unwrap_or(false),
    })
}

#[tauri::command]
fn set_orientation(
    orientation: String,
    window: WebviewWindow,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    let next = match orientation.as_str() {
        "horizontal" => Orientation::Horizontal,
        "vertical" => Orientation::Vertical,
        _ => return Err("Invalid orientation".to_string()),
    };

    {
        let mut data = state.lock().map_err(|_| "state poisoned".to_string())?;
        data.settings.orientation = next;
        save_settings(&data.settings)?;
        window
            .emit("orientation-changed", data.settings.orientation.as_str())
            .map_err(|error| error.to_string())?;
    }

    snap_window_inner(&window, &state)
}

#[tauri::command]
fn snap_window(window: WebviewWindow, state: tauri::State<'_, SharedState>) -> Result<(), String> {
    snap_window_inner(&window, &state)
}

#[tauri::command]
fn configure_cursor_hooks() -> Result<(), String> {
    configure_cursor_hooks_inner()
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn parse_args_payload(args: &[String]) -> Value {
    let mut payload = serde_json::Map::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if let Some(value) = arg.strip_prefix("--event=") {
            payload.insert("event".to_string(), json!(value));
        } else if let Some(value) = arg.strip_prefix("--status=") {
            payload.insert("status".to_string(), json!(value));
        } else if let Some(value) = arg.strip_prefix("--message=") {
            payload.insert("message".to_string(), json!(value));
        } else if arg == "--event" || arg == "--status" || arg == "--message" {
            if let Some(value) = args.get(i + 1) {
                payload.insert(arg.trim_start_matches("--").to_string(), json!(value));
                i += 1;
            }
        }
        i += 1;
    }
    Value::Object(payload)
}

fn send_hook_payload(payload: &Value) {
    if let Ok(mut stream) = TcpStream::connect((HOST, PORT)) {
        let body = payload.to_string();
        let request = format!(
            "POST /hook HTTP/1.1\r\nHost: {HOST}:{PORT}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(request.as_bytes());
        let _ = stream.flush();
    }
}

fn write_cursor_response(event_name: &str) {
    if event_name == "beforeSubmitPrompt" {
        println!("{}", json!({ "continue": true }));
    } else if event_name.starts_with("before") {
        println!("{}", json!({ "permission": "allow" }));
    } else if event_name == "stop" {
        println!("{}", json!({}));
    }
}

fn run_hook_cli(args: &[String]) {
    let payload = parse_args_payload(args);
    let event_name = payload
        .get("event")
        .and_then(Value::as_str)
        .unwrap_or("cursor-hook")
        .to_string();
    send_hook_payload(&payload);
    write_cursor_response(&event_name);
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(700)));
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            let text = String::from_utf8_lossy(&buffer).to_string();
            let content_length = text
                .lines()
                .find_map(|line| {
                    line.to_ascii_lowercase()
                        .strip_prefix("content-length:")
                        .and_then(|value| value.trim().parse::<usize>().ok())
                })
                .unwrap_or(0);
            let header_end = text.find("\r\n\r\n").map(|idx| idx + 4)?;
            while buffer.len() < header_end + content_length {
                let read = stream.read(&mut chunk).ok()?;
                if read == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..read]);
            }
            let full = String::from_utf8_lossy(&buffer).to_string();
            let mut lines = full.lines();
            let first = lines.next()?.to_string();
            let body = full
                .find("\r\n\r\n")
                .map(|idx| full[(idx + 4)..].to_string())
                .unwrap_or_default();
            let parts: Vec<_> = first.split_whitespace().collect();
            return Some((
                parts.get(0).unwrap_or(&"").to_string(),
                parts.get(1).unwrap_or(&"").to_string(),
                body,
            ));
        }
    }
    None
}

fn write_http_json(stream: &mut TcpStream, status: &str, body: Value) {
    let body = body.to_string();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn start_http_server(app: tauri::AppHandle, state: SharedState) {
    thread::spawn(move || {
        let listener = match TcpListener::bind((HOST, PORT)) {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("Cursor Light hook receiver failed: {error}");
                return;
            }
        };

        for stream in listener.incoming() {
            let Ok(mut stream) = stream else {
                continue;
            };
            let app = app.clone();
            let state = state.clone();
            thread::spawn(move || {
                let Some((method, path, body)) = read_http_request(&mut stream) else {
                    write_http_json(&mut stream, "400 Bad Request", json!({ "ok": false }));
                    return;
                };

                if method == "GET" && path == "/state" {
                    if let Ok(data) = state.lock() {
                        write_http_json(
                            &mut stream,
                            "200 OK",
                            json!({
                                "currentState": data.current_state,
                                "history": data.history,
                                "orientation": data.settings.orientation.as_str()
                            }),
                        );
                    }
                    return;
                }

                if method != "POST" || path != "/hook" {
                    write_http_json(&mut stream, "404 Not Found", json!({ "ok": false }));
                    return;
                }

                let payload = serde_json::from_str::<Value>(&body)
                    .unwrap_or_else(|_| json!({ "message": body }));
                let light_state = push_event(Some(&app), &state, payload);
                write_http_json(
                    &mut stream,
                    "200 OK",
                    json!({ "ok": true, "state": light_state }),
                );
            });
        }
    });
}

fn build_state() -> SharedState {
    Arc::new(Mutex::new(AppData {
        current_state: default_light_state(),
        history: Vec::new(),
        settings: load_settings(),
    }))
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.iter().any(|arg| arg == "--hook") {
        run_hook_cli(&args[1..]);
        return;
    }

    let state = build_state();
    let managed_state = state.clone();

    tauri::Builder::default()
        .manage(managed_state)
        .invoke_handler(tauri::generate_handler![
            get_state,
            set_orientation,
            snap_window,
            configure_cursor_hooks,
            quit_app
        ])
        .setup(move |app| {
            let window = app
                .get_webview_window("main")
                .ok_or("main window missing")?;
            let _ = window.set_always_on_top(true);
            let app_handle = app.handle().clone();
            start_http_server(app_handle, state.clone());
            let _ = snap_window_inner(&window, &state);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Cursor Light");
}
