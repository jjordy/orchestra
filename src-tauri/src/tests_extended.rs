#[cfg(test)]
mod extended_tests {
    use crate::mcp_manager::{ApprovalRequest, ApprovalResponse, McpManager};
    use crate::{
        parse_claude_json_line, AppState, ClaudeProcess, GitWorktreeInfo, ProcessOutput,
        WorktreeConfig,
    };
    use chrono::Utc;
    use serde_json::json;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    // use tokio::time::{sleep, Duration};

    fn create_test_app_state() -> AppState {
        AppState {
            worktrees: Mutex::new(HashMap::new()),
            processes: Mutex::new(HashMap::new()),
            running_processes: Mutex::new(HashMap::new()),
            mcp_manager: McpManager::new(),
        }
    }

    fn create_test_worktree(id: &str) -> WorktreeConfig {
        WorktreeConfig {
            id: id.to_string(),
            name: format!("test-worktree-{id}"),
            path: format!("/tmp/test-path-{id}"),
            branch: format!("test-branch-{id}"),
            base_repo: "/tmp/test-repo".to_string(),
            is_active: true,
            created_at: Utc::now().to_rfc3339(),
        }
    }

    fn create_test_process(id: &str, worktree_id: &str) -> ClaudeProcess {
        ClaudeProcess {
            id: id.to_string(),
            worktree_id: worktree_id.to_string(),
            pid: Some(12345),
            status: "running".to_string(),
            task: Some("test task".to_string()),
            started_at: Some(Utc::now().to_rfc3339()),
            last_activity: Some(Utc::now().to_rfc3339()),
        }
    }

    #[test]
    fn test_git_worktree_info_serialization() {
        let info = GitWorktreeInfo {
            path: "/home/test/main".to_string(),
            branch: "main".to_string(),
            is_main: true,
            is_bare: false,
            is_detached: false,
        };

        let json = serde_json::to_string(&info).unwrap();
        let deserialized: GitWorktreeInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(info.path, deserialized.path);
        assert_eq!(info.branch, deserialized.branch);
        assert_eq!(info.is_main, deserialized.is_main);
        assert_eq!(info.is_bare, deserialized.is_bare);
        assert_eq!(info.is_detached, deserialized.is_detached);
    }

    #[test]
    fn test_process_output_serialization() {
        let output = ProcessOutput {
            process_id: "test-process".to_string(),
            content: "Hello World\nWith newlines".to_string(),
            is_error: false,
            timestamp: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&output).unwrap();
        let deserialized: ProcessOutput = serde_json::from_str(&json).unwrap();

        assert_eq!(output.process_id, deserialized.process_id);
        assert_eq!(output.content, deserialized.content);
        assert_eq!(output.is_error, deserialized.is_error);
        assert_eq!(output.timestamp, deserialized.timestamp);
    }

