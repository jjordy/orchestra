import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tauriService } from '../services/tauri';

describe('Tauri Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Worktree Management', () => {
    it('creates worktree', async () => {
      const mockWorktree = {
        id: 'test-id',
        name: 'test-worktree',
        path: '/test/path',
        branch: 'feature-branch',
        base_repo: '/test/repo',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
      };

      global.mockInvoke.mockResolvedValue(mockWorktree);

      const result = await tauriService.createWorktree('/test/repo', 'feature-branch', 'test-worktree');

      expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree', {
        repoPath: '/test/repo',
        branchName: 'feature-branch',
        worktreeName: 'test-worktree',
      });
      expect(result).toEqual(mockWorktree);
    });

    it('lists worktrees', async () => {
      const mockWorktrees = [
        { id: '1', name: 'worktree-1', path: '/test/path1' },
        { id: '2', name: 'worktree-2', path: '/test/path2' },
      ];

      global.mockInvoke.mockResolvedValue(mockWorktrees);

      const result = await tauriService.listWorktrees();

      expect(global.mockInvoke).toHaveBeenCalledWith('list_worktrees');
      expect(result).toEqual(mockWorktrees);
    });

    it('removes worktree', async () => {
      global.mockInvoke.mockResolvedValue(undefined);

      await tauriService.removeWorktree('test-id');

      expect(global.mockInvoke).toHaveBeenCalledWith('remove_worktree', {
        worktreeId: 'test-id',
      });
    });

    it('lists git worktrees', async () => {
      const mockGitWorktrees = [
        { path: '/test/main', branch: 'main', is_main: true, is_bare: false, is_detached: false },
        { path: '/test/feature', branch: 'feature', is_main: false, is_bare: false, is_detached: false },
      ];

      global.mockInvoke.mockResolvedValue(mockGitWorktrees);

      const result = await tauriService.listGitWorktrees('/test/repo');

      expect(global.mockInvoke).toHaveBeenCalledWith('list_git_worktrees', {
        repoPath: '/test/repo',
      });
      expect(result).toEqual(mockGitWorktrees);
    });
  });

  describe('Claude Process Management', () => {
    it('starts Claude process', async () => {
      const mockProcess = {
        id: 'process-id',
        worktree_id: 'worktree-id',
        pid: 12345,
        status: 'running',
        task: 'test task',
        started_at: '2024-01-01T00:00:00Z',
        last_activity: '2024-01-01T00:01:00Z',
      };

      global.mockInvoke.mockResolvedValue(mockProcess);

      const result = await tauriService.startClaudeProcess(
        '/test/path',
        'worktree-id',
        'test message',
        'safe'
      );

      expect(global.mockInvoke).toHaveBeenCalledWith('start_claude_process', {
        worktreePath: '/test/path',
        worktreeId: 'worktree-id',
        userMessage: 'test message',
        permissionMode: 'safe',
      });
      expect(result).toEqual(mockProcess);
    });

    it('sends message to Claude', async () => {
      global.mockInvoke.mockResolvedValue(undefined);

      await tauriService.sendMessageToClaude(
        '/test/path',
        'worktree-id',
        'test message',
        'full'
      );

      expect(global.mockInvoke).toHaveBeenCalledWith('send_message_to_claude', {
        worktreePath: '/test/path',
        worktreeId: 'worktree-id',
        message: 'test message',
        permissionMode: 'full',
      });
    });

    it('stops Claude process', async () => {
      global.mockInvoke.mockResolvedValue(undefined);

      await tauriService.stopClaudeProcess('process-id');

      expect(global.mockInvoke).toHaveBeenCalledWith('stop_claude_process', {
        processId: 'process-id',
      });
    });

    it('lists processes', async () => {
      const mockProcesses = [
        { id: 'proc-1', status: 'running' },
        { id: 'proc-2', status: 'idle' },
      ];

      global.mockInvoke.mockResolvedValue(mockProcesses);

      const result = await tauriService.listProcesses();

      expect(global.mockInvoke).toHaveBeenCalledWith('list_processes');
      expect(result).toEqual(mockProcesses);
    });
  });

  describe('PTY Terminal Operations', () => {
    it('creates PTY', async () => {
      global.mockInvoke.mockResolvedValue('pty-id');

      const result = await tauriService.createPty('/test/workdir');

      expect(global.mockInvoke).toHaveBeenCalledWith('create_pty', {
        workingDir: '/test/workdir',
      });
      expect(result).toBe('pty-id');
    });

    it('creates worktree PTY', async () => {
      global.mockInvoke.mockResolvedValue('pty-id');

      const result = await tauriService.createWorktreePty('custom-pty-id', '/test/workdir');

      expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
        ptyId: 'custom-pty-id',
        workingDir: '/test/workdir',
      });
      expect(result).toBe('pty-id');
    });

    it('writes to PTY', async () => {
      global.mockInvoke.mockResolvedValue(undefined);

      await tauriService.writeToPty('pty-id', 'test command\n');

      expect(global.mockInvoke).toHaveBeenCalledWith('write_to_pty', {
        ptyId: 'pty-id',
        data: 'test command\n',
      });
    });

    it('resizes PTY', async () => {
      global.mockInvoke.mockResolvedValue(undefined);

      await tauriService.resizePty('pty-id', 80, 24);

      expect(global.mockInvoke).toHaveBeenCalledWith('resize_pty', {
        ptyId: 'pty-id',
        cols: 80,
        rows: 24,
      });
    });

    it('closes PTY', async () => {
      global.mockInvoke.mockResolvedValue(undefined);

      await tauriService.closePty('pty-id');

      expect(global.mockInvoke).toHaveBeenCalledWith('close_pty', {
        ptyId: 'pty-id',
      });
    });
  });

  describe('Error Handling', () => {
    it('handles Tauri invoke errors', async () => {
      const error = new Error('Tauri error');
      global.mockInvoke.mockRejectedValue(error);

      await expect(tauriService.createWorktree('/test', 'branch', 'name'))
        .rejects.toThrow('Tauri error');
    });

    it('handles network timeouts', async () => {
      const timeoutError = new Error('Request timed out');
      global.mockInvoke.mockRejectedValue(timeoutError);

      await expect(tauriService.startClaudeProcess('/test', 'id', 'message'))
        .rejects.toThrow('Request timed out');
    });
  });
});