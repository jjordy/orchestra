use axum::{extract::State, http::StatusCode, response::Json, routing::post, Router};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub server_id: String,
    pub worktree_id: String,
    pub worktree_path: String,
    pub server_path: String,
    pub port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub tool_name: String,
    pub input: serde_json::Value,
    pub worktree_id: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ApprovalBehavior {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalResponse {
    pub behavior: ApprovalBehavior,
    pub message: Option<String>,
    #[serde(rename = "updatedInput")]
    pub updated_input: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpApprovalRequest {
    #[serde(rename = "requestId")]
    pub request_id: String,
    #[serde(rename = "toolName")]
    pub tool_name: String,
    pub input: serde_json::Value,
    #[serde(rename = "worktreeId")]
    pub worktree_id: String,
    pub timestamp: u64,
}

// Structure to hold pending HTTP approval with response channel
pub struct PendingHttpApproval {
    pub request: HttpApprovalRequest,
    pub response_tx: oneshot::Sender<ApprovalResponse>,
}

// State for the HTTP server
#[derive(Clone)]
pub struct HttpAppState {
    pub pending_http_approvals: Arc<Mutex<HashMap<String, PendingHttpApproval>>>,
    pub app_handle: Option<AppHandle>,
}

// HTTP handler for approval requests
pub async fn handle_approval_request(
    State(state): State<HttpAppState>,
    Json(request): Json<HttpApprovalRequest>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    eprintln!(
        "🔵 RUST HTTP: Received approval request for tool: {}",
        request.tool_name
    );
    eprintln!("🔵 RUST HTTP: Request ID: {}", request.request_id);
    eprintln!("🔵 RUST HTTP: Worktree ID: {}", request.worktree_id);

    // Create a oneshot channel to wait for user response
    let (response_tx, response_rx) = oneshot::channel();

    // Store the pending approval
    {
        let mut pending = state.pending_http_approvals.lock().await;
        pending.insert(
            request.request_id.clone(),
            PendingHttpApproval {
                request: request.clone(),
                response_tx,
            },
        );
        eprintln!(
            "🔵 RUST HTTP: Stored pending approval, total count: {}",
            pending.len()
        );
    }

    // Emit event to UI for approval dialog
    if let Some(app_handle) = &state.app_handle {
        let event_payload = serde_json::json!({
            "approval_id": request.request_id,
            "request": {
                "toolName": request.tool_name,
                "input": request.input,
                "worktreeId": request.worktree_id,
                "timestamp": request.timestamp
            }
        });

        eprintln!("📤 RUST HTTP: Emitting tool-approval-request event");
        let _ = app_handle.emit("tool-approval-request", event_payload);
    }

    // Wait for user response (this blocks the HTTP request until user responds)
    match response_rx.await {
        Ok(response) => {
            eprintln!("✅ RUST HTTP: User responded with: {response:?}");

            // Serialize the response to check what we're sending
            let _json_response = match serde_json::to_string(&response) {
                Ok(json_str) => {
                    eprintln!("📤 RUST HTTP: Sending JSON response: {json_str}");
                    json_str
                }
                Err(e) => {
                    eprintln!("❌ RUST HTTP: Failed to serialize response: {e}");
                    return Err(StatusCode::INTERNAL_SERVER_ERROR);
                }
            };

            eprintln!("🔵 RUST HTTP: About to return HTTP 200 response");

            // Convert behavior back to lowercase for MCP protocol compliance
            let mcp_behavior = match response.behavior {
                ApprovalBehavior::Allow => "allow",
                ApprovalBehavior::Deny => "deny",
            };

            eprintln!(
                "🔵 RUST HTTP: Converting behavior '{:?}' to MCP format '{}'",
                response.behavior, mcp_behavior
            );
            Ok(Json(serde_json::json!({
                "behavior": mcp_behavior,
                "message": response.message,
                "updatedInput": response.updated_input
            })))
        }
        Err(_) => {
            eprintln!("❌ RUST HTTP: Failed to receive user response - oneshot channel closed");
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

pub struct McpServer {
    pub config: McpServerConfig,
    pub process: Option<Child>,
}

impl McpServer {
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            process: None,
        }
    }

    pub fn start(&mut self, app_handle: AppHandle) -> Result<(), String> {
        if self.process.is_some() {
            return Err("MCP server is already running".to_string());
        }

        eprintln!("Starting MCP server with path: {}", self.config.server_path);
        eprintln!("Worktree path: {}", self.config.worktree_path);
        eprintln!("Worktree ID: {}", self.config.worktree_id);

        let mut cmd = Command::new("node");
        cmd.arg(&self.config.server_path)
            .env("WORKTREE_PATH", &self.config.worktree_path)
            .env("WORKTREE_ID", &self.config.worktree_id)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            eprintln!("Failed to spawn MCP server process: {e}");
            format!("Failed to start MCP server: {e}")
        })?;

        eprintln!("MCP server started successfully with PID: {:?}", child.id());

        // Emit a test event to verify event system is working
        let _ = app_handle.emit(
            "mcp-debug",
            serde_json::json!({
                "message": "MCP server started",
                "server_id": self.config.server_id,
                "pid": child.id()
            }),
        );

        // Capture stderr for debugging MCP server logs (not for approval processing)
        if let Some(stderr) = child.stderr.take() {
            let app_handle_clone = app_handle.clone();
            std::thread::spawn(move || {
                use std::io::{BufRead, BufReader};
                let reader = BufReader::new(stderr);
                eprintln!("🔥 MCP: Starting stderr monitoring for debug logs");

                for line in reader.lines() {
                    match line {
                        Ok(line) => {
                            eprintln!("📝 MCP STDERR: {line}");

                            // Emit as debug event
                            let _ = app_handle_clone.emit(
                                "mcp-debug",
                                serde_json::json!({
                                    "type": "stderr",
                                    "line": line
                                }),
                            );
                        }
                        Err(e) => {
                            eprintln!("❌ MCP: Error reading stderr: {e}");
                            break;
                        }
                    }
                }
                eprintln!("🔥 MCP: Stderr monitoring ended");
            });
        }

        self.process = Some(child);
        Ok(())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        if let Some(mut process) = self.process.take() {
            process
                .kill()
                .map_err(|e| format!("Failed to kill MCP server: {e}"))?;

            process
                .wait()
                .map_err(|e| format!("Failed to wait for MCP server: {e}"))?;
        }
        Ok(())
    }

    pub fn is_running(&mut self) -> bool {
        if let Some(process) = &mut self.process {
            match process.try_wait() {
                Ok(Some(status)) => {
                    // Process has exited
                    eprintln!(
                        "MCP server process {} has exited with status: {:?}",
                        self.config.server_id, status
                    );
                    self.process = None;
                    false
                }
                Ok(None) => {
                    // Process is still running
                    eprintln!(
                        "MCP server process {} is still running",
                        self.config.server_id
                    );
                    true
                }
                Err(e) => {
                    // Error checking process status
                    eprintln!(
                        "Error checking MCP server process {} status: {}",
                        self.config.server_id, e
                    );
                    self.process = None;
                    false
                }
            }
        } else {
            eprintln!(
                "MCP server process {} has no process handle",
                self.config.server_id
            );
            false
        }
    }
}

pub struct McpManager {
    servers: Arc<Mutex<HashMap<String, McpServer>>>,
    // Legacy approval system (kept for backward compatibility)
    pending_approvals: Arc<Mutex<HashMap<String, ApprovalRequest>>>,
    // New HTTP approval system
    pub pending_http_approvals: Arc<Mutex<HashMap<String, PendingHttpApproval>>>,
    app_handle: Option<AppHandle>,
}

impl McpManager {
    pub fn new() -> Self {
        Self {
            servers: Arc::new(Mutex::new(HashMap::new())),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            pending_http_approvals: Arc::new(Mutex::new(HashMap::new())),
            app_handle: None,
        }
    }

    pub fn set_app_handle(&mut self, app_handle: AppHandle) {
        self.app_handle = Some(app_handle);
    }

    pub async fn start_http_server(&self) -> Result<(), String> {
        let app_state = HttpAppState {
            pending_http_approvals: self.pending_http_approvals.clone(),
            app_handle: self.app_handle.clone(),
        };

        let app = Router::new()
            .route("/api/approval-request", post(handle_approval_request))
            .layer(CorsLayer::permissive())
            .with_state(app_state);

        eprintln!("🌐 RUST: Starting HTTP server on http://localhost:8080");

        tokio::spawn(async move {
            let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
                .await
                .expect("Failed to bind to port 8080");

            eprintln!("🟢 RUST: HTTP server listening on http://localhost:8080");

            axum::serve(listener, app)
                .await
                .expect("HTTP server failed");
        });

        Ok(())
    }

    pub async fn create_server(
        &self,
        worktree_id: String,
        worktree_path: String,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        let server_id = Uuid::new_v4().to_string();
        let server_path = self.get_mcp_server_path()?;

        let config = McpServerConfig {
            server_id: server_id.clone(),
            worktree_id: worktree_id.clone(),
            worktree_path,
            server_path,
            port: None,
        };

        let mut server = McpServer::new(config);
        server.start(app_handle)?;

        let mut servers = self.servers.lock().await;
        servers.insert(server_id.clone(), server);

        Ok(server_id)
    }

    pub async fn stop_server(&self, server_id: &str) -> Result<(), String> {
        let mut servers = self.servers.lock().await;

        if let Some(server) = servers.get_mut(server_id) {
            server.stop()?;
            servers.remove(server_id);
            Ok(())
        } else {
            Err(format!("MCP server not found: {server_id}"))
        }
    }

    pub async fn list_servers(&self) -> Vec<McpServerConfig> {
        let servers = self.servers.lock().await;
        servers
            .values()
            .map(|server| server.config.clone())
            .collect()
    }

    pub async fn get_server_status(&self, server_id: &str) -> Option<bool> {
        let mut servers = self.servers.lock().await;
        servers.get_mut(server_id).map(|server| server.is_running())
    }

    pub async fn request_approval(&self, request: ApprovalRequest) -> Result<String, String> {
        let approval_id = Uuid::new_v4().to_string();

        let mut pending = self.pending_approvals.lock().await;
        pending.insert(approval_id.clone(), request);

        Ok(approval_id)
    }

    pub async fn respond_to_approval(
        &self,
        approval_id: String,
        response: ApprovalResponse,
    ) -> Result<(), String> {
        eprintln!("🔵 RUST: respond_to_approval called for ID: {approval_id}");

        // Try HTTP approval first (new system)
        if let Ok(()) = self
            .respond_to_http_approval(approval_id.clone(), response.clone())
            .await
        {
            return Ok(());
        }

        // Fallback to legacy system for tests and backward compatibility
        eprintln!("🔴 RUST: HTTP approval not found, trying legacy system for ID: {approval_id}");
        let mut pending = self.pending_approvals.lock().await;

        if let Some(_approval_request) = pending.remove(&approval_id) {
            eprintln!("🟢 RUST: Found pending approval in legacy system for ID: {approval_id}");
            eprintln!("🔵 RUST: Legacy response: {response:?}");
            Ok(())
        } else {
            eprintln!("🔴 RUST: Approval request not found in either system for ID: {approval_id}");
            Err(format!("Approval request not found: {approval_id}"))
        }
    }

    pub async fn respond_to_http_approval(
        &self,
        approval_id: String,
        response: ApprovalResponse,
    ) -> Result<(), String> {
        eprintln!("🔵 RUST HTTP: respond_to_http_approval called for ID: {approval_id}");

        let mut pending = self.pending_http_approvals.lock().await;

        if let Some(pending_approval) = pending.remove(&approval_id) {
            eprintln!("🟢 RUST HTTP: Found pending HTTP approval for ID: {approval_id}");
            eprintln!("🔵 RUST HTTP: Response: {response:?}");

            // Send response through oneshot channel (this unblocks the HTTP request)
            match pending_approval.response_tx.send(response) {
                Ok(()) => {
                    eprintln!("✅ RUST HTTP: Successfully sent response to HTTP handler");
                    Ok(())
                }
                Err(_) => {
                    eprintln!("❌ RUST HTTP: Failed to send response - receiver dropped");
                    Err("Failed to send response to HTTP handler".to_string())
                }
            }
        } else {
            eprintln!("🔴 RUST HTTP: HTTP approval request not found for ID: {approval_id}");
            eprintln!(
                "🔴 RUST HTTP: Available HTTP approval IDs: {:?}",
                pending.keys().collect::<Vec<_>>()
            );
            Err(format!("HTTP approval request not found: {approval_id}"))
        }
    }

    pub async fn get_pending_approvals(&self) -> Vec<(String, ApprovalRequest)> {
        let pending = self.pending_approvals.lock().await;
        pending
            .iter()
            .map(|(id, req)| (id.clone(), req.clone()))
            .collect()
    }

    fn get_mcp_server_path(&self) -> Result<String, String> {
        // Try multiple possible paths for the MCP server
        let current_dir =
            std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;

        let possible_paths = vec![
            current_dir.join("mcp-server").join("dist").join("index.js"),
            current_dir
                .join("..")
                .join("mcp-server")
                .join("dist")
                .join("index.js"),
            current_dir
                .parent()
                .unwrap_or(&current_dir)
                .join("mcp-server")
                .join("dist")
                .join("index.js"),
        ];

        for path in &possible_paths {
            eprintln!("Checking MCP server path: {}", path.display());
            if path.exists() {
                eprintln!("Found MCP server at: {}", path.display());
                return Ok(path.to_string_lossy().to_string());
            }
        }

        Err(format!(
            "MCP server not found. Tried paths: {:?}\nRun 'npm run build' in the mcp-server directory.",
            possible_paths.iter().map(|p| p.display().to_string()).collect::<Vec<_>>()
        ))
    }

    pub async fn cleanup_dead_servers(&self) {
        let mut servers = self.servers.lock().await;
        let dead_servers: Vec<String> = servers
            .iter_mut()
            .filter_map(|(id, server)| {
                if !server.is_running() {
                    Some(id.clone())
                } else {
                    None
                }
            })
            .collect();

        for server_id in dead_servers {
            servers.remove(&server_id);
        }
    }
}

impl Default for McpManager {
    fn default() -> Self {
        Self::new()
    }
}