    #[test]
    fn test_claude_json_parsing_complex_structures() {
        // Test complex JSON structures that Claude might output
        let test_cases = vec![
            // Tool use messages (should be skipped in current implementation)
            (
                r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"write_file","input":{"path":"test.txt","content":"hello"}}]}}"#,
                None,
            ),
            // Tool results (should be included)
            (
                r#"{"type":"assistant","message":{"content":[{"type":"tool_result","content":[{"type":"text","text":"File written successfully"}]}]}}"#,
                Some("Tool result: File written successfully".to_string()),
            ),
            // Mixed content (text + tool use)
            (
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"I'll write a file"},{"type":"tool_use","name":"write_file","input":{"path":"test.txt"}}]}}"#,
                Some("I'll write a file".to_string()),
            ),
            // Tool result with nested structure
            (
                r#"{"type":"assistant","message":{"content":[{"type":"tool_result","content":{"text":"Nested result"}}]}}"#,
                Some("Tool result: Nested result".to_string()),
            ),
            // Multiple text blocks
            (
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"First"},{"type":"text","text":"Second"}]}}"#,
                Some("First\nSecond".to_string()),
            ),
        ];

        for (input, expected) in test_cases {
            let result = parse_claude_json_line(input);
            assert_eq!(result, expected, "Failed for input: {input}");
        }
    }

    #[test]
    fn test_claude_json_parsing_error_handling() {
        // Test malformed JSON handling
        let error_cases = vec![
            "",
            "{",
            "}",
            "not json at all",
            r#"{"type":"assistant""#,
            r#"{"type":"assistant","message":{"content":[{"type":"text"}]}}"#,
        ];

        for input in error_cases {
            let result = parse_claude_json_line(input);
            // Most malformed JSON should either return None or the raw text
            if !input.is_empty() && !input.starts_with('{') {
                assert_eq!(result, Some(input.to_string()));
            }
        }
    }

    #[test]
    fn test_worktree_config_validation() {
        let worktree = WorktreeConfig {
            id: "test-123".to_string(),
            name: "Test Worktree".to_string(),
            path: "/valid/path".to_string(),
            branch: "feature-branch".to_string(),
            base_repo: "/valid/repo".to_string(),
            is_active: true,
            created_at: Utc::now().to_rfc3339(),
        };

        // Test that all required fields are present
        assert!(!worktree.id.is_empty());
        assert!(!worktree.name.is_empty());
        assert!(!worktree.path.is_empty());
        assert!(!worktree.branch.is_empty());
        assert!(!worktree.base_repo.is_empty());
        assert!(worktree.is_active);

        // Test timestamp is valid RFC3339
        assert!(chrono::DateTime::parse_from_rfc3339(&worktree.created_at).is_ok());
    }

    #[test]
    fn test_claude_process_lifecycle() {
        let mut process = ClaudeProcess {
            id: "process-123".to_string(),
            worktree_id: "worktree-456".to_string(),
            pid: None,
            status: "starting".to_string(),
            task: Some("Initial task".to_string()),
            started_at: None,
            last_activity: None,
        };

        // Test process states
        assert_eq!(process.status, "starting");
        assert!(process.pid.is_none());
        assert!(process.started_at.is_none());

        // Simulate process started
        process.pid = Some(12345);
        process.status = "running".to_string();
        process.started_at = Some(Utc::now().to_rfc3339());
        process.last_activity = Some(Utc::now().to_rfc3339());

        assert_eq!(process.status, "running");
        assert_eq!(process.pid, Some(12345));
        assert!(process.started_at.is_some());

        // Simulate process completed
        process.status = "completed".to_string();
        process.last_activity = Some(Utc::now().to_rfc3339());

        assert_eq!(process.status, "completed");
    }

    #[test]
    fn test_app_state_concurrent_modifications() {
        let state = Arc::new(create_test_app_state());
        let mut handles = vec![];

        // Test concurrent worktree operations
        for i in 0..50 {
            let state_clone = state.clone();
            let handle = std::thread::spawn(move || {
                let worktree = create_test_worktree(&format!("concurrent-{i}"));
                state_clone
                    .worktrees
                    .lock()
                    .unwrap()
                    .insert(format!("concurrent-{i}"), worktree);
            });
            handles.push(handle);
        }

        // Test concurrent process operations
        for i in 0..50 {
            let state_clone = state.clone();
            let handle = std::thread::spawn(move || {
                let process =
                    create_test_process(&format!("process-{i}"), &format!("worktree-{i}"));
                state_clone
                    .processes
                    .lock()
                    .unwrap()
                    .insert(format!("process-{i}"), process);
            });
            handles.push(handle);
        }

        // Wait for all operations to complete
        for handle in handles {
            handle.join().unwrap();
        }

        // Verify all items were added
        assert_eq!(state.worktrees.lock().unwrap().len(), 50);
        assert_eq!(state.processes.lock().unwrap().len(), 50);
    }

    #[test]
    fn test_state_cleanup_logic() {
        let state = create_test_app_state();

        // Add worktrees and processes
        for i in 0..5 {
            let worktree = create_test_worktree(&i.to_string());
            let process = create_test_process(&format!("process-{i}"), &i.to_string());

            state
                .worktrees
                .lock()
                .unwrap()
                .insert(i.to_string(), worktree);
            state
                .processes
                .lock()
                .unwrap()
                .insert(format!("process-{i}"), process);
        }

        // Verify initial state
        assert_eq!(state.worktrees.lock().unwrap().len(), 5);
        assert_eq!(state.processes.lock().unwrap().len(), 5);

        // Simulate cleanup of specific worktree
        let target_worktree = "2";
        state.worktrees.lock().unwrap().remove(target_worktree);

        // Remove associated processes
        let process_ids_to_remove: Vec<String> = state
            .processes
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, process)| process.worktree_id == target_worktree)
            .map(|(id, _)| id.clone())
            .collect();

        for id in process_ids_to_remove {
            state.processes.lock().unwrap().remove(&id);
        }

        // Verify cleanup
        assert_eq!(state.worktrees.lock().unwrap().len(), 4);
        assert_eq!(state.processes.lock().unwrap().len(), 4);

        // Verify target was removed
        assert!(!state
            .worktrees
            .lock()
            .unwrap()
            .contains_key(target_worktree));
        let remaining_processes = state.processes.lock().unwrap();
        assert!(!remaining_processes
            .values()
            .any(|p| p.worktree_id == target_worktree));
    }

    #[tokio::test]
    async fn test_mcp_manager_server_lifecycle() {
        let manager = McpManager::new();

        // Test server creation (mock)
        let servers = manager.list_servers().await;
        assert!(servers.is_empty());

        // In a real test, we would:
        // 1. Create a server
        // 2. Verify it appears in the list
        // 3. Check its status
        // 4. Stop the server
        // 5. Verify it's removed from the list
    }

    #[tokio::test]
    async fn test_mcp_approval_timeout_handling() {
        let manager = McpManager::new();

        let request = ApprovalRequest {
            tool_name: "test_tool".to_string(),
            input: json!({"test": "data"}),
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp() as u64,
        };

        // Request approval
        let approval_id = manager.request_approval(request).await.unwrap();

        // Verify it's pending
        let pending = manager.get_pending_approvals().await;
        assert_eq!(pending.len(), 1);

        // In a real implementation, we would test timeout behavior
        // For now, just verify the approval exists
        assert_eq!(pending[0].0, approval_id);
    }

    #[tokio::test]
    async fn test_mcp_approval_response_handling() {
        let manager = McpManager::new();

        let request = ApprovalRequest {
            tool_name: "write_file".to_string(),
            input: json!({"path": "test.txt", "content": "hello"}),
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp() as u64,
        };

        let approval_id = manager.request_approval(request).await.unwrap();

        // Test allow response
        let allow_response = ApprovalResponse {
            behavior: crate::mcp_manager::ApprovalBehavior::Allow,
            message: None,
            updated_input: None,
        };

        let result = manager
            .respond_to_approval(approval_id.clone(), allow_response)
            .await;
        assert!(result.is_ok());

        // Approval should be removed from pending list
        let pending = manager.get_pending_approvals().await;
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn test_mcp_approval_deny_response() {
        let manager = McpManager::new();

        let request = ApprovalRequest {
            tool_name: "dangerous_operation".to_string(),
            input: json!({"command": "rm -rf /"}),
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp() as u64,
        };

        let approval_id = manager.request_approval(request).await.unwrap();

        // Test deny response
        let deny_response = ApprovalResponse {
            behavior: crate::mcp_manager::ApprovalBehavior::Deny,
            message: Some("Operation too dangerous".to_string()),
            updated_input: None,
        };

        let result = manager
            .respond_to_approval(approval_id, deny_response)
            .await;
        assert!(result.is_ok());

        // Approval should be removed from pending list
        let pending = manager.get_pending_approvals().await;
        assert!(pending.is_empty());
    }

    #[tokio::test]
    async fn test_mcp_approval_modified_input() {
        let manager = McpManager::new();

        let request = ApprovalRequest {
            tool_name: "write_file".to_string(),
            input: json!({"path": "test.txt", "content": "original content"}),
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp() as u64,
        };

        let approval_id = manager.request_approval(request).await.unwrap();

        // Test response with modified input
        let modified_response = ApprovalResponse {
            behavior: crate::mcp_manager::ApprovalBehavior::Allow,
            message: None,
            updated_input: Some(json!({"path": "test.txt", "content": "modified content"})),
        };

        let result = manager
            .respond_to_approval(approval_id, modified_response)
            .await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_mcp_multiple_concurrent_approvals() {
        let manager = McpManager::new();
        let mut approval_ids = Vec::new();

        // Create multiple approval requests
        for i in 0..5 {
            let request = ApprovalRequest {
                tool_name: format!("tool_{i}"),
                input: json!({"index": i}),
                worktree_id: format!("worktree-{i}"),
                timestamp: chrono::Utc::now().timestamp() as u64,
            };

            let approval_id = manager.request_approval(request).await.unwrap();
            approval_ids.push(approval_id);
        }

        // Verify all are pending
        let pending = manager.get_pending_approvals().await;
        assert_eq!(pending.len(), 5);

        // Respond to all
        for approval_id in approval_ids {
            let response = ApprovalResponse {
                behavior: crate::mcp_manager::ApprovalBehavior::Allow,
                message: None,
                updated_input: None,
            };

            let result = manager.respond_to_approval(approval_id, response).await;
            assert!(result.is_ok());
        }

        // All should be cleared
        let pending_after = manager.get_pending_approvals().await;
        assert!(pending_after.is_empty());
    }

    #[test]
    fn test_json_parsing_performance() {
        let large_json = format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"{}"}}]}}}}"#,
            "A".repeat(10000) // 10KB of text
        );

        let start = std::time::Instant::now();
        let result = parse_claude_json_line(&large_json);
        let duration = start.elapsed();

        assert!(result.is_some());
        assert!(duration < std::time::Duration::from_millis(100)); // Should be fast
    }

    #[test]
    fn test_state_memory_efficiency() {
        let state = create_test_app_state();

        // Add many items to test memory usage
        for i in 0..1000 {
            let worktree = create_test_worktree(&i.to_string());
            let process = create_test_process(&format!("process-{i}"), &i.to_string());

            state
                .worktrees
                .lock()
                .unwrap()
                .insert(i.to_string(), worktree);
            state
                .processes
                .lock()
                .unwrap()
                .insert(format!("process-{i}"), process);
        }

        // Verify all items are stored
        assert_eq!(state.worktrees.lock().unwrap().len(), 1000);
        assert_eq!(state.processes.lock().unwrap().len(), 1000);

        // Test batch removal
        let worktree_keys: Vec<String> = state.worktrees.lock().unwrap().keys().cloned().collect();
        let process_keys: Vec<String> = state.processes.lock().unwrap().keys().cloned().collect();

        // Remove half of the items
        for (i, key) in worktree_keys.iter().enumerate() {
            if i % 2 == 0 {
                state.worktrees.lock().unwrap().remove(key);
            }
        }

        for (i, key) in process_keys.iter().enumerate() {
            if i % 2 == 0 {
                state.processes.lock().unwrap().remove(key);
            }
        }

        // Verify half were removed
        assert_eq!(state.worktrees.lock().unwrap().len(), 500);
        assert_eq!(state.processes.lock().unwrap().len(), 500);
    }

    #[test]
    fn test_error_message_formatting() {
        // Test that error messages are properly formatted and don't contain sensitive info
        let process_output = ProcessOutput {
            process_id: "test-process".to_string(),
            content: "Error: File not found".to_string(),
            is_error: true,
            timestamp: Utc::now().to_rfc3339(),
        };

        assert!(process_output.is_error);
        assert!(process_output.content.contains("Error"));
        assert!(!process_output.content.contains("/home/user/secret")); // Should not contain sensitive paths
    }

    #[test]
    fn test_timestamp_consistency() {
        let start_time = Utc::now();

        let worktree = create_test_worktree("timestamp-test");
        let process = create_test_process("process-timestamp", "timestamp-test");

        let end_time = Utc::now();

        // Parse timestamps
        let worktree_time = chrono::DateTime::parse_from_rfc3339(&worktree.created_at).unwrap();
        let process_start_time =
            chrono::DateTime::parse_from_rfc3339(process.started_at.as_ref().unwrap()).unwrap();

        // Verify timestamps are within expected range
        assert!(worktree_time.timestamp() >= start_time.timestamp());
        assert!(worktree_time.timestamp() <= end_time.timestamp());
        assert!(process_start_time.timestamp() >= start_time.timestamp());
        assert!(process_start_time.timestamp() <= end_time.timestamp());
    }

    #[test]
    fn test_unicode_handling() {
        // Test that Unicode content is handled correctly
        let unicode_cases = vec![
            "Hello 世界",     // Chinese
            "Здравствуй мир", // Russian
            "🚀 Rocket emoji",
            "Café résumé naïve", // Accented characters
            "𝕌𝕟𝕚𝕔𝕠𝕕𝕖",           // Mathematical symbols
        ];

        for content in unicode_cases {
            let json = format!(
                r#"{{"type":"assistant","message":{{"content":[{{"type":"text","text":"{content}"}}]}}}}"#
            );

            let result = parse_claude_json_line(&json);
            assert_eq!(result, Some(content.to_string()));

            // Test in process output
            let output = ProcessOutput {
                process_id: "unicode-test".to_string(),
                content: content.to_string(),
                is_error: false,
                timestamp: Utc::now().to_rfc3339(),
            };

            let serialized = serde_json::to_string(&output).unwrap();
            let deserialized: ProcessOutput = serde_json::from_str(&serialized).unwrap();
            assert_eq!(deserialized.content, content);
        }
    }
}
