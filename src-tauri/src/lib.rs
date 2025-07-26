use serde::{Deserialize, Serialize};
use serde_json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio, Child};
use std::sync::{Arc, Mutex};
use tauri::{State, AppHandle, Emitter, Manager};
use uuid::Uuid;
use std::io::{BufRead, BufReader};
use std::thread;
use axum::{routing::post, Router};
use tower_http::cors::CorsLayer;

mod mcp_manager;
use mcp_manager::{McpManager, ApprovalRequest, ApprovalResponse, HttpAppState};

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_extended;

#[cfg(test)]
mod approval_tests;

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

#[derive(Debug, Serialize, Deserialize, Clone)]
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
                            
                            // Collect text content and tool result summaries
                            for item in content_array {
                                if let Some(item_type) = item.get("type").and_then(|t| t.as_str()) {
                                    if item_type == "text" {
                                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                                            if !text.trim().is_empty() {
                                                text_results.push(text.to_string());
                                            }
                                        }
                                    } else if item_type == "tool_result" {
                                        // Include tool results to show what tools accomplished
                                        if let Some(content) = item.get("content") {
                                            if let Some(content_array) = content.as_array() {
                                                for result_item in content_array {
                                                    if let Some(result_text) = result_item.get("text").and_then(|t| t.as_str()) {
                                                        if !result_text.trim().is_empty() {
                                                            // Add a brief prefix to indicate this is a tool result
                                                            text_results.push(format!("Tool result: {}", result_text.trim()));
                                                        }
                                                    }
                                                }
                                            } else if let Some(result_text) = content.get("text").and_then(|t| t.as_str()) {
                                                if !result_text.trim().is_empty() {
                                                    text_results.push(format!("Tool result: {}", result_text.trim()));
                                                }
                                            }
                                        }
                                    }
                                    // Still skip tool_use items to avoid "Using..." messages
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

pub struct AppState {
    pub worktrees: Mutex<HashMap<String, WorktreeConfig>>,
    pub processes: Mutex<HashMap<String, ClaudeProcess>>,
    pub running_processes: Mutex<HashMap<String, Arc<Mutex<Option<Child>>>>>,
    pub mcp_manager: McpManager,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            worktrees: Mutex::new(HashMap::new()),
            processes: Mutex::new(HashMap::new()),
            running_processes: Mutex::new(HashMap::new()),
            mcp_manager: McpManager::new(),
        }
    }
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
    eprintln!("🔧 Permission mode: {:?}", permission_mode);
    match permission_mode.as_deref().unwrap_or("safe") {
        "full" => {
            cmd.arg("--dangerously-skip-permissions");
        }
        "mcp" => {
            // Connect to our MCP server for this worktree
            // We need to find the server path for this worktree
            eprintln!("🔍 Looking for MCP server for worktree: {}", worktree_id);
            let servers = state.mcp_manager.list_servers().await;
            eprintln!("🔍 Available MCP servers: {:?}", servers);
            let server_for_worktree = servers.iter().find(|s| s.worktree_id == worktree_id);
            
            if let Some(server_config) = server_for_worktree {
                // Create MCP config JSON for Claude Code
                let mcp_config = serde_json::json!({
                    "mcpServers": {
                        "orchestra-worktree": {
                            "command": "node",
                            "args": [server_config.server_path],
                            "env": {
                                "WORKTREE_PATH": worktree_path,
                                "WORKTREE_ID": worktree_id
                            }
                        }
                    }
                });
                
                // Write config to temporary file
                let config_file = format!("/tmp/mcp_config_{}.json", worktree_id);
                if let Err(e) = std::fs::write(&config_file, mcp_config.to_string()) {
                    eprintln!("Failed to write MCP config: {}", e);
                    cmd.arg("--permission-mode").arg("acceptEdits");
                } else {
                    cmd.arg("--mcp-config").arg(&config_file)
                        .arg("--permission-prompt-tool")
                        .arg("mcp__orchestra-worktree__approval_prompt");
                    eprintln!("🔗 Connecting Claude to MCP server: {} using config: {} with permission tool", 
                        server_config.server_id, config_file);
                }
            } else {
                eprintln!("⚠️  No MCP server found for worktree {}, falling back to safe mode", worktree_id);
                cmd.arg("--permission-mode").arg("acceptEdits");
            }
        }
        _ => {
            cmd.arg("--permission-mode").arg("acceptEdits");
        }
    }
    
    let child = cmd
        .arg(&user_message)
        .current_dir(&worktree_path)
        .env("APPROVAL_ENDPOINT", "http://localhost:8080/api/approval-request")
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitWorktreeInfo {
    pub path: String,
    pub branch: String,
    pub is_main: bool,
    pub is_bare: bool,
    pub is_detached: bool,
}

