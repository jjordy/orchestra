use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio, Child};
use std::sync::{Arc, Mutex};
use tauri::{State, AppHandle, Emitter};
use uuid::Uuid;
use std::io::{BufRead, BufReader, Write, Read};
use std::thread;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};

#[cfg(test)]
mod tests;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorktreeConfig {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: String,
    pub base_repo: String,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ClaudeProcess {
    pub id: String,
    pub worktree_id: String,
    pub pid: Option<u32>,
    pub status: String, // 'idle' | 'running' | 'stopped' | 'error'
    pub task: Option<String>,
    pub started_at: Option<String>,
    pub last_activity: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProcessOutput {
    pub process_id: String,
    pub content: String,
    pub is_error: bool,
    pub timestamp: String,
}


fn parse_claude_json_line(line: &str) -> Option<String> {
    match serde_json::from_str::<serde_json::Value>(line) {
        Ok(json) => {
            let message_type = json.get("type")?.as_str()?;
            
            match message_type {
                "system" => {
                    // System initialization - skip but could show basic info
                    None
                }
                "user" => {
                    // User messages - skip echoes
                    None
                }
                "assistant" => {
                    // Assistant messages contain the actual tool uses and responses
                    if let Some(message) = json.get("message") {
                        if let Some(content_array) = message.get("content").and_then(|c| c.as_array()) {
                            let mut text_results = Vec::new();
                            
                            // Collect only text content, skip tool usage indicators
                            for item in content_array {
                                if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                                    if item_type == "text" {
                                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                            if !text.trim().is_empty() {
                                                text_results.push(text.to_string());
                                            }
                                        }
                                    }
                                    // Skip tool_use items entirely - don't show "Using..." messages
                                }
                            }
                            
                            // Only show text content
                            if !text_results.is_empty() {
                                let result = text_results.join("\n");
                                eprintln!("FINAL RESPONSE: {}", result);
                                Some(result)
                            } else {
                                None
                            }
                        } else if let Some(content) = message.get("content").and_then(|c| c.as_str()) {
                            // Handle cases where content is a direct string
                            if !content.trim().is_empty() {
                                Some(content.to_string())
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
                "result" => {
                    // This indicates Claude is done, don't show the result content as it's usually a duplicate
                    None
                }
                _ => {
                    // Unknown types - skip for now
                    None
                }
            }
        }
        Err(_) => {
            // If it's not valid JSON, treat as plain text
            if !line.trim().is_empty() {
                Some(line.to_string())
            } else {
                None
            }
        }
    }
}

#[derive(Default)]
pub struct AppState {
    pub worktrees: Mutex<HashMap<String, WorktreeConfig>>,
    pub processes: Mutex<HashMap<String, ClaudeProcess>>,
    pub running_processes: Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>,
    pub pty_sessions: Mutex<HashMap<String, Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>>>,
    pub pty_writers: Mutex<HashMap<String, Arc<Mutex<Box<dyn std::io::Write + Send>>>>>,
}

#[tauri::command]
async fn create_worktree(
    state: State<'_, AppState>,
    repo_path: String,
    branch_name: String,
    worktree_name: String,
) -> Result<WorktreeConfig, String> {
    let worktree_path = PathBuf::from(&repo_path)
        .parent()
        .ok_or("Invalid repo path")?
        .join(format!("worktree-{}", worktree_name));

    let output = Command::new("git")
        .arg("worktree")
        .arg("add")
        .arg("-b")
        .arg(&branch_name)
        .arg(&worktree_path)
        .arg("HEAD")
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to create worktree: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Git worktree command failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let worktree = WorktreeConfig {
        id: Uuid::new_v4().to_string(),
        name: worktree_name,
        path: worktree_path.to_string_lossy().to_string(),
        branch: branch_name,
        base_repo: repo_path,
        is_active: true,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    state
        .worktrees
        .lock()
        .unwrap()
        .insert(worktree.id.clone(), worktree.clone());

    Ok(worktree)
}

#[tauri::command]
async fn list_worktrees(state: State<'_, AppState>) -> Result<Vec<WorktreeConfig>, String> {
    let worktrees = state.worktrees.lock().unwrap();
    Ok(worktrees.values().cloned().collect())
}

#[tauri::command]
async fn start_claude_process(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    worktree_path: String,
    worktree_id: String,
    user_message: String,
    permission_mode: Option<String>,
) -> Result<ClaudeProcess, String> {
    let process_id = Uuid::new_v4().to_string();
    
    // Create the Claude process record
    let mut claude_process = ClaudeProcess {
        id: process_id.clone(),
        worktree_id: worktree_id.clone(),
        pid: None,
        status: "starting".to_string(),
        task: Some(user_message.clone()),
        started_at: Some(chrono::Utc::now().to_rfc3339()),
        last_activity: Some(chrono::Utc::now().to_rfc3339()),
    };

    // Spawn Claude Code process with print mode and stream-json output
    let mut cmd = Command::new("claude");
    cmd.arg("--print")
        .arg("--verbose")
        .arg("--output-format")
        .arg("stream-json");
    
    // Set permission mode based on user preference
    match permission_mode.as_deref().unwrap_or("safe") {
        "full" => {
            cmd.arg("--dangerously-skip-permissions");
        }
        _ => {
            cmd.arg("--permission-mode").arg("acceptEdits");
        }
    }
    
    let child = cmd
        .arg(&user_message)
        .current_dir(&worktree_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start Claude Code: {}. Make sure 'claude' is installed and in PATH.", e))?;

    claude_process.pid = Some(child.id());
    claude_process.status = "running".to_string();
    
    eprintln!("CREATED CLAUDE PROCESS: ID={}, WorktreeID={}, PID={:?}", 
        claude_process.id, claude_process.worktree_id, claude_process.pid);

    // Store the child process
    let child_arc = Arc::new(Mutex::new(Some(child)));
    state
        .running_processes
        .lock()
        .unwrap()
        .insert(process_id.clone(), child_arc.clone());

    // Store the process info
    state
        .processes
        .lock()
        .unwrap()
        .insert(process_id.clone(), claude_process.clone());

    // Handle the child process in a thread
    let process_id_clone = process_id.clone();
    let app_handle_clone = app_handle.clone();
    
    // Create completion_sent at the right scope level
    let completion_sent = Arc::new(std::sync::atomic::AtomicBool::new(false));
    
    thread::spawn(move || {
        let child_opt = {
            let mut guard = child_arc.lock().unwrap();
            guard.take()
        };
        
        if let Some(mut child) = child_opt {
            // Take stdout and stderr
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            // Stream stdout
            if let Some(stdout) = stdout {
                let reader = BufReader::new(stdout);
                let process_id_stdout = process_id_clone.clone();
                let app_handle_stdout = app_handle_clone.clone();
                
                let completion_sent_clone = completion_sent.clone();
                
                thread::spawn(move || {
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            // Check if this is a result line (indicates completion)
                            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
                                if let Some(msg_type) = json.get("type").and_then(|t| t.as_str()) {
                                    if msg_type == "result" {
                                        // Only emit completion once
                                        if !completion_sent_clone.swap(true, std::sync::atomic::Ordering::SeqCst) {
                                            eprintln!("COMPLETION: Process {} finished", process_id_stdout);
                                            let _ = app_handle_stdout.emit("claude-completed", &serde_json::json!({
                                                "process_id": process_id_stdout,
                                                "success": true
                                            }));
                                        }
                                        continue;
                                    }
                                }
                            }
                            
                            // Parse Claude's JSON output and extract meaningful content
                            if let Some(parsed_content) = parse_claude_json_line(&line) {
                                let output = ProcessOutput {
                                    process_id: process_id_stdout.clone(),
                                    content: parsed_content,
                                    is_error: false,
                                    timestamp: chrono::Utc::now().to_rfc3339(),
                                };
                                eprintln!("EMITTING CLAUDE-OUTPUT: Process={}, Content={}", output.process_id, output.content);
                                let _ = app_handle_stdout.emit("claude-output", &output);
                            }
                        }
                    }
                });
            }

            // Stream stderr
            if let Some(stderr) = stderr {
                let reader = BufReader::new(stderr);
                let process_id_stderr = process_id_clone.clone();
                let app_handle_stderr = app_handle_clone.clone();
                
                thread::spawn(move || {
                    for line in reader.lines() {
                        if let Ok(line) = line {
                            let output = ProcessOutput {
                                process_id: process_id_stderr.clone(),
                                content: line,
                                is_error: true,
                                timestamp: chrono::Utc::now().to_rfc3339(),
                            };
                            let _ = app_handle_stderr.emit("claude-output", &output);
                        }
                    }
                });
            }

            // Wait for process completion
            let process_id_wait = process_id_clone;
            let app_handle_wait = app_handle_clone;
            let completion_sent_wait = completion_sent;
            
            thread::spawn(move || {
                match child.wait() {
                    Ok(status) => {
                        eprintln!("PROCESS WAIT: Process {} exited with status: {:?}", process_id_wait, status);
                        // Only emit completion events for errors, not successful completion
                        if !status.success() {
                            let completion_output = ProcessOutput {
                                process_id: process_id_wait.clone(),
                                content: format!("Process exited with code: {:?}", status.code()),
                                is_error: true,
                                timestamp: chrono::Utc::now().to_rfc3339(),
                            };
                            let _ = app_handle_wait.emit("claude-output", &completion_output);
                        }
                        // Only emit fallback completion if primary completion wasn't sent
                        if !completion_sent_wait.load(std::sync::atomic::Ordering::SeqCst) {
                            eprintln!("FALLBACK COMPLETION: Emitting completion for process {}", process_id_wait);
                            let _ = app_handle_wait.emit("claude-completed", &serde_json::json!({
                                "process_id": process_id_wait,
                                "success": status.success()
                            }));
                        } else {
                            eprintln!("SKIPPING FALLBACK: Primary completion already sent for process {}", process_id_wait);
                        }
                    }
                    Err(e) => {
                        eprintln!("PROCESS ERROR: Process {} failed: {}", process_id_wait, e);
                        let completion_output = ProcessOutput {
                            process_id: process_id_wait.clone(),
                            content: format!("Process error: {}", e),
                            is_error: true,
                            timestamp: chrono::Utc::now().to_rfc3339(),
                        };
                        let _ = app_handle_wait.emit("claude-output", &completion_output);
                        // Always emit completion for errors
                        let _ = app_handle_wait.emit("claude-completed", &serde_json::json!({
                            "process_id": process_id_wait,
                            "success": false
                        }));
                    }
                }
            });
        }
    });

    Ok(claude_process)
}

#[tauri::command]
async fn send_message_to_claude(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    worktree_path: String,
    worktree_id: String,
    message: String,
    permission_mode: Option<String>,
) -> Result<(), String> {
    // For additional messages, we spawn a new Claude process
    // since --print mode exits after one response
    let _process = start_claude_process(app_handle, state, worktree_path, worktree_id, message, permission_mode).await?;
    Ok(())
}

#[tauri::command]
async fn stop_claude_process(
    state: State<'_, AppState>,
    process_id: String,
) -> Result<(), String> {
    let mut running_processes = state.running_processes.lock().unwrap();
    if let Some(child_arc) = running_processes.remove(&process_id) {
        if let Ok(mut child_guard) = child_arc.lock() {
            if let Some(mut child) = child_guard.take() {
                let _ = child.kill();
            }
        }
    }

    // Update process status
    let mut processes = state.processes.lock().unwrap();
    if let Some(process) = processes.get_mut(&process_id) {
        process.status = "stopped".to_string();
    }

    Ok(())
}

#[tauri::command]
async fn list_processes(state: State<'_, AppState>) -> Result<Vec<ClaudeProcess>, String> {
    let processes = state.processes.lock().unwrap();
    Ok(processes.values().cloned().collect())
}

#[derive(Debug, Serialize, Clone)]
pub struct GitWorktreeInfo {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
    pub is_bare: bool,
    pub is_detached: bool,
}

#[tauri::command]
async fn list_git_worktrees(repo_path: String) -> Result<Vec<GitWorktreeInfo>, String> {
    let output = Command::new("git")
        .arg("worktree")
        .arg("list")
        .arg("--porcelain")
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to list git worktrees: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Git worktree list failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let output_str = String::from_utf8_lossy(&output.stdout);
    let mut worktrees = Vec::new();
    let mut current_worktree: Option<GitWorktreeInfo> = None;
    
    for line in output_str.lines() {
        if line.starts_with("worktree ") {
            // Save previous worktree if exists
            if let Some(wt) = current_worktree.take() {
                worktrees.push(wt);
            }
            
            let path = line.strip_prefix("worktree ").unwrap_or("").to_string();
            current_worktree = Some(GitWorktreeInfo {
                path,
                branch: "unknown".to_string(),
                is_main: false,
                is_bare: false,
                is_detached: false,
            });
        } else if line.starts_with("branch ") {
            if let Some(ref mut wt) = current_worktree {
                let branch = line.strip_prefix("branch ").unwrap_or("unknown");
                wt.branch = branch.to_string();
            }
        } else if line == "bare" {
            if let Some(ref mut wt) = current_worktree {
                wt.is_bare = true;
            }
        } else if line == "detached" {
            if let Some(ref mut wt) = current_worktree {
                wt.is_detached = true;
                wt.branch = "HEAD (detached)".to_string();
            }
        }
    }
    
    // Add the last worktree
    if let Some(wt) = current_worktree {
        worktrees.push(wt);
    }

    // Mark the main repo (usually the first one that matches the repo_path)
    for worktree in &mut worktrees {
        if worktree.path == repo_path {
            worktree.is_main = true;
            break;
        }
    }

    Ok(worktrees)
}

#[tauri::command]
async fn remove_worktree(
    state: State<'_, AppState>,
    worktree_id: String,
) -> Result<(), String> {
    let mut worktrees = state.worktrees.lock().unwrap();
    let worktree = worktrees
        .get(&worktree_id)
        .ok_or("Worktree not found")?
        .clone();

    let output = Command::new("git")
        .arg("worktree")
        .arg("remove")
        .arg("--force")
        .arg(&worktree.path)
        .current_dir(&worktree.base_repo)
        .output()
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Git worktree remove failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    worktrees.remove(&worktree_id);
    Ok(())
}

// PTY Terminal Commands

#[tauri::command]
async fn create_worktree_pty(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    pty_id: String,
    working_dir: String,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    
    // Check if PTY with this ID already exists
    {
        let sessions = state.pty_sessions.lock().unwrap();
        if sessions.contains_key(&pty_id) {
            eprintln!("PTY {}: Already exists, reusing existing session", pty_id);
            // Return a special indicator that this is an existing session
            return Ok(format!("existing:{}", pty_id));
        }
    }
    
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    // Get the default shell - cross-platform
    let shell = if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };
    
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(working_dir.clone());
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Store the child process
    let child_arc = Arc::new(Mutex::new(Some(child)));
    state
        .pty_sessions
        .lock()
        .unwrap()
        .insert(pty_id.clone(), child_arc);

    // Get a writer from the master PTY
    let writer = pty_pair.master.take_writer().map_err(|e| format!("Failed to get writer: {}", e))?;
    let writer_arc: Arc<Mutex<Box<dyn std::io::Write + Send>>> = Arc::new(Mutex::new(writer));
    
    // Store the writer for later use
    state
        .pty_writers
        .lock()
        .unwrap()
        .insert(pty_id.clone(), writer_arc.clone());

    // Shell starts in the correct working directory via CommandBuilder::cwd()
    eprintln!("PTY {}: Created shell in working directory: {}", pty_id, working_dir);

    // Handle PTY output in a separate thread
    let pty_id_clone = pty_id.clone();
    let app_handle_clone = app_handle.clone();
    let mut reader = pty_pair.master.try_clone_reader().map_err(|e| format!("Failed to clone reader: {}", e))?;
    
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    eprintln!("PTY {}: EOF reached", pty_id_clone);
                    break;
                }
                Ok(n) => {
                    let output = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_handle_clone.emit(&format!("pty-output-{}", pty_id_clone), output);
                }
                Err(e) => {
                    eprintln!("PTY {}: Read error: {}", pty_id_clone, e);
                    break;
                }
            }
        }
        
        // Signal that PTY is closed - cleanup will be handled by close_pty command
        let _ = app_handle_clone.emit(&format!("pty-closed-{}", pty_id_clone), ());
    });

    eprintln!("PTY {}: Created for worktree at {}", pty_id, working_dir);
    Ok(pty_id)
}

