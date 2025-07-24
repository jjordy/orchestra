import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Plus } from 'lucide-react';
import { tauriService } from '../services/tauri';

interface RepoSelectorProps {
  onRepoSelected: (repoPath: string) => void;
}

export default function RepoSelector({ onRepoSelected }: RepoSelectorProps) {
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleAddRepository = async () => {
    setValidationError(null);
    setLoading(true);
    
    try {
      const selected = await open({
        directory: true,
        title: 'Select Git Repository Folder'
      });
      
      if (selected) {
        // First validate the repository
        await tauriService.validateGitRepo(selected);
        
        // If validation passes, load the repository
        await onRepoSelected(selected);
      }
    } catch (error) {
      console.error('Repository selection or validation failed:', error);
      const errorMessage = typeof error === 'string' ? error : 'Failed to add repository';
      setValidationError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col space-y-2 no-drag">
      <button
        onClick={handleAddRepository}
        disabled={loading}
        className="flex items-center space-x-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:bg-claude-dark-700 disabled:text-claude-dark-500 text-white rounded px-3 py-2 transition-colors"
      >
        {loading ? (
          <>Loading...</>
        ) : (
          <>
            <Plus size={16} />
            <FolderOpen size={16} />
            <span>Add Repository</span>
          </>
        )}
      </button>
      {validationError && (
        <div className="text-sm text-red-400 px-3">
          {validationError}
        </div>
      )}
    </div>
  );
}