#[tauri::command]
async fn validate_git_repo(repo_path: String) -> Result<String, String> {
    // Check if directory exists
    if !std::path::Path::new(&repo_path).exists() {
        return Err("Directory does not exist".to_string());
    }
    
    if !std::path::Path::new(&repo_path).is_dir() {
        return Err("Path is not a directory".to_string());
    }

    // Check if it's a git repository
    let output = Command::new("git")
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .current_dir(&repo_path)
        .output()
        .map_err(|_| "Not a git repository".to_string())?;

    if !output.status.success() {
        return Err("Not a git repository".to_string());
    }

    // Check if we can access worktrees
    let worktree_output = Command::new("git")
        .arg("worktree")
        .arg("list")
        .current_dir(&repo_path)
        .output()
        .map_err(|_| "Failed to access git worktrees".to_string())?;

    if !worktree_output.status.success() {
        return Err("Failed to access git worktrees".to_string());
    }

    Ok("Valid git repository".to_string())
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
async fn check_worktree_status(
    worktree_path: String,
) -> Result<(bool, bool), String> {
    // First check if worktree has uncommitted changes
    let status_output = Command::new("git")
        .arg("status")
        .arg("--porcelain")
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to check worktree status: {}", e))?;

    if !status_output.status.success() {
        return Err(format!(
            "Failed to check worktree status: {}",
            String::from_utf8_lossy(&status_output.stderr)
        ));
    }

    let has_changes = !status_output.stdout.is_empty();
    
    // Check if branch has unpushed commits
    let branch_status = Command::new("git")
        .args(&["log", "@{u}..", "--oneline"])
        .current_dir(&worktree_path)
        .output();

    let has_unpushed = match branch_status {
        Ok(output) => !output.stdout.is_empty(),
        Err(_) => {
            // If we can't check upstream, assume no unpushed commits
            // This handles cases where there's no upstream branch set
            false
        }
    };

    Ok((has_changes, has_unpushed))
}

#[tauri::command]
async fn remove_worktree(
    state: State<'_, AppState>,
    worktree_path: String,
    repo_path: String,
    force: Option<bool>,
) -> Result<(), String> {
    // First check if worktree has uncommitted changes
    let status_output = Command::new("git")
        .arg("status")
        .arg("--porcelain")
        .current_dir(&worktree_path)
        .output()
        .map_err(|e| format!("Failed to check worktree status: {}", e))?;

    if !status_output.status.success() {
        return Err(format!(
            "Failed to check worktree status: {}",
            String::from_utf8_lossy(&status_output.stderr)
        ));
    }

    let has_changes = !status_output.stdout.is_empty();
    
    // Check if branch has unpushed commits
    let branch_status = Command::new("git")
        .args(&["log", "@{u}..", "--oneline"])
        .current_dir(&worktree_path)
        .output();

    let has_unpushed = match branch_status {
        Ok(output) => !output.stdout.is_empty(),
        Err(_) => {
            // If we can't check upstream, assume no unpushed commits
            // This handles cases where there's no upstream branch set
            false
        }
    };

    if (has_changes || has_unpushed) && !force.unwrap_or(false) {
        let mut errors = Vec::new();
        if has_changes {
            errors.push("uncommitted changes");
        }
        if has_unpushed {
            errors.push("unpushed commits");
        }
        return Err(format!(
            "Cannot remove worktree: it has {}. Use force option to remove anyway.",
            errors.join(" and ")
        ));
    }

    // Get the branch name associated with this worktree before deletion
    let branch_output = Command::new("git")
        .args(&["branch", "--show-current"])
        .current_dir(&worktree_path)
        .output();
    
    let branch_name = if let Ok(output) = branch_output {
        if output.status.success() {
            let branch_name = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !branch_name.is_empty() && branch_name != "main" && branch_name != "master" {
                Some(branch_name)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    // Remove the worktree
    let mut remove_cmd = Command::new("git");
    remove_cmd
        .arg("worktree")
        .arg("remove");
    
    if force.unwrap_or(false) {
        remove_cmd.arg("--force");
    }
    
    remove_cmd.arg(&worktree_path);
    
    let output = remove_cmd
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to remove worktree: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Git worktree remove failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Delete the branch if we found one and it's not a main branch
    if let Some(branch) = branch_name {
        let delete_branch_output = Command::new("git")
            .args(&["branch", "-D", &branch])
            .current_dir(&repo_path)
            .output();
        
        if let Ok(output) = delete_branch_output {
            if !output.status.success() {
                eprintln!("Warning: Failed to delete branch '{}': {}", 
                    branch, String::from_utf8_lossy(&output.stderr));
            }
        }
    }

    // Also remove from backend state if it exists (for worktrees created via backend)
    let mut worktrees = state.worktrees.lock().unwrap();
    let worktree_to_remove = worktrees.iter()
        .find(|(_, wt)| wt.path == worktree_path)
        .map(|(id, _)| id.clone());
    
    if let Some(id) = worktree_to_remove {
        worktrees.remove(&id);
    }

    Ok(())
}

// MCP Server Commands

#[tauri::command]
async fn create_mcp_server(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    worktree_id: String,
    worktree_path: String,
) -> Result<String, String> {
    state.mcp_manager.create_server(worktree_id, worktree_path, app_handle).await
}

#[tauri::command]
async fn stop_mcp_server(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<(), String> {
    state.mcp_manager.stop_server(&server_id).await
}

#[tauri::command]
async fn list_mcp_servers(
    state: State<'_, AppState>,
) -> Result<Vec<mcp_manager::McpServerConfig>, String> {
    Ok(state.mcp_manager.list_servers().await)
}

#[tauri::command]
async fn get_mcp_server_status(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<bool, String> {
    state.mcp_manager.get_server_status(&server_id).await
        .ok_or_else(|| "Server not found".to_string())
}

#[tauri::command]
async fn request_tool_approval(
    state: State<'_, AppState>,
    request: ApprovalRequest,
) -> Result<String, String> {
    state.mcp_manager.request_approval(request).await
}

#[tauri::command]
async fn respond_to_approval(
    state: State<'_, AppState>,
    approval_id: String,
    response: ApprovalResponse,
) -> Result<(), String> {
    state.mcp_manager.respond_to_approval(approval_id, response).await
}

#[tauri::command]
async fn get_pending_approvals(
    state: State<'_, AppState>,
) -> Result<Vec<(String, ApprovalRequest)>, String> {
    Ok(state.mcp_manager.get_pending_approvals().await)
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Clone data we need from state before spawning
            let pending_http_approvals = {
                let state = app.state::<AppState>();
                state.mcp_manager.pending_http_approvals.clone()
            };
            
            tauri::async_runtime::spawn(async move {
                // Create a new state that includes the app handle
                let app_state = HttpAppState {
                    pending_http_approvals,
                    app_handle: Some(app_handle),
                };
                
                // Start HTTP server
                let app = Router::new()
                    .route("/api/approval-request", post(crate::mcp_manager::handle_approval_request))
                    .layer(CorsLayer::permissive())
                    .with_state(app_state);

                eprintln!("🌐 RUST: Starting HTTP server on http://localhost:8080");
                
                let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
                    .await
                    .expect("Failed to bind to port 8080");
                
                eprintln!("🟢 RUST: HTTP server listening on http://localhost:8080");
                
                axum::serve(listener, app)
                    .await
                    .expect("HTTP server failed");
            });
            
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            create_worktree,
            list_worktrees,
            validate_git_repo,
            list_git_worktrees,
            start_claude_process,
            send_message_to_claude,
            stop_claude_process,
            list_processes,
            check_worktree_status,
            remove_worktree,
            // MCP Server commands
            create_mcp_server,
            stop_mcp_server,
            list_mcp_servers,
            get_mcp_server_status,
            request_tool_approval,
            respond_to_approval,
            get_pending_approvals
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
