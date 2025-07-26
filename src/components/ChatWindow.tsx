import { useState, useRef, useEffect } from 'react';
import { WorktreeConfig, WorktreeChat, ChatMessage, ApprovalRequest, ApprovalResponse } from '../types';
import { tauriService } from '../services/tauri';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Loader, CheckCircle, XCircle, AlertCircle } from 'lucide-react';

interface ChatWindowProps {
  worktree: WorktreeConfig;
  chat: WorktreeChat;
  onChatUpdated: (chat: WorktreeChat) => void;
}

export default function ChatWindow({ worktree, chat, onChatUpdated }: ChatWindowProps) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mcpServerId, setMcpServerId] = useState<string | null>(null);
  const [mcpServerStatus, setMcpServerStatus] = useState<boolean>(false);
  const [, setPendingApprovals] = useState<Array<[string, ApprovalRequest]>>([]);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const processingTimeoutRef = useRef<number | null>(null);
  const lastProcessedMessageId = useRef<string | null>(null);
  const processedApprovalIds = useRef<Set<string>>(new Set());



  // Initialize MCP server for this worktree
  useEffect(() => {
    const initializeMcpServer = async () => {
      try {
        console.log('Creating MCP server for worktree:', worktree.id, worktree.path);
        const serverId = await tauriService.createMcpServer(worktree.id, worktree.path);
        console.log('MCP server created with ID:', serverId);
        setMcpServerId(serverId);
        
        // Check status after a brief delay to allow server to start
        setTimeout(async () => {
          try {
            const status = await tauriService.getMcpServerStatus(serverId);
            console.log('MCP server status:', status);
            setMcpServerStatus(status);
          } catch (error) {
            console.error('Failed to get MCP server status:', error);
          }
        }, 1000);
      } catch (error) {
        console.error('Failed to create MCP server:', error);
        // Show error to user
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          worktree_id: worktree.id,
          role: 'assistant',
          content: `Failed to start MCP server: ${error}. Please check that the MCP server is built by running 'npm run build' in the mcp-server directory.`,
          timestamp: new Date().toISOString(),
          status: 'sent',
        };
        
        onChatUpdated((prevChat) => ({
          ...prevChat,
          messages: [...prevChat.messages, errorMessage],
        }));
      }
    };

    initializeMcpServer();

    return () => {
      if (mcpServerId) {
        tauriService.stopMcpServer(mcpServerId).catch(console.error);
      }
    };
  }, [worktree.id, worktree.path]);

  // Poll MCP server status periodically
  useEffect(() => {
    if (!mcpServerId) return;

    const checkStatus = async () => {
      try {
        const status = await tauriService.getMcpServerStatus(mcpServerId);
        setMcpServerStatus(status);
      } catch (error) {
        console.error('Failed to check MCP server status:', error);
        setMcpServerStatus(false);
      }
    };

    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [mcpServerId]);

  // Listen for Claude output and approval requests
  useEffect(() => {
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenCompleted: UnlistenFn | undefined;
    let unlistenApproval: UnlistenFn | undefined;

    const setupListeners = async () => {
      console.log('🎧 Setting up event listeners for worktree:', worktree.id);
      
      // Listen for Claude output
      unlistenOutput = await listen('claude-output', (event: any) => {
        const output = event.payload;
        console.log('🟢 UI: Received claude-output event:', output);
        console.log('🟢 UI: Event for process:', output.process_id);
        
        // Create a unique ID for this output to prevent duplicates
        const outputId = `${output.process_id}-${output.timestamp}-${output.content.substring(0, 50)}`;
        
        // Check if we've already processed this exact message
        if (lastProcessedMessageId.current === outputId) {
          console.log('🟡 UI: Duplicate message detected, skipping:', outputId);
          return;
        }
        
        lastProcessedMessageId.current = outputId;
        
        // Get the current chat state to ensure we have the latest process info
        onChatUpdated((currentChat) => {
          console.log('🟢 UI: Current chat process:', currentChat.process?.id);
          console.log('🟢 UI: Current messages count:', currentChat.messages.length);
          
          // Accept output from any process for this worktree
          // This handles the case where a new process was created
          const outputMessage: ChatMessage = {
            id: `output-${Date.now()}-${Math.random()}`,
            worktree_id: worktree.id,
            role: 'assistant',
            content: output.content,
            timestamp: output.timestamp,
            status: 'sent',
          };

          console.log('🟢 UI: Adding output message:', outputMessage.content.substring(0, 100) + '...');
          const updatedChat = {
            ...currentChat,
            messages: [...currentChat.messages, outputMessage],
            // Update process if we have one from the output
            process: currentChat.process || {
              id: output.process_id,
              worktree_id: worktree.id,
              status: 'running' as const,
            }
          };
          
          console.log('🟢 UI: New messages count:', updatedChat.messages.length);
          return updatedChat;
        });
      });

      // Listen for Claude completion
      unlistenCompleted = await listen('claude-completed', (event: any) => {
        const completionData = event.payload;
        console.log('✅ Received claude-completed event:', completionData);
        
        onChatUpdated((currentChat) => {
          // Clear processing state regardless of process match
          setIsProcessing(false);
          
          // Clear the processing timeout
          if (processingTimeoutRef.current) {
            clearTimeout(processingTimeoutRef.current);
            processingTimeoutRef.current = null;
          }
          
          // Update process status if we have a matching process
          if (currentChat.process && completionData.process_id === currentChat.process.id) {
            console.log('✅ Completion matches current process, updating status');
            return {
              ...currentChat,
              process: {
                ...currentChat.process,
                status: (completionData.success ? 'completed' : 'error') as 'completed' | 'error',
              }
            };
          }
          
          return currentChat;
        });
      });

      // Listen for approval requests
      unlistenApproval = await listen('tool-approval-request', (event: any) => {
        console.log('🚨 APPROVAL REQUEST EVENT RECEIVED:', event.payload);
        const { approval_id, request } = event.payload;
        
        // Check if we've already processed this approval
        if (processedApprovalIds.current.has(approval_id)) {
          console.log('🟡 UI: Duplicate approval request detected, skipping:', approval_id);
          return;
        }
        
        processedApprovalIds.current.add(approval_id);
        
        if (request.worktreeId === worktree.id) {
          console.log('🚨 Approval request matches worktree, adding to chat');
          
          onChatUpdated((currentChat) => {
            // Create an approval message in the chat
            const approvalMessage: ChatMessage = {
              id: `approval-${Date.now()}-${approval_id}`,
              worktree_id: worktree.id,
              role: 'approval',
              content: `Claude wants to ${request.toolName.replace(/_/g, ' ')}: ${JSON.stringify(request.input, null, 2)}`,
              timestamp: new Date().toISOString(),
              status: 'sent',
              approvalRequest: {
                approvalId: approval_id,
                toolName: request.toolName,
                input: request.input,
              },
            };
            
            return {
              ...currentChat,
              messages: [...currentChat.messages, approvalMessage],
            };
          });
        } else {
          console.log('🚨 Approval request does not match worktree:', {
            requestWorktreeId: request.worktreeId,
            currentWorktreeId: worktree.id
          });
        }
      });
    };

    setupListeners();

    return () => {
      console.log('🔌 Cleaning up event listeners for worktree:', worktree.id);
      if (unlistenOutput) unlistenOutput();
      if (unlistenCompleted) unlistenCompleted();
      if (unlistenApproval) unlistenApproval();
      
      // Clear tracking references to prevent memory leaks
      lastProcessedMessageId.current = null;
      processedApprovalIds.current.clear();
    };
  }, [worktree.id]); // Only depend on worktree.id to avoid recreating listeners


  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chat.messages]);

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
    onChatUpdated((prevChat) => ({
      ...prevChat,
      messages: [...prevChat.messages, userMessage],
    }));
    setMessage('');
    setSending(true);

    try {
      // Mark user message as sent
      userMessage.status = 'sent';
      onChatUpdated((prevChat) => ({
        ...prevChat,
        messages: prevChat.messages.map(msg => 
          msg.id === userMessage.id ? userMessage : msg
        )
      }));
      console.log('Setting isProcessing to true');
      setIsProcessing(true);
      
      // Set a timeout to clear processing state if no completion event is received
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
      }
      processingTimeoutRef.current = setTimeout(() => {
        console.log('Processing timeout reached, clearing processing state');
        setIsProcessing(false);
      }, 60000); // 60 seconds timeout
      
      const permissionMode = 'mcp'; // Use MCP mode for tool approvals
      
      if (chat.process && chat.process.status === 'running') {
        console.log('Sending message to existing Claude process:', chat.process.id);
        // Send message to existing Claude process (which creates a new process in --print mode)
        await tauriService.sendMessageToClaude(worktree.path, worktree.id, userMessage.content, permissionMode);
      } else {
        console.log('Starting new Claude Code process');
        // Start new Claude Code process with MCP server
        const process = await tauriService.startClaudeProcess(worktree.path, worktree.id, userMessage.content, permissionMode);
        console.log('🚀 Started Claude process:', process);
        
        // Update chat with new process info
        onChatUpdated((prevChat) => ({
          ...prevChat,
          process: process
        }));
      }

    } catch (error) {
      console.error('Failed to send message:', error);
      userMessage.status = 'error';
      onChatUpdated((prevChat) => ({
        ...prevChat,
        messages: prevChat.messages.map(msg => 
          msg.id === userMessage.id ? userMessage : msg
        )
      }));
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

  const handleApprovalResponse = async (approvalId: string, response: ApprovalResponse) => {
    try {
      console.log('Responding to approval:', approvalId, response);
      await tauriService.respondToApproval(approvalId, response);
      
      // Remove the approval message from the chat and add a response message
      onChatUpdated((prevChat) => ({
        ...prevChat,
        messages: prevChat.messages.map(msg => {
          if (msg.approvalRequest?.approvalId === approvalId) {
            // Replace approval message with a response message
            return {
              ...msg,
              role: 'assistant' as const,
              content: response.behavior === 'allow' 
                ? `✅ Approved: ${msg.approvalRequest.toolName.replace(/_/g, ' ')}`
                : `❌ Denied: ${msg.approvalRequest.toolName.replace(/_/g, ' ')}`,
              approvalRequest: undefined,
            };
          }
          return msg;
        })
      }));
      
      setPendingApprovals(prev => prev.filter(([id]) => id !== approvalId));
    } catch (error) {
      console.error('Failed to respond to approval:', error);
      
      // Show error in chat
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        worktree_id: worktree.id,
        role: 'assistant',
        content: `Failed to respond to approval: ${error}`,
        timestamp: new Date().toISOString(),
        status: 'error',
      };
      
      onChatUpdated((prevChat) => ({
        ...prevChat,
        messages: [...prevChat.messages, errorMessage],
      }));
    }
  };


  const copyChatHistory = async () => {
    const chatHistory = `Chat Session - Worktree: ${worktree.name}
Path: ${worktree.path}
Session Time: ${new Date().toLocaleString()}

${chat.messages.map(msg => `[${formatTime(msg.timestamp)}] ${msg.role}: ${msg.content}`).join('\n\n')}`;

    try {
      await navigator.clipboard.writeText(chatHistory);
    } catch (err) {
      console.error('Failed to copy chat history:', err);
    }
  };

  const getMcpStatusIcon = () => {
    if (!mcpServerId) {
      return <AlertCircle className="w-4 h-4 text-yellow-400" />;
    }
    if (!mcpServerStatus) {
      return <Loader className="w-4 h-4 text-yellow-400 animate-spin" />;
    }
    return <CheckCircle className="w-4 h-4 text-green-400" />;
  };

  const getMcpStatusText = () => {
    if (!mcpServerId) {
      return 'MCP Server Starting...';
    }
    if (!mcpServerStatus) {
      return 'MCP Server Connecting...';
    }
    return 'MCP Server Ready';
  };

  return (
    <div className="flex-1 flex flex-col bg-claude-dark-900 min-h-0">
      {/* Chat Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-claude-dark-800 border-b border-claude-dark-700">
        <div className="flex items-center space-x-4">
          <div>
            <h2 className="text-lg font-semibold text-white">{worktree.name}</h2>
            <p className="text-xs text-claude-dark-400 font-mono">{worktree.path}</p>
          </div>
          <div className="flex items-center space-x-3">
            {/* MCP Server Status */}
            <div className={`flex items-center space-x-2 text-xs px-3 py-1 rounded-full ${
              mcpServerId && mcpServerStatus ? 'bg-green-900/20 text-green-400 border border-green-800' :
              'bg-yellow-900/20 text-yellow-400 border border-yellow-800'
            }`}>
              {getMcpStatusIcon()}
              <span>{getMcpStatusText()}</span>
            </div>
            
            {/* Claude Process Status */}
            {chat.process && (
              <div className={`flex items-center space-x-2 text-xs px-3 py-1 rounded-full ${
                chat.process.status === 'running' ? 'bg-green-900/20 text-green-400 border border-green-800' :
                chat.process.status === 'completed' ? 'bg-blue-900/20 text-blue-400 border border-blue-800' :
                'bg-claude-dark-700 text-claude-dark-400 border border-claude-dark-600'
              }`}>
                {chat.process.status === 'running' && (
                  <>
                    <Loader className="w-3 h-3 animate-spin" />
                    <span>Working</span>
                  </>
                )}
                {chat.process.status === 'completed' && (
                  <>
                    <CheckCircle className="w-3 h-3" />
                    <span>Completed</span>
                  </>
                )}
                {chat.process.status === 'idle' && <span>Idle</span>}
              </div>
            )}
            
          </div>
        </div>
        
        <div className="flex items-center space-x-2">
          <button 
            className="text-sm px-3 py-1.5 bg-claude-dark-700 hover:bg-claude-dark-600 text-claude-dark-300 rounded transition-colors"
            onClick={copyChatHistory}
            title="Copy chat history"
          >
            Copy Chat
          </button>
        </div>
      </div>

      {/* Chat Messages Area */}
      <div 
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0"
      >
        {chat.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-claude-dark-400">
            <div className="text-center">
              <div className="text-lg mb-2">No messages yet</div>
              <div className="text-sm">Start a conversation with Claude about this worktree</div>
            </div>
          </div>
        ) : (
          chat.messages.map((message) => {
            // Handle approval messages specially
            if (message.role === 'approval' && message.approvalRequest) {
              return (
                <div key={message.id} className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg px-4 py-3 bg-orange-900/20 border border-orange-800">
                    <div className="flex items-start space-x-3">
                      <AlertCircle className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <div className="text-orange-400 font-medium mb-2">Permission Request</div>
                        <div className="text-claude-dark-100 mb-3">
                          Claude wants to <span className="font-semibold">{message.approvalRequest.toolName.replace(/_/g, ' ')}</span>
                        </div>
                        <div className="bg-claude-dark-800 rounded p-3 mb-3">
                          <pre className="text-xs text-claude-dark-300 whitespace-pre-wrap break-all">
                            {JSON.stringify(message.approvalRequest.input, null, 2)}
                          </pre>
                        </div>
                        <div className="flex space-x-2">
                          <button
                            onClick={() => handleApprovalResponse(message.approvalRequest!.approvalId, {
                              behavior: 'allow',
                            })}
                            className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded transition-colors flex items-center space-x-2"
                          >
                            <CheckCircle className="w-4 h-4" />
                            <span>Approve</span>
                          </button>
                          <button
                            onClick={() => handleApprovalResponse(message.approvalRequest!.approvalId, {
                              behavior: 'deny',
                              message: 'User denied permission for this operation',
                            })}
                            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors flex items-center space-x-2"
                          >
                            <XCircle className="w-4 h-4" />
                            <span>Deny</span>
                          </button>
                        </div>
                        <div className="text-xs text-claude-dark-400 mt-2">
                          {formatTime(message.timestamp)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            
            // Regular message rendering
            return (
              <div
                key={message.id}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-claude-dark-700 text-claude-dark-100 border border-claude-dark-600'
                  }`}
                >
                  <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  <div className={`text-xs mt-2 ${
                    message.role === 'user' ? 'text-blue-200' : 'text-claude-dark-400'
                  }`}>
                    {formatTime(message.timestamp)}
                    {message.status === 'sending' && (
                      <Loader className="inline w-3 h-3 ml-2 animate-spin" />
                    )}
                    {message.status === 'error' && (
                      <XCircle className="inline w-3 h-3 ml-2 text-red-400" />
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        
        {isProcessing && chat.process && chat.process.status === 'running' && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-3 bg-claude-dark-700 text-claude-dark-100 border border-claude-dark-600">
              <div className="flex items-center space-x-2">
                <Loader className="w-4 h-4 animate-spin" />
                <span>Claude is thinking...</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Message Input */}
      <div className="p-4 bg-claude-dark-800 border-t border-claude-dark-700">
        <form onSubmit={sendMessage} className="flex space-x-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message to Claude..."
            className="flex-1 px-4 py-2 bg-claude-dark-700 border border-claude-dark-600 rounded-lg text-white placeholder-claude-dark-400 focus:outline-none focus:border-blue-500"
            disabled={sending || !mcpServerId || !mcpServerStatus}
          />
          <button
            type="submit"
            disabled={sending || !message.trim() || !mcpServerId || !mcpServerStatus}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-claude-dark-600 disabled:text-claude-dark-400 text-white rounded-lg transition-colors"
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>

    </div>
  );
}