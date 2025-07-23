import { useState } from 'react';
import { WorktreeConfig, WorktreeChat } from '../types';

interface WorktreeSidebarProps {
  worktrees: WorktreeConfig[];
  selectedWorktree?: string;
  onWorktreeSelected: (worktreeId: string) => void;
  chats: Record<string, WorktreeChat>;
  onCreateWorktree?: (branchName: string, worktreeName: string) => Promise<void>;
  selectedRepo?: string;
}

export default function WorktreeSidebar({ 
  worktrees, 
  selectedWorktree, 
  onWorktreeSelected, 
  chats,
  onCreateWorktree,
  selectedRepo 
}: WorktreeSidebarProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [worktreeName, setWorktreeName] = useState('');
  const [creating, setCreating] = useState(false);
  
  const getMessageCount = (worktreeId: string) => {
    return chats[worktreeId]?.messages?.length || 0;
  };

  const getLastMessage = (worktreeId: string) => {
    const chat = chats[worktreeId];
    if (!chat?.messages?.length) return null;
    return chat.messages[chat.messages.length - 1];
  };

  const hasActiveProcess = (worktreeId: string) => {
    const chat = chats[worktreeId];
    return chat?.process?.status === 'running';
  };

  const handleCreateWorktree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!branchName.trim() || !worktreeName.trim() || !onCreateWorktree || creating) return;
    
    setCreating(true);
    try {
      await onCreateWorktree(branchName.trim(), worktreeName.trim());
      setBranchName('');
      setWorktreeName('');
      setShowCreateForm(false);
    } catch (error) {
      console.error('Failed to create worktree:', error);
      alert('Failed to create worktree: ' + error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-80 bg-claude-dark-800 border-r border-claude-dark-700 flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-claude-dark-700">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-claude-dark-200 uppercase tracking-wide">
            Workspaces
          </h3>
          <span className="text-xs text-claude-dark-500 bg-claude-dark-700 px-2 py-1 rounded">
            {worktrees.length}
          </span>
        </div>
        {selectedRepo && onCreateWorktree && (
          <button 
            className="w-full text-sm text-claude-dark-400 hover:text-claude-dark-200 border border-claude-dark-600 hover:border-claude-dark-500 rounded px-3 py-2 transition-colors flex items-center justify-center"
            onClick={() => setShowCreateForm(!showCreateForm)}
          >
            <span className="mr-2">+</span>
            New workspace
          </button>
        )}
      </div>

      {/* Create Form */}
      {showCreateForm && selectedRepo && (
        <div className="p-4 bg-claude-dark-900 border-b border-claude-dark-700">
          <form onSubmit={handleCreateWorktree} className="space-y-3">
            <input
              type="text"
              placeholder="Branch name (e.g., feature/new-feature)"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              disabled={creating}
              required
              className="w-full text-sm bg-claude-dark-800 border border-claude-dark-600 rounded px-3 py-2 placeholder-claude-dark-500 text-white focus:outline-none focus:border-claude-dark-400"
            />
            <input
              type="text"
              placeholder="Workspace name (e.g., new-feature)"
              value={worktreeName}
              onChange={(e) => setWorktreeName(e.target.value)}
              disabled={creating}
              required
              className="w-full text-sm bg-claude-dark-800 border border-claude-dark-600 rounded px-3 py-2 placeholder-claude-dark-500 text-white focus:outline-none focus:border-claude-dark-400"
            />
            <div className="flex space-x-2">
              <button 
                type="submit" 
                disabled={creating || !branchName.trim() || !worktreeName.trim()}
                className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-claude-dark-700 disabled:text-claude-dark-500 text-white rounded px-3 py-2 transition-colors"
              >
                {creating ? 'Creating...' : 'Create'}
              </button>
              <button 
                type="button" 
                onClick={() => setShowCreateForm(false)} 
                disabled={creating}
                className="flex-1 text-sm bg-claude-dark-700 hover:bg-claude-dark-600 text-claude-dark-300 rounded px-3 py-2 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      
      {/* Workspace List */}
      <div className="flex-1 overflow-y-auto">
        {worktrees.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-claude-dark-400 mb-2">No workspaces found</p>
            <p className="text-xs text-claude-dark-500">Select a repository with existing worktrees</p>
          </div>
        ) : (
          <div className="p-2">
            {worktrees.map((worktree) => {
              const messageCount = getMessageCount(worktree.id);
              const lastMessage = getLastMessage(worktree.id);
              const isActive = hasActiveProcess(worktree.id);
              const isSelected = selectedWorktree === worktree.id;

              return (
                <div
                  key={worktree.id}
                  className={`p-3 mb-1 rounded cursor-pointer transition-all duration-150 ${
                    isSelected 
                      ? 'bg-blue-600/20 border border-blue-500/30' 
                      : 'hover:bg-claude-dark-700/50'
                  }`}
                  onClick={() => onWorktreeSelected(worktree.id)}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      {worktree.is_main && (
                        <span className="text-orange-400 text-xs flex-shrink-0">🏠</span>
                      )}
                      <span className="text-sm font-medium text-white truncate">
                        {worktree.is_main ? worktree.name.replace(' (main)', '') : worktree.name}
                      </span>
                      {isActive && (
                        <div className="w-2 h-2 bg-green-400 rounded-full flex-shrink-0 animate-pulse"></div>
                      )}
                    </div>
                    {messageCount > 0 && (
                      <span className="text-xs bg-claude-dark-600 text-claude-dark-300 px-2 py-0.5 rounded flex-shrink-0">
                        {messageCount}
                      </span>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <div className={`text-xs font-mono ${
                      worktree.is_main ? 'text-orange-400' : 'text-claude-dark-400'
                    }`}>
                      {worktree.branch}
                      {worktree.is_detached && (
                        <span className="text-red-400 ml-1">(detached)</span>
                      )}
                    </div>
                    {lastMessage && (
                      <div className="text-xs text-claude-dark-500 truncate">
                        {lastMessage.content.slice(0, 60)}
                        {lastMessage.content.length > 60 ? '...' : ''}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}