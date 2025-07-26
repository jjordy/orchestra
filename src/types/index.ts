export interface WorktreeConfig {
  id: string;
  name: string;
  path: string;
  branch: string;
  base_repo: string;
  is_active: boolean;
  created_at: string;
  is_main?: boolean;
  is_bare?: boolean;
  is_detached?: boolean;
}

export interface ClaudeProcess {
  id: string;
  worktree_id: string;
  pid?: number;
  status: 'idle' | 'running' | 'stopped' | 'error' | 'starting' | 'completed';
  task?: string;
  started_at?: string;
  last_activity?: string;
}

export interface ChatMessage {
  id: string;
  worktree_id: string;
  role: 'user' | 'assistant' | 'approval' | 'system';
  content: string;
  timestamp: string;
  status?: 'sending' | 'sent' | 'error';
  approvalRequest?: {
    approvalId: string;
    toolName: string;
    input: any;
  };
}

export interface WorktreeChat {
  worktree_id: string;
  messages: ChatMessage[];
  process?: ClaudeProcess;
}

export interface GitWorktreeInfo {
  path: string;
  branch: string;
  is_main: boolean;
  is_bare: boolean;
  is_detached: boolean;
}

export interface Repository {
  id: string;
  name: string;
  path: string;
  isExpanded: boolean;
  worktrees: WorktreeConfig[];
  mainBranch: string;
  loadedAt: string;
}

// MCP Server Types
export interface McpServerConfig {
  serverId: string;
  worktreeId: string;
  worktreePath: string;
  serverPath: string;
  port?: number;
}

export interface ApprovalRequest {
  toolName: string;
  input: any;
  worktreeId: string;
  timestamp: number;
}

export interface ApprovalResponse {
  behavior: 'allow' | 'deny';
  message?: string;
  updatedInput?: any;
}

export interface AppState {
  repositories: Repository[];
  chats: Record<string, WorktreeChat>;
  selectedWorktree?: string;
  // Keep for backwards compatibility during transition
  selectedRepo?: string;
  worktrees: WorktreeConfig[];
  // MCP server management
  mcpServers: Record<string, McpServerConfig>;
  pendingApprovals: Record<string, ApprovalRequest>;
}