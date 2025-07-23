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
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  status?: 'sending' | 'sent' | 'error';
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

export interface AppState {
  selectedRepo?: string;
  worktrees: WorktreeConfig[];
  chats: Record<string, WorktreeChat>;
  selectedWorktree?: string;
}