#[tauri::command]
async fn create_pty(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    working_dir: String,
) -> Result<String, String> {
    let pty_system = native_pty_system();
    let pty_id = Uuid::new_v4().to_string();
    
    let pty_pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to create PTY: {}", e))?;

    // Get the default shell - cross-platform
    let shell = if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
    };
    
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(working_dir.clone());
    let child = pty_pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn shell: {}", e))?;

    // Store the child process
    let child_arc = Arc::new(Mutex::new(Some(child)));
    state
        .pty_sessions
        .lock()
        .unwrap()
        .insert(pty_id.clone(), child_arc);

    // Get a writer from the master PTY
    let writer = pty_pair.master.take_writer().map_err(|e| format!("Failed to get writer: {}", e))?;
    let writer_arc: Arc<Mutex<Box<dyn std::io::Write + Send>>> = Arc::new(Mutex::new(writer));
    
    // Store the writer for later use
    state
        .pty_writers
        .lock()
        .unwrap()
        .insert(pty_id.clone(), writer_arc.clone());

    // Shell starts in the correct working directory via CommandBuilder::cwd()
    eprintln!("PTY {}: Created shell in working directory: {}", pty_id, working_dir);

    // Handle PTY output in a separate thread
    let pty_id_clone = pty_id.clone();
    let app_handle_clone = app_handle.clone();
    let mut reader = pty_pair.master.try_clone_reader().map_err(|e| format!("Failed to clone reader: {}", e))?;
    
    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    eprintln!("PTY {}: EOF reached", pty_id_clone);
                    break;
                }
                Ok(n) => {
                    let output = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_handle_clone.emit(&format!("pty-output-{}", pty_id_clone), output);
                }
                Err(e) => {
                    eprintln!("PTY {}: Read error: {}", pty_id_clone, e);
                    break;
                }
            }
        }
        
        // Signal that PTY is closed - cleanup will be handled by close_pty command
        let _ = app_handle_clone.emit(&format!("pty-closed-{}", pty_id_clone), ());
    });

    Ok(pty_id)
}

