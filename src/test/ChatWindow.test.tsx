import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('ChatWindow Component', () => {
  const defaultWorktree = {
    id: 'test-worktree-1',
    name: 'Feature Branch',
    path: '/home/test/feature-branch',
    branch: 'feature-branch',
    base_repo: '/home/test/main-repo',
    is_active: true,
    created_at: '2024-01-01T00:00:00Z',
  };

  const defaultChat = {
    id: 'chat-1',
    worktree_id: 'test-worktree-1',
    messages: [],
    created_at: '2024-01-01T00:00:00Z',
    process: null,
  };

  const defaultProps = {
    worktree: defaultWorktree,
    chat: defaultChat,
    onChatUpdated: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.getItem.mockReturnValue(null);
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  describe('Component Rendering', () => {
    it('renders chat interface by default', () => {
      render(<ChatWindow {...defaultProps} />);
      
      expect(screen.getByText('Feature Branch')).toBeInTheDocument();
      expect(screen.getByText('/home/test/feature-branch')).toBeInTheDocument();
      expect(screen.getByText('Start a conversation')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('Message Claude Code for Feature Branch...')).toBeInTheDocument();
    });

    it('shows terminal when terminal mode is enabled', () => {
      localStorageMock.getItem.mockReturnValue('true');
      
      render(<ChatWindow {...defaultProps} />);
      
      // Should show terminal instead of chat
      expect(screen.getByText('Terminal - feature-branch')).toBeInTheDocument();
      expect(screen.queryByText('Start a conversation')).not.toBeInTheDocument();
    });

    it('displays existing messages', () => {
      const chatWithMessages = {
        ...defaultChat,
        messages: [
          {
            id: 'msg-1',
            worktree_id: 'test-worktree-1',
            role: 'user' as const,
            content: 'Hello Claude',
            timestamp: '2024-01-01T00:00:00Z',
            status: 'sent' as const,
          },
          {
            id: 'msg-2',
            worktree_id: 'test-worktree-1',
            role: 'assistant' as const,
            content: 'Hello! How can I help?',
            timestamp: '2024-01-01T00:01:00Z',
            status: 'sent' as const,
          },
        ],
      };

      render(<ChatWindow {...defaultProps} chat={chatWithMessages} />);

      expect(screen.getByText('Hello Claude')).toBeInTheDocument();
      expect(screen.getByText('Hello! How can I help?')).toBeInTheDocument();
    });
  });

  describe('Header Actions', () => {
    it('shows permission mode toggle', () => {
      render(<ChatWindow {...defaultProps} />);
      
      expect(screen.getByTitle('Toggle permission level')).toBeInTheDocument();
      expect(screen.getByText(/Safe Mode/)).toBeInTheDocument();
    });

    it('toggles between chat and terminal mode', async () => {
      const user = userEvent.setup();
      render(<ChatWindow {...defaultProps} />);
      
      const toggleButton = screen.getByTitle('Switch to Terminal');
      await user.click(toggleButton);
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith('terminal-mode-test-worktree-1', 'true');
    });

    it('copies chat content', async () => {
      const user = userEvent.setup();
      
      // Mock clipboard API
      const mockWriteText = vi.fn();
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
      });

      const chatWithMessages = {
        ...defaultChat,
        messages: [
          {
            id: 'msg-1',
            worktree_id: 'test-worktree-1',
            role: 'user' as const,
            content: 'Test message',
            timestamp: '2024-01-01T00:00:00Z',
            status: 'sent' as const,
          },
        ],
      };

      render(<ChatWindow {...defaultProps} chat={chatWithMessages} />);

      const copyButton = screen.getByTitle('Copy chat content');
      await user.click(copyButton);

      expect(mockWriteText).toHaveBeenCalledWith(
        expect.stringContaining('Test message')
      );
    });
  });

  describe('Message Sending', () => {
    it('sends user message and starts Claude process', async () => {
      const user = userEvent.setup();
      const onChatUpdated = vi.fn();
      
      global.mockInvoke.mockResolvedValueOnce({
        id: 'process-1',
        worktree_id: 'test-worktree-1',
        status: 'running',
      });

      render(<ChatWindow {...defaultProps} onChatUpdated={onChatUpdated} />);

      const input = screen.getByPlaceholderText('Message Claude Code for Feature Branch...');
      const sendButton = screen.getByText('Send');

      await user.type(input, 'Hello Claude');
      await user.click(sendButton);

      // Should add user message immediately
      expect(onChatUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'user',
              content: 'Hello Claude',
              status: 'sending',
            }),
          ]),
        })
      );

      // Should start Claude process
      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('start_claude_process', 
          expect.objectContaining({
            worktreePath: '/home/test/feature-branch',
            worktreeId: 'test-worktree-1',
            userMessage: 'Hello Claude',
          })
        );
      });
    });

    it('prevents sending empty messages', async () => {
      const user = userEvent.setup();
      render(<ChatWindow {...defaultProps} />);

      const sendButton = screen.getByText('Send');
      expect(sendButton).toBeDisabled();

      const input = screen.getByPlaceholderText('Message Claude Code for Feature Branch...');
      await user.type(input, '   '); // Only whitespace

      expect(sendButton).toBeDisabled();
    });

    it('handles send message error', async () => {
      const user = userEvent.setup();
      const onChatUpdated = vi.fn();
      
      global.mockInvoke.mockRejectedValueOnce(new Error('Process failed'));

      render(<ChatWindow {...defaultProps} onChatUpdated={onChatUpdated} />);

      const input = screen.getByPlaceholderText('Message Claude Code for Feature Branch...');
      await user.type(input, 'Test message');
      await user.click(screen.getByText('Send'));

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

  describe('Process Status Display', () => {
    it('shows process status badges', () => {
      const chatWithProcess = {
        ...defaultChat,
        process: {
          id: 'process-1',
          worktree_id: 'test-worktree-1',
          status: 'running',
          pid: 12345,
          task: 'test task',
          started_at: '2024-01-01T00:00:00Z',
          last_activity: '2024-01-01T00:01:00Z',
        },
      };

      render(<ChatWindow {...defaultProps} chat={chatWithProcess} />);

      expect(screen.getByText('⚡ Working...')).toBeInTheDocument();
    });

    it('shows different status states', () => {
      const statuses = [
        { status: 'starting', text: '🚀 Starting...' },
        { status: 'completed', text: '✅ Completed' },
        { status: 'idle', text: '💤 Idle' },
        { status: 'stopped', text: '⏹ Stopped' },
      ];

      statuses.forEach(({ status, text }) => {
        const chatWithProcess = {
          ...defaultChat,
          process: {
            id: 'process-1',
            worktree_id: 'test-worktree-1',
            status,
          },
        };

        const { rerender } = render(<ChatWindow {...defaultProps} chat={chatWithProcess} />);
        expect(screen.getByText(text)).toBeInTheDocument();
        rerender(<div />); // Cleanup
      });
    });
  });

  describe('Message Processing', () => {
    it('shows processing indicator for last user message', () => {
      const chatWithProcessing = {
        ...defaultChat,
        messages: [
          {
            id: 'msg-1',
            worktree_id: 'test-worktree-1',
            role: 'user' as const,
            content: 'Test message',
            timestamp: '2024-01-01T00:00:00Z',
            status: 'sent' as const,
          },
        ],
        process: {
          id: 'process-1',
          worktree_id: 'test-worktree-1',
          status: 'running',
        },
      };

      const { container } = render(<ChatWindow {...defaultProps} chat={chatWithProcessing} />);

      // Mock isProcessing state (this would be set during actual processing)
      expect(container.querySelector('.processing-indicator')).toBeInTheDocument();
    });
  });

  describe('Permission Modes', () => {
    it('uses safe mode by default', async () => {
      const user = userEvent.setup();
      
      global.mockInvoke.mockResolvedValueOnce({
        id: 'process-1',
        status: 'running',
      });

      render(<ChatWindow {...defaultProps} />);

      const input = screen.getByPlaceholderText('Message Claude Code for Feature Branch...');
      await user.type(input, 'Test message');
      await user.click(screen.getByText('Send'));

      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('start_claude_process', 
          expect.objectContaining({
            permissionMode: 'safe',
          })
        );
      });
    });

    it('uses stored permission mode', async () => {
      const user = userEvent.setup();
      localStorageMock.getItem.mockImplementation((key) => {
        if (key === 'claude-permission-mode') return 'full';
        return null;
      });
      
      global.mockInvoke.mockResolvedValueOnce({
        id: 'process-1',
        status: 'running',
      });

      render(<ChatWindow {...defaultProps} />);

      const input = screen.getByPlaceholderText('Message Claude Code for Feature Branch...');
      await user.type(input, 'Test message');
      await user.click(screen.getByText('Send'));

      await waitFor(() => {
        expect(global.mockInvoke).toHaveBeenCalledWith('start_claude_process', 
          expect.objectContaining({
            permissionMode: 'full',
          })
        );
      });
    });
  });
});