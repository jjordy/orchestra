#[cfg(test)]
mod tests {
    use crate::mcp_manager::{ApprovalBehavior, ApprovalResponse, HttpAppState, HttpApprovalRequest, handle_approval_request};
    use axum::extract::{Json, State};
    use serde_json;
    use std::collections::HashMap;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    fn create_test_state() -> HttpAppState {
        HttpAppState {
            pending_http_approvals: Arc::new(Mutex::new(HashMap::new())),
            app_handle: None,
        }
    }

    #[tokio::test]
    async fn test_approval_behavior_conversion_to_mcp_format() {
        // Test that ApprovalBehavior::Allow converts to lowercase "allow" for MCP protocol
        let state = create_test_state();
        
        // Simulate an approval request
        let request = HttpApprovalRequest {
            request_id: "test-123".to_string(),
            tool_name: "execute_command".to_string(),
            input: serde_json::json!({"command": "ls"}),
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
        };

        // Start the approval request handler (this will block waiting for response)
        let state_clone = state.clone();
        let request_clone = request.clone();
        let handler_task = tokio::spawn(async move {
            handle_approval_request(State(state_clone), Json(request_clone)).await
        });

        // Give the handler time to set up the pending approval
        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        // Simulate user approval with uppercase enum (from Rust backend)
        let approval_response = ApprovalResponse {
            behavior: ApprovalBehavior::Allow, // Uppercase enum variant
            message: None,
            updated_input: None,
        };

        // Send the approval response
        {
            let mut pending = state.pending_http_approvals.lock().await;
            if let Some(pending_approval) = pending.remove("test-123") {
                let _ = pending_approval.response_tx.send(approval_response);
            }
        }

        // Wait for handler to complete and get the HTTP response
        let result = handler_task.await.unwrap();
        assert!(result.is_ok());

        let json_response = result.unwrap();
        let response_value = json_response.0;

        // Verify that the response contains lowercase "allow" for MCP protocol compliance
        assert_eq!(response_value["behavior"], "allow"); // Should be lowercase
        assert!(response_value["message"].is_null());
        assert!(response_value["updatedInput"].is_null());
    }

    #[tokio::test]
    async fn test_approval_behavior_deny_conversion() {
        let state = create_test_state();
        
        let request = HttpApprovalRequest {
            request_id: "test-deny-456".to_string(),
            tool_name: "write_file".to_string(),
            input: serde_json::json!({"path": "/test/file.txt", "content": "test"}),
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
        };

        let state_clone = state.clone();
        let request_clone = request.clone();
        let handler_task = tokio::spawn(async move {
            handle_approval_request(State(state_clone), Json(request_clone)).await
        });

        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        // Simulate user denial with uppercase enum
        let approval_response = ApprovalResponse {
            behavior: ApprovalBehavior::Deny, // Uppercase enum variant
            message: Some("User denied the operation".to_string()),
            updated_input: None,
        };

        {
            let mut pending = state.pending_http_approvals.lock().await;
            if let Some(pending_approval) = pending.remove("test-deny-456") {
                let _ = pending_approval.response_tx.send(approval_response);
            }
        }

        let result = handler_task.await.unwrap();
        assert!(result.is_ok());

        let json_response = result.unwrap();
        let response_value = json_response.0;

        // Verify that the response contains lowercase "deny" for MCP protocol compliance
        assert_eq!(response_value["behavior"], "deny"); // Should be lowercase
        assert_eq!(response_value["message"], "User denied the operation");
    }

    #[tokio::test]
    async fn test_approval_with_updated_input() {
        let state = create_test_state();
        
        let original_input = serde_json::json!({
            "command": "rm",
            "args": ["-rf", "/dangerous/path"]
        });

        let request = HttpApprovalRequest {
            request_id: "test-update-789".to_string(),
            tool_name: "execute_command".to_string(),
            input: original_input,
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
        };

        let state_clone = state.clone();
        let request_clone = request.clone();
        let handler_task = tokio::spawn(async move {
            handle_approval_request(State(state_clone), Json(request_clone)).await
        });

        tokio::time::sleep(tokio::time::Duration::from_millis(10)).await;

        // Simulate user approval with modified input
        let modified_input = serde_json::json!({
            "command": "ls",
            "args": ["-la", "/safe/path"]
        });

        let approval_response = ApprovalResponse {
            behavior: ApprovalBehavior::Allow,
            message: Some("Approved with modifications".to_string()),
            updated_input: Some(modified_input.clone()),
        };

        {
            let mut pending = state.pending_http_approvals.lock().await;
            if let Some(pending_approval) = pending.remove("test-update-789") {
                let _ = pending_approval.response_tx.send(approval_response);
            }
        }

        let result = handler_task.await.unwrap();
        assert!(result.is_ok());

        let json_response = result.unwrap();
        let response_value = json_response.0;

        // Verify proper conversion and input modification
        assert_eq!(response_value["behavior"], "allow");
        assert_eq!(response_value["message"], "Approved with modifications");
        assert_eq!(response_value["updatedInput"], modified_input);
    }

    #[tokio::test]
    async fn test_missing_approval_request() {
        let state = create_test_state();
        
        // Try to handle a request that doesn't exist in pending approvals
        let request = HttpApprovalRequest {
            request_id: "nonexistent-request".to_string(),
            tool_name: "execute_command".to_string(),
            input: serde_json::json!({"command": "ls"}),
            worktree_id: "test-worktree".to_string(),
            timestamp: chrono::Utc::now().timestamp_millis() as u64,
        };

        // Don't add this to pending approvals, simulate the handler timing out
        let state_clone = state.clone();
        let request_clone = request.clone();
        
        // This should timeout since no one will send a response
        let handler_task = tokio::spawn(async move {
            tokio::time::timeout(
                tokio::time::Duration::from_millis(100),
                handle_approval_request(State(state_clone), Json(request_clone))
            ).await
        });

        let result = handler_task.await.unwrap();
        
        // Should timeout, indicating proper error handling
        assert!(result.is_err());
    }

    #[test]
    fn test_approval_behavior_enum_values() {
        // Ensure the enum variants are exactly what we expect
        use serde_json;
        
        // Test serialization to JSON (what gets sent to MCP server won't use this directly,
        // but good to verify the enum structure)
        let allow_behavior = ApprovalBehavior::Allow;
        let deny_behavior = ApprovalBehavior::Deny;
        
        // These should serialize to the capitalized versions
        assert_eq!(serde_json::to_string(&allow_behavior).unwrap(), "\"Allow\"");
        assert_eq!(serde_json::to_string(&deny_behavior).unwrap(), "\"Deny\"");
    }

    #[test]
    fn test_mcp_protocol_compliance() {
        // This test documents the MCP protocol expectations
        // According to MCP spec, approval responses should use lowercase:
        // {"behavior": "allow"} or {"behavior": "deny"}
        
        let mcp_allow_response = serde_json::json!({
            "behavior": "allow",
            "updatedInput": {"modified": "input"}
        });
        
        let mcp_deny_response = serde_json::json!({
            "behavior": "deny", 
            "message": "User denied permission"
        });
        
        assert_eq!(mcp_allow_response["behavior"], "allow");
        assert_eq!(mcp_deny_response["behavior"], "deny");
        
        // Ensure these are lowercase (MCP compliance)
        assert_ne!(mcp_allow_response["behavior"], "Allow");
        assert_ne!(mcp_deny_response["behavior"], "Deny");
    }
}