#[tauri::command] 
async fn write_to_pty(
    state: State<'_, AppState>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    eprintln!("PTY {}: Writing data: {:?}", pty_id, data);
    let writers = state.pty_writers.lock().unwrap();
    
    if let Some(writer_arc) = writers.get(&pty_id) {
        let mut writer = writer_arc.lock().unwrap();
        writer.write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to PTY: {}", e))?;
        writer.flush()
            .map_err(|e| format!("Failed to flush PTY: {}", e))?;
        eprintln!("PTY {}: Write successful", pty_id);
        Ok(())
    } else {
        eprintln!("PTY {}: Session not found", pty_id);
        Err(format!("PTY session {} not found", pty_id))
    }
}

#[tauri::command]
async fn resize_pty(
    _state: State<'_, AppState>,
    _pty_id: String,
    _cols: u16,
    _rows: u16,
) -> Result<(), String> {
    // Note: Resize functionality would require storing the master PTY
    // For now, we'll skip resize functionality to keep the implementation simple
    Ok(())
}

#[tauri::command]
async fn close_pty(
    state: State<'_, AppState>,
    pty_id: String,
) -> Result<(), String> {
    // Clean up child process
    {
        let mut sessions = state.pty_sessions.lock().unwrap();
        if let Some(child_arc) = sessions.remove(&pty_id) {
            if let Ok(mut child_guard) = child_arc.lock() {
                if let Some(mut child) = child_guard.take() {
                    let _ = child.kill();
                }
            }
        }
    }
    
    // Clean up writer
    {
        let mut writers = state.pty_writers.lock().unwrap();
        writers.remove(&pty_id);
    }
    
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            create_worktree,
            list_worktrees,
            list_git_worktrees,
            start_claude_process,
            send_message_to_claude,
            stop_claude_process,
            list_processes,
            remove_worktree,
            create_pty,
            create_worktree_pty,
            write_to_pty,
            resize_pty,
            close_pty
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
