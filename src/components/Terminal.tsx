import { useEffect, useRef, useState } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import { ptySessionManager } from '../services/ptySessionManager';
import '@xterm/xterm/css/xterm.css';

interface TerminalProps {
  worktreeId: string;
  worktreePath: string;
  onClose?: () => void;
}

export default function Terminal({ worktreeId, worktreePath, onClose }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [ptyId, setPtyId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  
  const { terminal, isReady, write, onData, fit } = useTerminal(terminalRef);

  useEffect(() => {
    if (!terminal || !isReady) return;

    initializePty();
  }, [terminal, isReady]);

  // Trigger terminal fit on mount and when ready
  useEffect(() => {
    if (isReady) {
      // Small delay to ensure DOM is fully rendered
      setTimeout(() => {
        fit();
      }, 100);
    }
  }, [isReady, fit]);

  const initializePty = async () => {
    if (!terminal) return;

    try {
      // Use consistent PTY ID based only on worktree ID for session persistence
      const persistentPtyId = `worktree-${worktreeId}`;
      const { ptyId: actualPtyId, isExisting: isExistingSession } = await ptySessionManager.createSession(persistentPtyId, worktreePath);
      
      setPtyId(actualPtyId);
      setIsConnected(true);

      // Generate unique component ID and register terminal
      const componentId = `${worktreeId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      ptySessionManager.registerTerminal(actualPtyId, componentId, terminal);

      // Set up input handler
      onData(async (data: string) => {
        try {
          await ptySessionManager.writeInput(actualPtyId, data);
        } catch (error) {
          write('\r\n\x1b[31mError writing to terminal\x1b[0m\r\n');
        }
      });

      // Set up PTY close listener
      const unlistenClose = await ptySessionManager.setupCloseListener(actualPtyId, () => {
        setIsConnected(false);
        write('\r\n\x1b[31mTerminal session ended\x1b[0m\r\n');
      });

      // Auto-launch Claude for new sessions or restore buffer for existing ones
      if (!isExistingSession) {
        setTimeout(() => {
          ptySessionManager.autoLaunchClaude(actualPtyId, terminal);
        }, 1500);
      } else {
        setTimeout(() => {
          ptySessionManager.restoreBuffer(actualPtyId, terminal);
        }, 100);
      }

      return () => {
        ptySessionManager.unregisterTerminal(actualPtyId, componentId);
        unlistenClose();
      };
    } catch (error) {
      console.error('Failed to initialize PTY:', error);
      setIsConnected(false);
      write('\r\n\x1b[31mFailed to initialize terminal: ' + String(error) + '\x1b[0m\r\n');
      write('Check the console for more details\r\n');
    }
  };

  const startClaudeSession = async () => {
    if (ptyId && terminal) {
      try {
        await ptySessionManager.writeInput(ptyId, 'claude\r\n');
      } catch (error) {
        console.error('Failed to start Claude session:', error);
      }
    }
  };

  const closePtySession = async () => {
    if (ptyId) {
      try {
        await ptySessionManager.closeSession(ptyId);
        setPtyId(null);
        setIsConnected(false);
        if (onClose) {
          onClose();
        }
      } catch (error) {
        console.error('Failed to close PTY session:', error);
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-claude-dark-900 rounded-lg border border-claude-dark-700 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-claude-dark-800 border-b border-claude-dark-700">
        <div className="flex items-center space-x-3">
          <span className="text-sm font-medium text-white">Terminal - {worktreePath.split('/').pop()}</span>
          <span className={`flex items-center space-x-1 text-xs px-2 py-1 rounded-full ${
            isConnected 
              ? 'bg-green-900/20 text-green-400 border border-green-800' 
              : 'bg-red-900/20 text-red-400 border border-red-800'
          }`}>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button 
            className="text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-claude-dark-700 disabled:text-claude-dark-500 text-white rounded transition-colors"
            onClick={startClaudeSession}
            disabled={!isConnected}
            title="Restart Claude Code session"
          >
            Restart Claude
          </button>
          {onClose && (
            <button 
              className="text-sm px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              onClick={closePtySession} 
              title="Close terminal session"
            >
              Close
            </button>
          )}
        </div>
      </div>
      <div 
        ref={terminalRef} 
        className="terminal-content flex-1 h-full"
      />
    </div>
  );
}