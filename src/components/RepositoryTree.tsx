import { useState } from 'react';
import { ChevronDown, ChevronRight, GitBranch, Folder, X, Trash2 } from 'lucide-react';
import { Repository, WorktreeConfig, WorktreeChat } from '../types';
import { tauriService } from '../services/tauri';

interface RepositoryTreeProps {
  repositories: Repository[];
  selectedWorktree?: string;
  onWorktreeSelected: (worktreeId: string) => void;
  onRepositoryToggle: (repositoryId: string) => void;
  onRepositoryRemove?: (repositoryId: string) => void;
  onRepositoryRefresh?: (repoPath: string) => Promise<void>;
  chats: Record<string, WorktreeChat>;
  onCreateWorktree?: (repoPath: string, branchName: string, worktreeName: string) => Promise<void>;
}

export default function RepositoryTree({
  repositories,
  selectedWorktree,
  onWorktreeSelected,
  onRepositoryToggle,
  onRepositoryRemove,
  onRepositoryRefresh,
  chats,
  onCreateWorktree
}: RepositoryTreeProps) {
  const [showCreateForm, setShowCreateForm] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [removingWorktree, setRemovingWorktree] = useState<string | null>(null);

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

  const handleCreateWorktree = async (e: React.FormEvent, repoPath: string) => {
    e.preventDefault();
    console.log('handleCreateWorktree called with:', { name, repoPath, onCreateWorktree: !!onCreateWorktree });
    if (!name.trim() || !onCreateWorktree) {
      console.log('Validation failed:', { nameEmpty: !name.trim(), noCallback: !onCreateWorktree });
      return;
    }

    setCreating(true);
    try {
      await onCreateWorktree(repoPath, name.trim(), name.trim());
      setName('');
      setShowCreateForm(null);
    } catch (error) {
      console.error('Failed to create worktree:', error);
      alert(`Failed to create worktree: ${error}`);
    } finally {
      setCreating(false);
    }
  };

  const handleRemoveWorktree = async (e: React.MouseEvent, worktree: WorktreeConfig, repository: Repository) => {
    e.stopPropagation();
    
    console.log('RepositoryTree: Attempting to remove worktree:', worktree);
    console.log('Repository:', repository);
    
    try {
      // First check the worktree status
      const [hasChanges, hasUnpushed] = await tauriService.checkWorktreeStatus(worktree.path);
      console.log('Worktree status:', { hasChanges, hasUnpushed });
      
      let confirmMessage = `Are you sure you want to remove the worktree "${worktree.name}"?`;
      let requiresForce = false;
      
      if (hasChanges || hasUnpushed) {
        const issues = [];
        if (hasChanges) issues.push('uncommitted changes');
        if (hasUnpushed) issues.push('unpushed commits');
        
        confirmMessage = `The worktree "${worktree.name}" has ${issues.join(' and ')}.\n\nRemoving it will discard these changes permanently. Are you sure you want to continue?`;
        requiresForce = true;
      }
      
      if (!confirm(confirmMessage)) {
        console.log('User cancelled worktree removal');
        return;
      }
      
      // Only set removing state after confirmation
      setRemovingWorktree(worktree.id);
      
      console.log('User confirmed removal, calling backend with:', {
        worktreePath: worktree.path,
        repoPath: repository.path,
        force: requiresForce
      });
      
      // Remove the worktree with force if needed
      await tauriService.removeWorktree(worktree.path, repository.path, requiresForce);
      
      console.log('Worktree removed successfully, refreshing repository...');
      
      // Refresh the repository to update the worktree list
      if (onRepositoryRefresh) {
        await onRepositoryRefresh(repository.path);
      }
    } catch (error: any) {
      console.error('Failed to remove worktree:', error);
      alert(`Failed to remove worktree: ${error}`);
    } finally {
      setRemovingWorktree(null);
    }
  };

  return (
    <div className="h-full flex flex-col bg-claude-dark-800">
      <div className="flex-1 overflow-y-auto">
        {repositories.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-claude-dark-400 mb-2">No repositories loaded</p>
            <p className="text-xs text-claude-dark-500">Use "Add Repository" to get started</p>
          </div>
        ) : (
          <div className="p-2">
            {repositories.map((repository) => (
              <div key={repository.id} className={`mb-2 ${repository.worktrees.filter(wt => !wt.is_main).length === 0 ? 'border border-dashed border-claude-dark-600 rounded-lg p-1' : ''}`}>
                {/* Repository Header */}
                <div className="flex items-center justify-between group">
                  <div
                    className="flex items-center space-x-2 flex-1 p-2 rounded cursor-pointer hover:bg-claude-dark-700/50"
                    onClick={() => onRepositoryToggle(repository.id)}
                  >
                    {repository.isExpanded ? (
                      <ChevronDown size={16} className="text-claude-dark-400" />
                    ) : (
                      <ChevronRight size={16} className="text-claude-dark-400" />
                    )}
                    <Folder size={16} className="text-blue-400" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-white">
                        {repository.name}
                      </div>
                      <div className="text-xs text-claude-dark-400">
                        {repository.mainBranch} • {repository.worktrees.filter(wt => !wt.is_main).length} worktree{repository.worktrees.filter(wt => !wt.is_main).length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  {onRepositoryRemove && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRepositoryRemove(repository.id);
                      }}
                      className={`p-1 text-claude-dark-400 hover:text-red-400 transition-all ${
                        repository.worktrees.filter(wt => !wt.is_main).length === 0 
                          ? 'opacity-60 hover:opacity-100' 
                          : 'opacity-0 group-hover:opacity-100 focus:opacity-100'
                      }`}
                      title="Remove repository"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                {/* Worktrees (when expanded or no worktrees exist) */}
                {(repository.isExpanded || repository.worktrees.filter(worktree => !worktree.is_main).length === 0) && (
                  <div className="ml-6 mt-1">
                    {repository.worktrees.filter(worktree => !worktree.is_main).length === 0 ? (
                      <div className="p-3 text-center text-claude-dark-400 text-sm">
                        No working branches found
                        <br />
                        <span className="text-xs text-claude-dark-500">Create a worktree to get started</span>
                      </div>
                    ) : (
                      repository.worktrees.filter(worktree => !worktree.is_main).map((worktree) => {
                      const messageCount = getMessageCount(worktree.id);
                      const lastMessage = getLastMessage(worktree.id);
                      const isActive = hasActiveProcess(worktree.id);
                      const isSelected = selectedWorktree === worktree.id;

                      return (
                        <div
                          key={worktree.id}
                          className={`group p-2 mb-1 rounded cursor-pointer transition-all duration-150 ${
                            isSelected 
                              ? 'bg-blue-600/20 border border-blue-500/30' 
                              : 'hover:bg-claude-dark-700/50'
                          }`}
                          onClick={() => onWorktreeSelected(worktree.id)}
                        >
                          <div className="flex items-center space-x-2">
                            <GitBranch size={14} className="text-green-400 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="text-sm text-white truncate">
                                  {worktree.name}
                                </span>
                                {worktree.is_main && (
                                  <span className="text-xs bg-blue-600/20 text-blue-300 px-1.5 py-0.5 rounded">
                                    main
                                  </span>
                                )}
                                {isActive && (
                                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                )}
                              </div>
                              <div className="text-xs text-claude-dark-400 truncate">
                                {worktree.branch}
                              </div>
                              {lastMessage && (
                                <div className="text-xs text-claude-dark-500 truncate mt-1">
                                  {lastMessage.role === 'user' ? '→' : '←'} {lastMessage.content.slice(0, 50)}...
                                </div>
                              )}
                            </div>
                            {messageCount > 0 && (
                              <div className="bg-claude-dark-600 text-claude-dark-300 text-xs px-2 py-1 rounded-full flex-shrink-0">
                                {messageCount}
                              </div>
                            )}
                            <button
                              onClick={(e) => handleRemoveWorktree(e, worktree, repository)}
                              disabled={removingWorktree === worktree.id}
                              className="opacity-0 group-hover:opacity-100 p-1 text-claude-dark-400 hover:text-red-400 transition-all disabled:opacity-50"
                              title="Remove worktree"
                            >
                              {removingWorktree === worktree.id ? (
                                <div className="w-4 h-4 border-2 border-claude-dark-400 border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    }))}

                    {/* Add Worktree Button */}
                    {onCreateWorktree && (
                      <div className="mt-2">
                        {showCreateForm === repository.id ? (
                          <form
                            onSubmit={(e) => handleCreateWorktree(e, repository.path)}
                            className="p-3 bg-claude-dark-700 rounded space-y-3"
                          >
                            <input
                              type="text"
                              placeholder="Branch/Worktree name"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              disabled={creating}
                              required
                              className="w-full text-sm bg-claude-dark-800 border border-claude-dark-600 rounded px-3 py-2 placeholder-claude-dark-500 text-white focus:outline-none focus:border-claude-dark-400"
                            />
                            <div className="flex space-x-2">
                              <button 
                                type="submit" 
                                disabled={creating || !name.trim()}
                                className="flex-1 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-claude-dark-700 disabled:text-claude-dark-500 text-white rounded px-3 py-2 transition-colors"
                              >
                                {creating ? 'Creating...' : 'Create'}
                              </button>
                              <button 
                                type="button" 
                                onClick={() => setShowCreateForm(null)} 
                                disabled={creating}
                                className="flex-1 text-sm bg-claude-dark-700 hover:bg-claude-dark-600 text-claude-dark-300 rounded px-3 py-2 transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        ) : (
                          <button
                            onClick={() => setShowCreateForm(repository.id)}
                            className="w-full text-sm text-claude-dark-400 hover:text-white p-2 border border-claude-dark-600 hover:border-claude-dark-500 rounded transition-colors"
                          >
                            + New Worktree
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}