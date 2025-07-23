import { useState, useEffect } from "react";
import { WorktreeConfig, WorktreeChat, AppState, GitWorktreeInfo } from "./types";
import { tauriService } from "./services/tauri";
import RepoSelector from "./components/RepoSelector";
import WorktreeSidebar from "./components/WorktreeSidebar";
import ChatWindow from "./components/ChatWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";

const LAST_REPO_KEY = 'orchestra-manager-last-repo';

function App() {
  const [appState, setAppState] = useState<AppState>({
    worktrees: [],
    chats: {},
    selectedWorktree: undefined,
    selectedRepo: undefined,
  });

  const [windowControls, setWindowControls] = useState({
    canMinimize: true,
    canMaximize: true,
    isMaximized: false
  });

  // Test window control capabilities on startup
  useEffect(() => {
    const testWindowControls = async () => {
      try {
        const window = getCurrentWindow();
        const isMaximized = await window.isMaximized();
        setWindowControls(prev => ({ ...prev, isMaximized }));
      } catch (error) {
        console.log('Window control detection:', error);
        // Controls might not work in tiling WM, but that's OK
      }
    };
    testWindowControls();
  }, []);

  // Load last used repository on startup
  useEffect(() => {
    const lastRepo = localStorage.getItem(LAST_REPO_KEY);
    if (lastRepo) {
      loadWorktrees(lastRepo);
    }
  }, []);

  const loadWorktrees = async (repoPath: string) => {
    try {
      const gitWorktrees = await tauriService.listGitWorktrees(repoPath);
      
      // Sort to put main repo first
      const sortedWorktrees = gitWorktrees.sort((a, b) => {
        if (a.is_main && !b.is_main) return -1;
        if (!a.is_main && b.is_main) return 1;
        return 0;
      });

      const worktrees: WorktreeConfig[] = sortedWorktrees.map((gitWt, index) => {
        const displayName = gitWt.is_main 
          ? `${repoPath.split('/').pop()} (main)` 
          : gitWt.path.split('/').pop() || `Worktree ${index}`;
        
        return {
          id: `worktree-${index}`,
          name: displayName,
          path: gitWt.path,
          branch: gitWt.branch,
          base_repo: repoPath,
          is_active: true,
          created_at: new Date().toISOString(),
          is_main: gitWt.is_main,
          is_bare: gitWt.is_bare,
          is_detached: gitWt.is_detached,
        };
      });

      // Save to localStorage on successful load
      localStorage.setItem(LAST_REPO_KEY, repoPath);

      setAppState(prev => ({
        ...prev,
        selectedRepo: repoPath,
        worktrees,
        selectedWorktree: worktrees[0]?.id,
      }));
    } catch (error) {
      console.error('Failed to load worktrees:', error);
      // Don't save invalid repo paths
    }
  };

  const selectWorktree = (worktreeId: string) => {
    setAppState(prev => {
      const newState = {
        ...prev,
        selectedWorktree: worktreeId,
      };

      // Initialize chat for this worktree if it doesn't exist
      if (!prev.chats[worktreeId]) {
        newState.chats = {
          ...prev.chats,
          [worktreeId]: {
            worktree_id: worktreeId,
            messages: [],
          }
        };
      }

      return newState;
    });
  };

  const updateChat = (worktreeId: string, chat: WorktreeChat) => {
    console.log('APP: updateChat called for worktree:', worktreeId);
    console.log('APP: New chat object:', chat);
    console.log('APP: New messages count:', chat.messages.length);
    
    setAppState(prev => {
      const currentChat = prev.chats[worktreeId];
      console.log('APP: Current chat:', currentChat);
      console.log('APP: Current messages count:', currentChat?.messages.length || 0);
      
      // Only update if the chat has actually changed to prevent unnecessary re-renders
      if (currentChat && 
          currentChat.messages.length === chat.messages.length &&
          currentChat.process?.status === chat.process?.status) {
        console.log('APP: No change detected, keeping previous state');
        return prev; // No change needed
      }
      
      console.log('APP: Updating chat state');
      const newState = {
        ...prev,
        chats: {
          ...prev.chats,
          [worktreeId]: chat,
        }
      };
      console.log('APP: New state chats:', newState.chats[worktreeId]);
      return newState;
    });
  };

  const createWorktree = async (branchName: string, worktreeName: string) => {
    if (!appState.selectedRepo) {
      throw new Error('No repository selected');
    }

    try {
      await tauriService.createWorktree(appState.selectedRepo, branchName, worktreeName);
      // Reload worktrees to include the new one
      await loadWorktrees(appState.selectedRepo);
    } catch (error) {
      console.error('Failed to create worktree:', error);
      throw error;
    }
  };

  const selectedWorktree = appState.worktrees.find(w => w.id === appState.selectedWorktree);
  const selectedChat = appState.selectedWorktree ? appState.chats[appState.selectedWorktree] : undefined;

  return (
    <div className="h-screen flex flex-col bg-claude-dark-900 text-white">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-claude-dark-800 border-b border-claude-dark-700" data-tauri-drag-region>
        <div className="flex items-center space-x-3">
          <div className="flex space-x-2">
            <button 
              className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-600 transition-colors"
              onClick={async () => {
                try {
                  await getCurrentWindow().close();
                } catch (error) {
                  console.error('Failed to close window:', error);
                }
              }}
              title="Close"
            />
            <button 
              className="w-3 h-3 rounded-full bg-yellow-500 hover:bg-yellow-600 transition-colors"
              onClick={async () => {
                try {
                  await getCurrentWindow().minimize();
                  console.log('Window minimized successfully');
                } catch (error) {
                  console.warn('Minimize may not work in tiling window managers:', error);
                }
              }}
              title="Minimize (limited support in tiling WMs)"
            />
            <button 
              className={`w-3 h-3 rounded-full transition-colors ${
                windowControls.isMaximized 
                  ? 'bg-green-400 hover:bg-green-500' 
                  : 'bg-green-500 hover:bg-green-600'
              }`}
              onClick={async () => {
                try {
                  const window = getCurrentWindow();
                  const isMaximized = await window.isMaximized();
                  if (isMaximized) {
                    await window.unmaximize();
                    setWindowControls(prev => ({ ...prev, isMaximized: false }));
                  } else {
                    await window.maximize();
                    setWindowControls(prev => ({ ...prev, isMaximized: true }));
                  }
                } catch (error) {
                  console.warn('Maximize/restore may not work in tiling window managers:', error);
                }
              }}
              title={`${windowControls.isMaximized ? 'Restore' : 'Maximize'} (limited support in tiling WMs)`}
            />
          </div>
          <div className="text-sm text-claude-dark-400 font-mono">
            {appState.selectedRepo ? appState.selectedRepo.split('/').pop() : 'Orchestra Manager'}
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <RepoSelector 
            onRepoSelected={loadWorktrees}
            selectedRepo={appState.selectedRepo}
          />
          <div className="text-xs text-claude-dark-500">
            {appState.worktrees.length} workspace{appState.worktrees.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0">
        <WorktreeSidebar
          worktrees={appState.worktrees}
          selectedWorktree={appState.selectedWorktree}
          onWorktreeSelected={selectWorktree}
          chats={appState.chats}
          onCreateWorktree={createWorktree}
          selectedRepo={appState.selectedRepo}
        />
        
        <div className="flex-1 flex flex-col min-w-0">
          {selectedWorktree && selectedChat ? (
            <ChatWindow
              worktree={selectedWorktree}
              chat={selectedChat}
              onChatUpdated={(chat) => updateChat(selectedWorktree.id, chat)}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-claude-dark-900">
              <div className="text-center max-w-md">
                <h2 className="text-2xl font-semibold text-claude-dark-100 mb-4">
                  Select a Repository
                </h2>
                <p className="text-claude-dark-400 text-sm leading-relaxed">
                  Choose a git repository to see its worktrees and start chatting with Claude Code.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
