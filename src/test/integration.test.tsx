import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Terminal from '../components/Terminal';
import ChatWindow from '../components/ChatWindow';

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', { 
  value: localStorageMock 
});

describe('Integration Tests - Terminal & Chat', () => {
  const worktree1 = {
    id: 'worktree-1',
    name: 'Feature A',
    path: '/home/test/feature-a',
    branch: 'feature-a',
    base_repo: '/home/test/repo',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  };

  const worktree2 = {
    id: 'worktree-2',
    name: 'Feature B',
    path: '/home/test/feature-b',
    branch: 'feature-b',
    base_repo: '/home/test/repo',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  };

  const emptyChat = {
    id: 'chat-1',
    worktree_id: 'worktree-1',
    messages: [],
    created_at: '2024-01-01T00:00:00Z',
    process: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
    
    // Mock successful PTY creation
    global.mockInvoke
      .mockResolvedValueOnce('worktree-worktree-1') // First worktree PTY
      .mockResolvedValueOnce('worktree-worktree-2'); // Second worktree PTY
  });

  afterEach(() => {
    localStorageMock.clear();
    // Clean up global PTY state
    const Terminal = require('../components/Terminal').default;
    if (Terminal.ptySessionState) {
      Terminal.ptySessionState.clear();
    }
  });

  describe('Terminal Session Isolation', () => {
    it('creates separate PTY sessions for different worktrees', async () => {
      const { unmount: unmount1 } = render(
        <Terminal 
          worktreeId={worktree1.id}
          worktreePath={worktree1.path}
        />
      );

      // Wait for first PTY to initialize
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-worktree-1',
          workingDir: '/home/test/feature-a',
        });
      });

      unmount1();

      // Render second worktree terminal
      render(
        <Terminal 
          worktreeId={worktree2.id}
          worktreePath={worktree2.path}
        />
      );

      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-worktree-2',
          workingDir: '/home/test/feature-b',
        });
      });

      // Should have created two separate PTY sessions
      expect(global.mockInvoke).toHaveBeenCalledTimes(2);
    });

    it('reuses existing PTY session when switching back to worktree', async () => {
      // First render
      const { unmount: unmount1 } = render(
        <Terminal 
          worktreeId={worktree1.id}
          worktreePath={worktree1.path}
        />
      );

      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-worktree-1',
          workingDir: '/home/test/feature-a',
        });
      });

      unmount1();
      vi.clearAllMocks();

      // Mock existing session response
      global.mockInvoke.mockResolvedValue('existing:worktree-worktree-1');

      // Re-render same worktree
      render(
        <Terminal 
          worktreeId={worktree1.id}
          worktreePath={worktree1.path}
        />
      );

      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-worktree-1',
          workingDir: '/home/test/feature-a',
        });
      });

      // Should attempt to create but get existing session
      expect(global.mockInvoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('Chat-Terminal Integration', () => {
    it('switches between chat and terminal modes', async () => {
      const user = userEvent.setup();
      localStorageMock.getItem.mockReturnValue('false'); // Start in chat mode

      const { rerender } = render(
        <ChatWindow 
          worktree={worktree1}
          chat={emptyChat}
          onChatUpdated={vi.fn()}
        />
      );

      // Should show chat initially
      expect(screen.getByText('Start a conversation')).toBeInTheDocument();
      expect(screen.queryByText('Terminal - feature-a')).not.toBeInTheDocument();

      // Click terminal toggle
      const toggleButton = screen.getByTitle('Switch to Terminal');
      await user.click(toggleButton);

      // Should have updated localStorage
      expect(localStorageMock.setItem).toHaveBeenCalledWith('terminal-mode-worktree-1', 'true');

      // Re-render with terminal mode enabled
      localStorageMock.getItem.mockImplementation(key => 
        key === 'terminal-mode-worktree-1' ? 'true' : null
      );

      rerender(
        <ChatWindow 
          worktree={worktree1}
          chat={emptyChat}
          onChatUpdated={vi.fn()}
        />
      );

      // Should show terminal now
      await waitFor(() => {
        expect(screen.getByText('Terminal - feature-a')).toBeInTheDocument();
      });
      expect(screen.queryByText('Start a conversation')).not.toBeInTheDocument();
    });

    it('maintains separate terminal modes per worktree', async () => {
      const user = userEvent.setup();
      
      // Set worktree-1 to terminal mode, worktree-2 to chat mode
      localStorageMock.getItem.mockImplementation(key => {
        if (key === 'terminal-mode-worktree-1') return 'true';
        if (key === 'terminal-mode-worktree-2') return 'false';
        return null;
      });

      // Render worktree-1 (should show terminal)
      const { rerender } = render(
        <ChatWindow 
          worktree={worktree1}
          chat={{...emptyChat, worktree_id: 'worktree-1'}}
          onChatUpdated={vi.fn()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Terminal - feature-a')).toBeInTheDocument();
      });

      // Switch to worktree-2 (should show chat)
      rerender(
        <ChatWindow 
          worktree={worktree2}
          chat={{...emptyChat, id: 'chat-2', worktree_id: 'worktree-2'}}
          onChatUpdated={vi.fn()}
        />
      );

      expect(screen.getByText('Start a conversation')).toBeInTheDocument();
      expect(screen.queryByText('Terminal')).not.toBeInTheDocument();
    });
  });

  describe('Multi-Worktree Parallel Operations', () => {
    it('handles simultaneous terminal sessions', async () => {
      // Render two terminals simultaneously
      render(
        <div>
          <Terminal 
            worktreeId={worktree1.id}
            worktreePath={worktree1.path}
          />
          <Terminal 
            worktreeId={worktree2.id}
            worktreePath={worktree2.path}
          />
        </div>
      );

      // Both should initialize their PTY sessions
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-worktree-1',
          workingDir: '/home/test/feature-a',
        });
        expect(global.mockInvoke).toHaveBeenCalledWith('create_worktree_pty', {
          ptyId: 'worktree-worktree-2',
          workingDir: '/home/test/feature-b',
        });
      });

      // Should have separate connection statuses
      const connections = screen.getAllByText('● Connected');
      expect(connections).toHaveLength(2);
    });

    it('handles simultaneous chat processes', async () => {
      const user = userEvent.setup();
      
      global.mockInvoke
        .mockResolvedValueOnce({ id: 'process-1', status: 'running' })
        .mockResolvedValueOnce({ id: 'process-2', status: 'running' });

      const onChatUpdated1 = vi.fn();
      const onChatUpdated2 = vi.fn();

      render(
        <div>
          <ChatWindow 
            worktree={worktree1}
            chat={{...emptyChat, worktree_id: 'worktree-1'}}
            onChatUpdated={onChatUpdated1}
          />
          <ChatWindow 
            worktree={worktree2}
            chat={{...emptyChat, id: 'chat-2', worktree_id: 'worktree-2'}}
            onChatUpdated={onChatUpdated2}
          />
        </div>
      );

      // Send messages to both chats
      const inputs = screen.getAllByRole('textbox');
      const sendButtons = screen.getAllByText('Send');

      await user.type(inputs[0], 'Message to Feature A');
      await user.click(sendButtons[0]);

      await user.type(inputs[1], 'Message to Feature B');
      await user.click(sendButtons[1]);

      // Both should start separate Claude processes
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('start_claude_process', 
          expect.objectContaining({
            worktreePath: '/home/test/feature-a',
            worktreeId: 'worktree-1',
            userMessage: 'Message to Feature A',
          })
        );
        expect(global.mockInvoke).toHaveBeenCalledWith('start_claude_process', 
          expect.objectContaining({
            worktreePath: '/home/test/feature-b',
            worktreeId: 'worktree-2',
            userMessage: 'Message to Feature B',
          })
        );
      });
    });
  });

  describe('Error Recovery', () => {
    it('handles PTY creation failure gracefully', async () => {
      global.mockInvoke.mockRejectedValue(new Error('PTY creation failed'));

      render(
        <Terminal 
          worktreeId={worktree1.id}
          worktreePath={worktree1.path}
        />
      );

      // Should show disconnected state
      await waitFor(() => {
        expect(screen.getByText('○ Disconnected')).toBeInTheDocument();
      });

      // Terminal should still render other elements
      expect(screen.getByText('Terminal - feature-a')).toBeInTheDocument();
      expect(screen.getByTitle('Restart Claude Code session')).toBeDisabled();
    });

    it('handles Claude process failure gracefully', async () => {
      const user = userEvent.setup();
      const onChatUpdated = vi.fn();
      
      global.mockInvoke.mockRejectedValue(new Error('Claude process failed'));

      render(
        <ChatWindow 
          worktree={worktree1}
          chat={emptyChat}
          onChatUpdated={onChatUpdated}
        />
      );

      const input = screen.getByRole('textbox');
      await user.type(input, 'Test message');
      await user.click(screen.getByText('Send'));

      // Should mark message as error
      await waitFor(() => {
        expect(onChatUpdated).toHaveBeenCalledWith(
          expect.objectContaining({
            messages: expect.arrayContaining([
              expect.objectContaining({
                status: 'error',
              }),
            ]),
          })
        );
      });
    });
  });
});