import { useState } from 'react';

interface RepoSelectorProps {
  onRepoSelected: (repoPath: string) => void;
  selectedRepo?: string;
}

export default function RepoSelector({ onRepoSelected, selectedRepo }: RepoSelectorProps) {
  const [repoPath, setRepoPath] = useState(selectedRepo || '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoPath.trim()) return;

    setLoading(true);
    try {
      await onRepoSelected(repoPath.trim());
    } catch (error) {
      console.error('Failed to load repository:', error);
      alert('Failed to load repository. Please check the path and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center space-x-3 no-drag">
      <form onSubmit={handleSubmit} className="flex items-center space-x-2">
        <input
          type="text"
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          placeholder="Enter git repository path..."
          className="text-sm bg-claude-dark-700 border border-claude-dark-600 rounded px-3 py-1.5 placeholder-claude-dark-500 text-white focus:outline-none focus:border-claude-dark-400 min-w-0"
          style={{ width: '300px' }}
          disabled={loading}
        />
        <button 
          type="submit" 
          disabled={loading || !repoPath.trim()}
          className="text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-claude-dark-700 disabled:text-claude-dark-500 text-white rounded px-3 py-1.5 transition-colors whitespace-nowrap"
        >
          {loading ? 'Loading...' : 'Load'}
        </button>
      </form>
    </div>
  );
}