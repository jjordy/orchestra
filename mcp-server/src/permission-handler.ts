import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ApprovalRequest {
  toolName: string;
  input: any;
  worktreeId: string;
  timestamp: number;
  toolUseId?: string;
}

export interface ApprovalResponse {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: any;
}

export class PermissionHandler {
  constructor(private readonly callbackUrl?: string) {}

  // Storage for polling-based approval requests
  private pendingApprovals = new Map<string, ApprovalResponse>();

  /**
   * Request approval for tool execution from the user
   * This communicates with our Tauri backend to show approval UI
   */
  async requestApproval(toolName: string, input: any, toolUseId?: string): Promise<ApprovalResponse> {
    console.error(`🚨 MCP: requestApproval called for tool: ${toolName}`);
    process.stderr.write(`🚨 MCP: requestApproval called for tool: ${toolName}\n`);
    
    const request: ApprovalRequest = {
      toolName,
      input,
      worktreeId: process.env.WORKTREE_ID!,
      timestamp: Date.now(),
      ...(toolUseId && { toolUseId }),
    };

    try {
      // If we have a callback URL, use HTTP communication
      if (this.callbackUrl) {
        console.error(`🔵 MCP: Using HTTP callback: ${this.callbackUrl}`);
        return await this.requestApprovalViaHttp(request);
      }
      
      // Otherwise, use IPC via our Tauri backend
      console.error(`🔵 MCP: Using IPC via Tauri backend`);
      return await this.requestApprovalViaIpc(request);
    } catch (error) {
      console.error('Failed to get user approval:', error);
      // Default to deny on error
      return {
        behavior: 'deny',
        message: 'Failed to get user approval: ' + (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  /**
   * Request approval via HTTP callback (for future extensibility)
   */
  private async requestApprovalViaHttp(request: ApprovalRequest): Promise<ApprovalResponse> {
    const response = await fetch(this.callbackUrl!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Request approval via direct HTTP POST to Rust backend
   * This is the primary method we'll use
   */
  private async requestApprovalViaIpc(request: ApprovalRequest): Promise<ApprovalResponse> {
    const requestId = `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.error(`🔵 MCP: Starting direct HTTP approval request ${requestId} for tool: ${request.toolName}`);
    
    // Make direct HTTP POST to Rust backend - this will block until user responds
    const backendUrl = process.env.ORCHESTRA_BACKEND_URL || 'http://localhost:8080';
    const approvalEndpoint = `${backendUrl}/api/approval-request`;
    
    try {
      console.error(`📤 MCP: POSTing approval request to ${approvalEndpoint}`);
      console.error(`📤 MCP: Request data: ${JSON.stringify({ requestId, ...request })}`);
      process.stderr.write(`📤 MCP: About to start fetch request\n`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.error(`⏰ MCP: Request timed out after 30 seconds`);
        controller.abort();
      }, 30000); // 30 second timeout
      
      console.error(`📤 MCP: Starting fetch now...`);
      
      const response = await fetch(approvalEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          ...request,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      console.error(`🎯 MCP: Fetch completed successfully!`);
      
      console.error(`🔵 MCP: HTTP response status: ${response.status} ${response.statusText}`);
      console.error(`🔵 MCP: HTTP response headers: ${JSON.stringify(Object.fromEntries(response.headers.entries()))}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ MCP: HTTP error response body: ${errorText}`);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      let responseText;
      try {
        responseText = await response.text();
        console.error(`🔵 MCP: Raw response text: ${responseText}`);
      } catch (textError) {
        console.error(`❌ MCP: Failed to read response text: ${textError}`);
        throw new Error(`Failed to read response: ${textError}`);
      }
      
      let approvalResponse;
      try {
        approvalResponse = JSON.parse(responseText);
        console.error(`✅ MCP: Parsed approval response: ${JSON.stringify(approvalResponse)}`);
      } catch (parseError) {
        console.error(`❌ MCP: Failed to parse response as JSON: ${parseError}`);
        console.error(`❌ MCP: Response text was: "${responseText}"`);
        throw new Error(`Invalid JSON response: ${responseText}`);
      }
      
      console.error(`🎉 MCP: About to return approval response to caller`);
      return approvalResponse;
    } catch (error) {
      console.error(`🔴 MCP: Failed to get approval from backend: ${error}`);
      console.error(`🔴 MCP: Error type: ${typeof error}`);
      console.error(`🔴 MCP: Error stack: ${error instanceof Error ? error.stack : 'No stack'}`);
      
      // Force stderr flush
      process.stderr.write(`🔴 MCP: CRITICAL ERROR: ${error}\n`);
      
      throw error;
    }
  }

  /**
   * Start an approval request that can be polled for results
   * This is used with the polling mechanism like CCO-MCP
   */
  startApprovalRequest(toolName: string, input: any, toolUseId: string | undefined, requestId: string): void {
    console.error(`🔵 MCP: Starting non-blocking approval request ${requestId} for tool: ${toolName}`);
    
    const request: ApprovalRequest = {
      toolName,
      input,
      worktreeId: process.env.WORKTREE_ID!,
      timestamp: Date.now(),
    };

    // Fire-and-forget HTTP request that will store result when complete
    this.makeApprovalRequestAsync(requestId, request);
  }

  /**
   * Make the approval request asynchronously and store the result
   */
  private async makeApprovalRequestAsync(requestId: string, request: ApprovalRequest): Promise<void> {
    try {
      // Make direct HTTP POST to Rust backend - this will block until user responds
      const backendUrl = process.env.ORCHESTRA_BACKEND_URL || 'http://localhost:8080';
      const approvalEndpoint = `${backendUrl}/api/approval-request`;
      
      console.error(`📤 MCP: POSTing approval request to ${approvalEndpoint}`);
      
      const response = await fetch(approvalEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          ...request,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ MCP: HTTP error response: ${response.status} ${errorText}`);
        // Store error response
        this.pendingApprovals.set(requestId, {
          behavior: 'deny',
          message: `HTTP error: ${response.status}`,
        });
        return;
      }
      
      const responseText = await response.text();
      console.error(`🔵 MCP: Raw response text: ${responseText}`);
      
      const approvalResponse = JSON.parse(responseText);
      console.error(`✅ MCP: Parsed approval response: ${JSON.stringify(approvalResponse)}`);
      
      // Store the result for polling
      this.pendingApprovals.set(requestId, approvalResponse);
      
    } catch (error) {
      console.error(`🔴 MCP: Failed to get approval from backend: ${error}`);
      
      // Store error response
      this.pendingApprovals.set(requestId, {
        behavior: 'deny',
        message: 'Failed to get user approval: ' + (error instanceof Error ? error.message : String(error)),
      });
    }
  }

  /**
   * Check the status of a polling approval request
   * Returns the response if available, null if still pending
   */
  async checkApprovalStatus(requestId: string): Promise<ApprovalResponse | null> {
    const response = this.pendingApprovals.get(requestId);
    if (response) {
      // Don't delete immediately - let the caller handle cleanup
      // This prevents race conditions in polling
      console.error(`🎯 MCP: Found response for ${requestId}: ${JSON.stringify(response)}`);
      return response;
    }
    return null;
  }

  /**
   * Clean up a completed approval request
   */
  cleanupApprovalRequest(requestId: string): void {
    const deleted = this.pendingApprovals.delete(requestId);
    console.error(`🧹 MCP: Cleaned up approval request ${requestId}, deleted: ${deleted}`);
  }

  /**
   * Get the number of pending approvals (for debugging)
   */
  getPendingCount(): number {
    return this.pendingApprovals.size;
  }

  /**
   * Create a simple approval response for testing
   */
  createApprovalResponse(
    behavior: 'allow' | 'deny',
    message?: string,
    updatedInput?: any
  ): ApprovalResponse {
    const response: ApprovalResponse = { behavior };
    
    if (message) {
      response.message = message;
    }
    
    if (updatedInput) {
      response.updatedInput = updatedInput;
    }
    
    return response;
  }

}