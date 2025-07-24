import { useState } from 'react';
import { WorktreeConfig } from '../types';
import { tauriService } from '../services/tauri';

interface WorktreeManagerProps {
  worktrees: WorktreeConfig[];
  onRefresh: () => void;
}

export default function WorktreeManager({ worktrees, onRefresh }: WorktreeManagerProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [existingWorktrees, setExistingWorktrees] = useState<string[]>([]);

  const checkExistingWorktrees = async (path: string) => {
    if (!path) {
      setExistingWorktrees([]);
      return;
    }
    
    try {
      const existing = await tauriService.listGitWorktrees(path);
      setExistingWorktrees(existing);
    } catch (error) {
      console.error('Failed to list existing worktrees:', error);
      setExistingWorktrees([]);
    }
  };

  const handleRepoPathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const path = e.target.value;
    setRepoPath(path);
    checkExistingWorktrees(path);
  };

  const handleCreateWorktree = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath || !name) return;

    // Check if a worktree with similar name already exists
    const proposedPath = `worktree-${name}`;
    const conflict = existingWorktrees.find(existing => 
      existing.includes(proposedPath) || existing.includes(name)
    );
    
    if (conflict) {
      alert(`A worktree with a similar name already exists at: ${conflict}\nPlease choose a different name.`);
      return;
    }

    setLoading(true);
    try {
      await tauriService.createWorktree(repoPath, name, name);
      setRepoPath('');
      setName('');
      setExistingWorktrees([]);
      setShowCreateForm(false);
      onRefresh();
    } catch (error) {
      console.error('Failed to create worktree:', error);
      alert('Failed to create worktree: ' + error);
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveWorktree = async (worktree: WorktreeConfig) => {
    console.log('Attempting to remove worktree:', worktree);
    
    if (!confirm('Are you sure you want to remove this worktree?')) {
      console.log('User cancelled worktree removal');
      return;
    }

    console.log('User confirmed removal, calling backend with:', {
      path: worktree.path,
      base_repo: worktree.base_repo
    });

    try {
      await tauriService.removeWorktree(worktree.path, worktree.base_repo);
      console.log('Worktree removed successfully, refreshing...');
      onRefresh();
    } catch (error) {
      console.error('Failed to remove worktree:', error);
      alert('Failed to remove worktree: ' + error);
    }
  };

  return (
    <div className="worktree-manager">
      <div className="section-header">
        <h2>Git Worktrees</h2>
        <button onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? 'Cancel' : 'Create New Worktree'}
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateWorktree} className="create-form">
          <div className="form-group">
            <label>Repository Path:</label>
            <input
              type="text"
              value={repoPath}
              onChange={handleRepoPathChange}
              placeholder="/path/to/your/git/repo"
              required
            />
            {existingWorktrees.length > 0 && (
              <div className="existing-worktrees">
                <small><strong>Existing worktrees:</strong></small>
                <ul>
                  {existingWorktrees.map((path, index) => (
                    <li key={index}><small>{path}</small></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="form-group">
            <label>Branch/Worktree Name:</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feature/new-branch"
              required
            />
            <small>This name will be used for both the branch and worktree</small>
          </div>
          <button type="submit" disabled={loading}>
            {loading ? 'Creating...' : 'Create Worktree'}
          </button>
        </form>
      )}

      <div className="worktree-list">
        {worktrees.length === 0 ? (
          <p>No worktrees created yet.</p>
        ) : (
          worktrees.map((worktree) => (
            <div key={worktree.id} className="worktree-card">
              <div className="worktree-info">
                <h3>{worktree.name}</h3>
                <p><strong>Branch:</strong> {worktree.branch}</p>
                <p><strong>Path:</strong> {worktree.path}</p>
                <p><strong>Created:</strong> {new Date(worktree.created_at).toLocaleString()}</p>
                <p><strong>Status:</strong> 
                  <span className={`status ${worktree.is_active ? 'active' : 'inactive'}`}>
                    {worktree.is_active ? 'Active' : 'Inactive'}
                  </span>
                </p>
              </div>
              <div className="worktree-actions">
                <button 
                  onClick={() => handleRemoveWorktree(worktree)}
                  className="remove-btn"
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}