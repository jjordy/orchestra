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
  // Force terminal remount when needed to ensure clean state
  const [terminalKey, setTerminalKey] = useState(0);


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

  const copyTerminalInfo = async () => {
    const terminalInfo = `Terminal Session - Worktree: ${worktree.name}
Path: ${worktree.path}
Session Time: ${new Date().toLocaleString()}

Note: Terminal output is interactive and cannot be copied programmatically.
You can select and copy text directly from the terminal above.`;

    try {
      await navigator.clipboard.writeText(terminalInfo);
    } catch (err) {
      console.error('Failed to copy terminal info:', err);
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
            onClick={copyTerminalInfo}
            title="Copy terminal session info"
          >
            Copy Info
          </button>
        </div>
      </div>

      {/* Terminal Content Area */}
      <div key={`terminal-container-${worktree.id}-${terminalKey}`} className="flex-1 p-4 flex flex-col min-h-0">
        <Terminal 
          key={`terminal-${worktree.id}-${terminalKey}`}
          worktreeId={worktree.id}
          worktreePath={worktree.path}
        />
      </div>
    </div>
  );
}