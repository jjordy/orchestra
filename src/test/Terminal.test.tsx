import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Terminal from '../components/Terminal';

describe('Terminal Component', () => {
  const defaultProps = {
    worktreeId: 'test-worktree-1',
    worktreePath: '/home/test/worktree-1',
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock successful PTY creation
    global.mockInvoke.mockResolvedValue('worktree-test-worktree-1');
    // Mock listen calls
    global.mockListen.mockResolvedValue(() => {});
  });

  afterEach(() => {
    // Clean up global state
    const ptySessionState = (Terminal as any).ptySessionState;
    if (ptySessionState) {
      ptySessionState.clear();
    }
  });

  describe('Component Rendering', () => {
    it('renders terminal container with header', async () => {
      await act(async () => {
        render(<Terminal {...defaultProps} />);
      });
      
      expect(screen.getByText('Terminal - worktree-1')).toBeInTheDocument();
      expect(screen.getByTitle('Restart Claude Code session')).toBeInTheDocument();
      expect(screen.getByTitle('Close terminal session')).toBeInTheDocument();
    });

    it('shows connection status', async () => {
      await act(async () => {
        render(<Terminal {...defaultProps} />);
      });
      
      await waitFor(() => {
        expect(screen.getByText('● Connected')).toBeInTheDocument();
      });
    });

    it('initializes xterm terminal', async () => {
      await act(async () => {
        render(<Terminal {...defaultProps} />);
      });
      
      expect(global.MockTerminal).toHaveBeenCalledWith(expect.objectContaining({
        theme: expect.any(Object),
        fontFamily: 'Monaco, Menlo, "Ubuntu Mono", monospace',
        fontSize: 14,
        cursorBlink: true,
      }));
    });
  });

  describe('PTY Session Management', () => {
    it('creates new PTY session for new worktree', async () => {
      render(<Terminal {...defaultProps} />);
      
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-1',
          workingDir: '/home/test/worktree-1',
        });
      });
    });

    it('reuses existing PTY session', async () => {
      // Mock existing session response
      global.mockInvoke.mockResolvedValue('existing:worktree-test-worktree-1');
      
      render(<Terminal {...defaultProps} />);
      
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-1',
          workingDir: '/home/test/worktree-1',
        });
      });
    });

    it('sets up event listeners for PTY output', async () => {
      render(<Terminal {...defaultProps} />);
      
      await waitFor(() => {
        expect(global.mockListen).toHaveBeenCalledWith(
          'pty-output-worktree-test-worktree-1',
          expect.any(Function)
        );
      });
    });

    it('handles PTY close events', async () => {
      render(<Terminal {...defaultProps} />);
      
      await waitFor(() => {
        expect(global.mockListen).toHaveBeenCalledWith(
          'pty-closed-worktree-test-worktree-1',
          expect.any(Function)
        );
      });
    });
  });

  describe('User Interactions', () => {
    it('handles restart Claude button click', async () => {
      const user = userEvent.setup();
      render(<Terminal {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByText('● Connected')).toBeInTheDocument();
      });

      const restartButton = screen.getByTitle('Restart Claude Code session');
      await user.click(restartButton);
      
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('write_to_pty', {
          ptyId: 'worktree-test-worktree-1',
          data: 'claude\r\n',
        });
      });
    });

    it('handles close button click', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<Terminal {...defaultProps} onClose={onClose} />);
      
      await waitFor(() => {
        expect(screen.getByText('● Connected')).toBeInTheDocument();
      });

      const closeButton = screen.getByTitle('Close terminal session');
      await user.click(closeButton);
      
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('close_pty', {
          ptyId: 'worktree-test-worktree-1',
        });
      });
    });
  });

  describe('Session Persistence', () => {
    it('maintains separate sessions for different worktrees', async () => {
      const { unmount } = render(<Terminal {...defaultProps} />);
      
      // Wait for first session to initialize
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-1',
          workingDir: '/home/test/worktree-1',
        });
      });

      unmount();

      // Render different worktree
      render(<Terminal 
        worktreeId="test-worktree-2"
        worktreePath="/home/test/worktree-2"
        onClose={vi.fn()}
      />);
      
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-2',
          workingDir: '/home/test/worktree-2',
        });
      });
    });

    it('preserves session when component remounts', async () => {
      const { unmount } = render(<Terminal {...defaultProps} />);
      
      // Wait for session to initialize
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-1',
          workingDir: '/home/test/worktree-1',
        });
      });

      unmount();
      vi.clearAllMocks();

      // Mock existing session for remount
      global.mockInvoke.mockResolvedValue('existing:worktree-test-worktree-1');
      
      render(<Terminal {...defaultProps} />);
      
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-1',
          workingDir: '/home/test/worktree-1',
        });
      });
    });
  });

  describe('Auto-launch Claude', () => {
    it('auto-launches Claude for new sessions', async () => {
      vi.useFakeTimers();
      render(<Terminal {...defaultProps} />);
      
      // Wait for PTY initialization
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-1',
          workingDir: '/home/test/worktree-1',
        });
      });

      // Fast-forward to auto-launch timeout
      vi.advanceTimersByTime(1500);
      
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('write_to_pty', {
          ptyId: 'worktree-test-worktree-1',
          data: 'claude\r\n',
        });
      });
      
      vi.useRealTimers();
    });

    it('does not auto-launch Claude for existing sessions', async () => {
      vi.useFakeTimers();
      global.mockInvoke.mockResolvedValue('existing:worktree-test-worktree-1');
      
      render(<Terminal {...defaultProps} />);
      
      // Wait for PTY initialization
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-test-worktree-1',
          workingDir: '/home/test/worktree-1',
        });
      });

      // Fast-forward past auto-launch timeout
      vi.advanceTimersByTime(2000);
      
      // Should not auto-launch for existing sessions
      expect(global.mockInvoke).not.toHaveBeenCalledWith('write_to_pty', 
        expect.objectContaining({
          data: 'claude\r\n',
        })
      );
      
      vi.useRealTimers();
    });
  });

  describe('Error Handling', () => {
    it('handles PTY creation failure', async () => {
      global.mockInvoke.mockRejectedValue(new Error('PTY creation failed'));
      
      render(<Terminal {...defaultProps} />);
      
      await waitFor(() => {
        expect(screen.getByText('○ Disconnected')).toBeInTheDocument();
      });
    });

    it('handles PTY write failure', async () => {
      const user = userEvent.setup();
      render(<Terminal {...defaultProps} />);
      
      // Wait for initialization
      await waitFor(() => {
        expect(screen.getByText('● Connected')).toBeInTheDocument();
      });

      // Mock write failure
      global.mockInvoke.mockRejectedValueOnce(new Error('Write failed'));
      
      const restartButton = screen.getByTitle('Restart Claude Code session');
      await user.click(restartButton);
      
      // Should handle error gracefully
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('write_to_pty', 
          expect.any(Object)
        );
      });
    });
  });
});