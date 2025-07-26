import { invoke } from '@tauri-apps/api/core';
import { WorktreeConfig, ClaudeProcess, GitWorktreeInfo, McpServerConfig, ApprovalRequest, ApprovalResponse } from '../types';

export const tauriService = {
  async createWorktree(
    repoPath: string,
    branchName: string,
    worktreeName: string
  ): Promise<WorktreeConfig> {
    return await invoke('create_worktree', {
      repoPath,
      branchName,
      worktreeName,
    });
  },

  async listWorktrees(): Promise<WorktreeConfig[]> {
    return await invoke('list_worktrees');
  },

  async checkWorktreeStatus(worktreePath: string): Promise<[boolean, boolean]> {
    return await invoke('check_worktree_status', { worktreePath });
  },

  async removeWorktree(worktreePath: string, repoPath: string, force?: boolean): Promise<void> {
    console.log('TauriService: Calling remove_worktree with:', { worktreePath, repoPath, force });
    try {
      const result = await invoke('remove_worktree', { 
        worktreePath, 
        repoPath, 
        force 
      });
      console.log('TauriService: remove_worktree succeeded:', result);
      return result;
    } catch (error) {
      console.error('TauriService: remove_worktree failed:', error);
      throw error;
    }
  },

  async startClaudeProcess(
    worktreePath: string,
    worktreeId: string,
    userMessage: string,
    permissionMode?: string
  ): Promise<ClaudeProcess> {
    return await invoke('start_claude_process', { 
      worktreePath, 
      worktreeId, 
      userMessage, 
      permissionMode 
    });
  },

  async sendMessageToClaude(
    worktreePath: string,
    worktreeId: string,
    message: string,
    permissionMode?: string
  ): Promise<void> {
    return await invoke('send_message_to_claude', { 
      worktreePath, 
      worktreeId, 
      message, 
      permissionMode 
    });
  },

  async stopClaudeProcess(processId: string): Promise<void> {
    return await invoke('stop_claude_process', { processId });
  },

  async listProcesses(): Promise<ClaudeProcess[]> {
    return await invoke('list_processes');
  },

  async validateGitRepo(repoPath: string): Promise<string> {
    return await invoke('validate_git_repo', { repoPath });
  },

  async listGitWorktrees(repoPath: string): Promise<GitWorktreeInfo[]> {
    return await invoke('list_git_worktrees', { repoPath });
  },


  // MCP Server Methods
  async createMcpServer(worktreeId: string, worktreePath: string): Promise<string> {
    return await invoke('create_mcp_server', { worktreeId, worktreePath });
  },

  async stopMcpServer(serverId: string): Promise<void> {
    return await invoke('stop_mcp_server', { serverId });
  },

  async listMcpServers(): Promise<McpServerConfig[]> {
    return await invoke('list_mcp_servers');
  },

  async getMcpServerStatus(serverId: string): Promise<boolean> {
    return await invoke('get_mcp_server_status', { serverId });
  },

  async requestToolApproval(request: ApprovalRequest): Promise<string> {
    return await invoke('request_tool_approval', { request });
  },

  async respondToApproval(approvalId: string, response: ApprovalResponse): Promise<void> {
    // Convert lowercase MCP protocol behavior to uppercase Rust backend format
    const convertedResponse = {
      ...response,
      behavior: response.behavior === 'allow' ? 'Allow' : 'Deny'
    };
    console.log('Frontend sending approval:', { 
      original: response, 
      converted: convertedResponse,
      approvalId 
    });
    return await invoke('respond_to_approval', { approvalId, response: convertedResponse });
  },

  async getPendingApprovals(): Promise<Array<[string, ApprovalRequest]>> {
    return await invoke('get_pending_approvals');
  },
};