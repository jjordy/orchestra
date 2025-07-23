import { invoke } from '@tauri-apps/api/core';
import { WorktreeConfig, ClaudeProcess, GitWorktreeInfo } from '../types';

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

  async removeWorktree(worktreeId: string): Promise<void> {
    return await invoke('remove_worktree', { worktreeId });
  },

  async startClaudeProcess(
    worktreePath: string,
    worktreeId: string,
    userMessage: string,
    permissionMode?: string
  ): Promise<ClaudeProcess> {
    return await invoke('start_claude_process', { worktreePath, worktreeId, userMessage, permissionMode });
  },

  async sendMessageToClaude(
    worktreePath: string,
    worktreeId: string,
    message: string,
    permissionMode?: string
  ): Promise<void> {
    return await invoke('send_message_to_claude', { worktreePath, worktreeId, message, permissionMode });
  },

  async stopClaudeProcess(processId: string): Promise<void> {
    return await invoke('stop_claude_process', { processId });
  },

  async listProcesses(): Promise<ClaudeProcess[]> {
    return await invoke('list_processes');
  },

  async listGitWorktrees(repoPath: string): Promise<GitWorktreeInfo[]> {
    return await invoke('list_git_worktrees', { repoPath });
  },

  // PTY Terminal Methods
  async createPty(workingDir: string): Promise<string> {
    return await invoke('create_pty', { workingDir });
  },

  async createWorktreePty(ptyId: string, workingDir: string): Promise<string> {
    return await invoke('create_worktree_pty', { ptyId, workingDir });
  },

  async writeToPty(ptyId: string, data: string): Promise<void> {
    return await invoke('write_to_pty', { ptyId, data });
  },

  async resizePty(ptyId: string, cols: number, rows: number): Promise<void> {
    return await invoke('resize_pty', { ptyId, cols, rows });
  },

  async closePty(ptyId: string): Promise<void> {
    return await invoke('close_pty', { ptyId });
  },
};