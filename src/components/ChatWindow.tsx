import { useState, useRef, useEffect } from 'react';
import { WorktreeConfig, WorktreeChat, ChatMessage } from '../types';
import { tauriService } from '../services/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import Terminal from './Terminal';

interface ChatWindowProps {
  worktree: WorktreeConfig;
  chat: WorktreeChat;
  onChatUpdated: (chat: WorktreeChat) => void;
}

export default function ChatWindow({ worktree, chat, onChatUpdated }: ChatWindowProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Store terminal state per worktree in localStorage
  const [showTerminal, setShowTerminal] = useState(() => {
    const saved = localStorage.getItem(`terminal-mode-${worktree.id}`);
    return saved === 'true';
  });
  
  // Force terminal remount when toggling to ensure clean state
  const [terminalKey, setTerminalKey] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chat.messages]);

  // Listen for Claude output events
  useEffect(() => {
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenCompleted: UnlistenFn | undefined;

    const setupListeners = async () => {
      // Listen for Claude output
      unlistenOutput = await listen('claude-output', (event: any) => {
        const output = event.payload;
        
        if (chat.process && output.process_id === chat.process.id) {
          const outputMessage: ChatMessage = {
            id: `output-${Date.now()}-${Math.random()}`,
            worktree_id: worktree.id,
            role: 'assistant',
            content: output.content,
            timestamp: output.timestamp,
            status: 'sent',
          };

          const updatedChat = {
            ...chat,
            messages: [...chat.messages, outputMessage],
          };
          onChatUpdated(updatedChat);
        }
      });

      // Listen for Claude completion
      unlistenCompleted = await listen('claude-completed', (event: any) => {
        const completionData = event.payload;
        
        if (chat.process && completionData.process_id === chat.process.id) {
          setIsProcessing(false);
          const updatedChat = {
            ...chat,
            process: {
              ...chat.process!,
              status: completionData.success ? 'completed' : 'error',
            }
          };
          onChatUpdated(updatedChat);
        }
      });
    };

    setupListeners();

    return () => {
      if (unlistenOutput) unlistenOutput();
      if (unlistenCompleted) unlistenCompleted();
    };
  }, [chat.process?.id, chat.messages.length, worktree.id]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || sending) return;

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      worktree_id: worktree.id,
      role: 'user',
      content: message.trim(),
      timestamp: new Date().toISOString(),
      status: 'sending',
    };

    // Add user message immediately
    const updatedChat = {
      ...chat,
      messages: [...chat.messages, userMessage],
    };
    onChatUpdated(updatedChat);
    setMessage('');
    setSending(true);

    try {
      // Mark user message as sent
      userMessage.status = 'sent';
      let currentChat = {
        ...updatedChat,
        messages: updatedChat.messages.map(msg => 
          msg.id === userMessage.id ? userMessage : msg
        )
      };
      onChatUpdated(currentChat);
      setIsProcessing(true);
      
      const permissionMode = localStorage.getItem('claude-permission-mode') || 'safe';
      
      if (chat.process && chat.process.status === 'running') {
        // Send message (spawns new Claude process since --print mode exits)
        await tauriService.sendMessageToClaude(worktree.path, worktree.id, userMessage.content, permissionMode);
      } else {
        // Start new Claude Code process
        const process = await tauriService.startClaudeProcess(worktree.path, worktree.id, userMessage.content, permissionMode);
        
        currentChat = {
          ...currentChat,
          process: process
        };
        onChatUpdated(currentChat);
      }

    } catch (error) {
      console.error('Failed to send message:', error);
      userMessage.status = 'error';
      onChatUpdated({
        ...updatedChat,
        messages: updatedChat.messages.map(msg => 
          msg.id === userMessage.id ? userMessage : msg
        )
      });
    } finally {
      setSending(false);
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const copyChat = async () => {
    const chatText = chat.messages.map(msg => {
      const timestamp = formatTime(msg.timestamp);
      const role = msg.role === 'user' ? 'You' : 'Claude';
      return `[${timestamp}] ${role}: ${msg.content}`;
    }).join('\n\n');

    const fullText = `Chat with Claude Code - Worktree: ${worktree.name}
Path: ${worktree.path}
Started: ${new Date().toLocaleString()}

${chatText}`;

    try {
      await navigator.clipboard.writeText(fullText);
    } catch (err) {
      console.error('Failed to copy chat:', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-claude-dark-900">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-claude-dark-800 border-b border-claude-dark-700">
        <div className="flex items-center space-x-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{worktree.name}</h2>
            <p className="text-xs text-claude-dark-400 font-mono">{worktree.path}</p>
          </div>
          {chat.process && (
            <div className={`flex items-center space-x-2 text-xs px-3 py-1 rounded-full ${
              chat.process.status === 'running' ? 'bg-green-900/20 text-green-400 border border-green-800' :
              chat.process.status === 'completed' ? 'bg-blue-900/20 text-blue-400 border border-blue-800' :
              'bg-claude-dark-700 text-claude-dark-400 border border-claude-dark-600'
            }`}>
              {chat.process.status === 'running' && (
                <>
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span>Working</span>
                </>
              )}
              {chat.process.status === 'completed' && <span>Completed</span>}
              {chat.process.status === 'idle' && <span>Idle</span>}
            </div>
          )}
        </div>
        
        <div className="flex items-center space-x-2">
          <button 
            className="text-sm px-3 py-1.5 bg-claude-dark-700 hover:bg-claude-dark-600 text-claude-dark-300 rounded transition-colors"
            onClick={copyChat}
            title="Copy chat content"
          >
            Copy Chat
          </button>
          <button 
            className={`text-sm px-3 py-1.5 rounded transition-colors ${
              localStorage.getItem('claude-permission-mode') === 'full' 
                ? 'bg-red-900/20 text-red-400 border border-red-800 hover:bg-red-900/30' 
                : 'bg-green-900/20 text-green-400 border border-green-800 hover:bg-green-900/30'
            }`}
            onClick={() => {
              const newMode = localStorage.getItem('claude-permission-mode') === 'full' ? 'safe' : 'full';
              localStorage.setItem('claude-permission-mode', newMode);
              window.location.reload(); // Simple way to update all UI
            }}
            title="Toggle permission level"
          >
            {localStorage.getItem('claude-permission-mode') === 'full' ? 'Full Mode' : 'Safe Mode'}
          </button>
          <button 
            className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            onClick={() => {
              const newTerminalState = !showTerminal;
              setShowTerminal(newTerminalState);
              localStorage.setItem(`terminal-mode-${worktree.id}`, newTerminalState.toString());
              if (newTerminalState) {
                setTerminalKey(prev => prev + 1);
              }
            }}
            title={showTerminal ? "Switch to Chat" : "Switch to Terminal"}
          >
            {showTerminal ? 'Chat' : 'Terminal'}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {showTerminal ? (
        <div key={`terminal-container-${worktree.id}-${terminalKey}`} className="flex-1 p-4">
          <Terminal 
            key={`terminal-${worktree.id}-${terminalKey}`}
            worktreeId={worktree.id}
            worktreePath={worktree.path}
          />
        </div>
      ) : (
        <>
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {chat.messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center max-w-md">
                  <h3 className="text-xl font-semibold text-claude-dark-100 mb-4">
                    Start a conversation
                  </h3>
                  <p className="text-claude-dark-400 text-sm">
                    Send a message to start working with Claude Code in this workspace.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-w-4xl mx-auto">
                {chat.messages.map((msg, index) => {
                  const isLastMessage = index === chat.messages.length - 1;
                  return (
                    <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] ${msg.role === 'user' ? 'order-2' : 'order-1'}`}>
                        <div className={`px-4 py-3 rounded-lg ${
                          msg.role === 'user' 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-claude-dark-800 text-claude-dark-100 border border-claude-dark-700'
                        }`}>
                          <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                          {isLastMessage && isProcessing && msg.role === 'user' && (
                            <div className="mt-3 pt-3 border-t border-blue-500/30 flex items-center space-x-2">
                              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                              <span className="text-xs text-white/70">Claude is thinking...</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 mt-1 px-1">
                          <span className="text-xs text-claude-dark-500">{formatTime(msg.timestamp)}</span>
                          {msg.status && msg.status !== 'sent' && (
                            <span className={`text-xs ${
                              msg.status === 'error' ? 'text-red-400' : 'text-claude-dark-500'
                            }`}>
                              {msg.status}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area */}
          <form onSubmit={sendMessage} className="px-6 py-4 bg-claude-dark-800 border-t border-claude-dark-700">
            <div className="flex space-x-3 max-w-4xl mx-auto">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`Ask Claude anything...`}
                className="flex-1 bg-claude-dark-700 border border-claude-dark-600 rounded-lg px-4 py-3 text-sm text-white placeholder-claude-dark-400 focus:outline-none focus:border-claude-dark-400"
                disabled={sending}
                autoFocus
              />
              <button 
                type="submit" 
                disabled={!message.trim() || sending}
                className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-claude-dark-700 disabled:text-claude-dark-500 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}