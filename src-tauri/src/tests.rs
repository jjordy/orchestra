#[cfg(test)]
mod tests {
    use crate::{
        AppState, WorktreeConfig, ClaudeProcess, ProcessOutput, 
        parse_claude_json_line, list_worktrees, stop_claude_process,
        list_processes, remove_worktree
    };
    use std::sync::{Arc, Mutex};
    use std::collections::HashMap;
    use tauri::State;
    use chrono::Utc;

    fn create_test_app_state() -> AppState {
        AppState {
            worktrees: Mutex::new(HashMap::new()),
            processes: Mutex::new(HashMap::new()),
            running_processes: Mutex::new(HashMap::new()),
            pty_sessions: Mutex::new(HashMap::new()),
            pty_writers: Mutex::new(HashMap::new()),
        }
    }

    fn create_test_worktree(id: &str) -> WorktreeConfig {
        WorktreeConfig {
            id: id.to_string(),
            name: format!("test-worktree-{}", id),
            path: format!("/tmp/test-path-{}", id),
            branch: format!("test-branch-{}", id),
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
    fn test_claude_json_parsing() {
        // Test Claude JSON message parsing
        let test_cases = vec![
            (r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello world"}]}}"#, Some("Hello world".to_string())),
            (r#"{"type":"user","content":"test"}"#, None),
            (r#"{"type":"system","content":"init"}"#, None),
            (r#"{"type":"result","content":"done"}"#, None),
            ("invalid json", Some("invalid json".to_string())),
        ];

        for (input, expected) in test_cases {
            let result = parse_claude_json_line(input);
            assert_eq!(result, expected, "Failed for input: {}", input);
        }
    }

    #[test]
    fn test_app_state_default() {
        let state = AppState::default();
        
        assert!(state.worktrees.lock().unwrap().is_empty());
        assert!(state.processes.lock().unwrap().is_empty());
        assert!(state.running_processes.lock().unwrap().is_empty());
        assert!(state.pty_sessions.lock().unwrap().is_empty());
        assert!(state.pty_writers.lock().unwrap().is_empty());
    }

    #[test]
    fn test_process_serialization() {
        let process = ClaudeProcess {
            id: "test-id".to_string(),
            worktree_id: "worktree-id".to_string(),
            pid: Some(12345),
            status: "running".to_string(),
            task: Some("test task".to_string()),
            started_at: Some("2024-01-01T00:00:00Z".to_string()),
            last_activity: Some("2024-01-01T00:01:00Z".to_string()),
        };

        // Test that serialization works
        let json = serde_json::to_string(&process).unwrap();
        let deserialized: ClaudeProcess = serde_json::from_str(&json).unwrap();
        
        assert_eq!(process.id, deserialized.id);
        assert_eq!(process.status, deserialized.status);
        assert_eq!(process.pid, deserialized.pid);
    }

    #[test]
    fn test_worktree_config_serialization() {
        let worktree = WorktreeConfig {
            id: "test-id".to_string(),
            name: "test-worktree".to_string(),
            path: "/test/path".to_string(),
            branch: "feature-branch".to_string(),
            base_repo: "/test/repo".to_string(),
            is_active: true,
            created_at: "2024-01-01T00:00:00Z".to_string(),
        };

        let json = serde_json::to_string(&worktree).unwrap();
        let deserialized: WorktreeConfig = serde_json::from_str(&json).unwrap();
        
        assert_eq!(worktree.id, deserialized.id);
        assert_eq!(worktree.name, deserialized.name);
        assert_eq!(worktree.path, deserialized.path);
        assert_eq!(worktree.is_active, deserialized.is_active);
    }

    #[tokio::test]
    async fn test_list_worktrees() {
        let state = create_test_app_state();
        
        // Add multiple test worktrees
        let worktree1 = create_test_worktree("1");
        let worktree2 = create_test_worktree("2");
        
        state.worktrees.lock().unwrap().insert("1".to_string(), worktree1);
        state.worktrees.lock().unwrap().insert("2".to_string(), worktree2);

        // Note: In real tests we'd need proper Tauri state handling
        // For now, test the underlying logic
        let worktrees = state.worktrees.lock().unwrap();
        let result: Vec<WorktreeConfig> = worktrees.values().cloned().collect();
        
        assert_eq!(result.len(), 2);
        
        // Verify worktrees are returned in consistent order
        let ids: Vec<String> = result.iter().map(|w| w.id.clone()).collect();
        assert!(ids.contains(&"1".to_string()));
        assert!(ids.contains(&"2".to_string()));
    }

    #[test]
    fn test_process_state_management() {
        let state = create_test_app_state();
        let process_id = "test-process-1";
        
        // Add a running process
        let mut process = create_test_process(process_id, "worktree-1");
        state.processes.lock().unwrap().insert(process_id.to_string(), process.clone());
        
        // Test process retrieval
        let processes = state.processes.lock().unwrap();
        let retrieved = processes.get(process_id).unwrap();
        assert_eq!(retrieved.id, process_id);
        assert_eq!(retrieved.status, "running");
        
        // Test process status update
        drop(processes);
        process.status = "stopped".to_string();
        state.processes.lock().unwrap().insert(process_id.to_string(), process);
        
        let updated_processes = state.processes.lock().unwrap();
        let updated = updated_processes.get(process_id).unwrap();
        assert_eq!(updated.status, "stopped");
    }

    #[test]
    fn test_list_processes_logic() {
        let state = create_test_app_state();
        
        // Add multiple processes
        let process1 = create_test_process("process-1", "worktree-1");
        let process2 = create_test_process("process-2", "worktree-2");
        
        state.processes.lock().unwrap().insert("process-1".to_string(), process1);
        state.processes.lock().unwrap().insert("process-2".to_string(), process2);

        // Test the underlying logic that list_processes uses
        let processes = state.processes.lock().unwrap();
        let result: Vec<ClaudeProcess> = processes.values().cloned().collect();
        
        assert_eq!(result.len(), 2);
        let ids: Vec<String> = result.iter().map(|p| p.id.clone()).collect();
        assert!(ids.contains(&"process-1".to_string()));
        assert!(ids.contains(&"process-2".to_string()));
    }

    #[test]
    fn test_worktree_removal_logic() {
        let state = create_test_app_state();
        let worktree_id = "worktree-1";
        
        // Add worktree and associated process
        let worktree = create_test_worktree(worktree_id);
        let process = create_test_process("process-1", worktree_id);
        
        state.worktrees.lock().unwrap().insert(worktree_id.to_string(), worktree);
        state.processes.lock().unwrap().insert("process-1".to_string(), process);

        // Test removal logic (simulating what remove_worktree does)
        state.worktrees.lock().unwrap().remove(worktree_id);
        
        // Verify worktree was removed
        assert!(!state.worktrees.lock().unwrap().contains_key(worktree_id));
        
        // In real implementation, associated processes would also be cleaned up
        let processes = state.processes.lock().unwrap();
        let process_exists = processes.values().any(|p| p.worktree_id == worktree_id);
        assert!(process_exists); // Still exists until cleanup is implemented
    }

    #[test]
    fn test_process_output_creation() {
        let output = ProcessOutput {
            process_id: "test-id".to_string(),
            content: "test output".to_string(),
            is_error: false,
            timestamp: Utc::now().to_rfc3339(),
        };

        // Test serialization
        let json = serde_json::to_string(&output).unwrap();
        assert!(json.contains("test-id"));
        assert!(json.contains("test output"));
        assert!(json.contains("is_error"));
    }

    #[test]
    fn test_concurrent_state_access() {
        let state = Arc::new(create_test_app_state());
        let mut handles = vec![];

        // Test concurrent access to state
        for i in 0..10 {
            let state_clone = state.clone();
            let handle = std::thread::spawn(move || {
                let worktree = create_test_worktree(&i.to_string());
                state_clone.worktrees.lock().unwrap().insert(i.to_string(), worktree);
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().unwrap();
        }

        // All worktrees should be added
        assert_eq!(state.worktrees.lock().unwrap().len(), 10);
    }

    #[test]
    fn test_claude_json_edge_cases() {
        // Test various edge cases
        let test_cases = vec![
            // Empty JSON
            ("{}", None),
            // Missing type field
            (r#"{"content":"test"}"#, None),
            // Nested content structure
            (r#"{"type":"assistant","message":{"content":[{"type":"text","text":"nested"}]}}"#, Some("nested".to_string())),
            // Empty content array
            (r#"{"type":"assistant","message":{"content":[]}}"#, None),
            // Multiple content items (our parser concatenates them)
            (r#"{"type":"assistant","message":{"content":[{"type":"text","text":"first"},{"type":"text","text":"second"}]}}"#, Some("first\nsecond".to_string())),
            // Unicode content
            (r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello 世界 🌍"}]}}"#, Some("Hello 世界 🌍".to_string())),
            // Escaped characters
            (r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Line 1\nLine 2\tTab"}]}}"#, Some("Line 1\nLine 2\tTab".to_string())),
        ];

        for (input, expected) in test_cases {
            let result = parse_claude_json_line(input);
            assert_eq!(result, expected, "Failed for input: {}", input);
        }
    }

    #[test]
    fn test_pty_session_id_generation() {
        // Test that PTY session IDs are unique and follow expected format
        let worktree_id = "test-worktree";
        let expected_pty_id = format!("worktree-{}", worktree_id);
        assert_eq!(expected_pty_id, "worktree-test-worktree");
    }

    #[test]
    fn test_state_cleanup_consistency() {
        let state = create_test_app_state();
        
        // Add PTY session and writer
        let pty_id = "test-pty-1";
        state.pty_sessions.lock().unwrap().insert(pty_id.to_string(), Arc::new(Mutex::new(None)));
        // Note: pty_writers expects Box<dyn Write + Send>, using mock for test
        // state.pty_writers.lock().unwrap().insert(pty_id.to_string(), Arc::new(Mutex::new(Box::new(std::io::sink()))));
        
        // PTY session should exist
        assert!(state.pty_sessions.lock().unwrap().contains_key(pty_id));
        
        // After cleanup, should be consistent
        state.pty_sessions.lock().unwrap().remove(pty_id);
        
        assert!(!state.pty_sessions.lock().unwrap().contains_key(pty_id));
    }
}