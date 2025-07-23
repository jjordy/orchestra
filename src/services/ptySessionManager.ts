import { Terminal as XTerm } from '@xterm/xterm';
import { listen } from '@tauri-apps/api/event';
import { tauriService } from './tauri';

export interface PtySessionState {
  lastOutput: string;
  hasListener: boolean;
  activeTerminals: Map<string, XTerm>;
  terminalBuffer: string;
  isRestoring: boolean;
  globalUnlisten?: () => void;
}

class PtySessionManager {
  private sessionState = new Map<string, PtySessionState>();

  /**
   * Creates or retrieves an existing PTY session
   */
  async createSession(ptyId: string, workingDir: string): Promise<{ ptyId: string; isExisting: boolean }> {
    const response = await tauriService.createWorktreePty(ptyId, workingDir);
    const isExistingSession = response.startsWith('existing:');
    const actualPtyId = isExistingSession ? response.substring(9) : response;

    // Initialize session state if it doesn't exist
    if (!this.sessionState.has(actualPtyId)) {
      this.sessionState.set(actualPtyId, {
        lastOutput: '',
        hasListener: false,
        activeTerminals: new Map(),
        terminalBuffer: '',
        isRestoring: false
      });
    }

    return { ptyId: actualPtyId, isExisting: isExistingSession };
  }

  /**
   * Registers a terminal instance with a PTY session
   */
  registerTerminal(ptyId: string, terminalId: string, terminal: XTerm): void {
    const sessionState = this.sessionState.get(ptyId);
    if (sessionState) {
      sessionState.activeTerminals.set(terminalId, terminal);
      this.setupGlobalListener(ptyId);
    }
  }

  /**
   * Unregisters a terminal instance from a PTY session
   */
  unregisterTerminal(ptyId: string, terminalId: string): void {
    const sessionState = this.sessionState.get(ptyId);
    if (sessionState) {
      sessionState.activeTerminals.delete(terminalId);
      
      // Clean up global listener if no terminals remain
      if (sessionState.activeTerminals.size === 0) {
        this.cleanupGlobalListener(ptyId);
      }
    }
  }

  /**
   * Writes input to a PTY session
   */
  async writeInput(ptyId: string, data: string): Promise<void> {
    try {
      await tauriService.writeToPty(ptyId, data);
    } catch (error) {
      console.error('Failed to write to PTY:', error);
      throw error;
    }
  }

  /**
   * Restores terminal buffer for existing sessions
   */
  restoreBuffer(ptyId: string, terminal: XTerm): void {
    const sessionState = this.sessionState.get(ptyId);
    if (sessionState && sessionState.terminalBuffer) {
      sessionState.isRestoring = true;
      terminal.clear();
      terminal.write(sessionState.terminalBuffer);
      
      setTimeout(() => {
        sessionState.isRestoring = false;
      }, 500);
    }
  }

  /**
   * Auto-launches Claude for new sessions
   */
  async autoLaunchClaude(ptyId: string, terminal: XTerm): Promise<void> {
    terminal.write('\x1b[32mStarting Claude Code in worktree...\x1b[0m\r\n', () => {
      this.writeInput(ptyId, 'claude\r\n').catch(error => {
        console.error('Failed to auto-start Claude:', error);
        terminal.write('\x1b[31mFailed to start Claude. Type "claude" manually.\x1b[0m\r\n');
      });
    });
  }

  /**
   * Sets up global listener for PTY output (one per session)
   */
  private async setupGlobalListener(ptyId: string): Promise<void> {
    const sessionState = this.sessionState.get(ptyId);
    if (!sessionState || sessionState.hasListener) return;

    sessionState.hasListener = true;
    
    const globalUnlisten = await listen(`pty-output-${ptyId}`, (event: any) => {
      const output = event.payload;
      
      // Global deduplication
      if (output !== sessionState.lastOutput) {
        sessionState.lastOutput = output;
        
        // Accumulate output in buffer for restoration
        if (!sessionState.isRestoring) {
          sessionState.terminalBuffer += output;
          
          // Keep buffer size manageable (last 100KB)
          if (sessionState.terminalBuffer.length > 100000) {
            sessionState.terminalBuffer = sessionState.terminalBuffer.slice(-50000);
          }
        }
        
        // Write to all active terminals
        sessionState.activeTerminals.forEach((terminal) => {
          if (terminal && !sessionState.isRestoring) {
            terminal.write(output);
          }
        });
      }
    });
    
    sessionState.globalUnlisten = globalUnlisten;
  }

  /**
   * Cleans up global listener when no terminals remain
   */
  private cleanupGlobalListener(ptyId: string): void {
    const sessionState = this.sessionState.get(ptyId);
    if (sessionState) {
      sessionState.hasListener = false;
      if (sessionState.globalUnlisten) {
        sessionState.globalUnlisten();
        sessionState.globalUnlisten = undefined;
      }
    }
  }

  /**
   * Sets up PTY close listener
   */
  async setupCloseListener(ptyId: string, onClose: () => void): Promise<() => void> {
    return await listen(`pty-closed-${ptyId}`, onClose);
  }

  /**
   * Closes a PTY session and cleans up all associated state
   */
  async closeSession(ptyId: string): Promise<void> {
    await tauriService.closePty(ptyId);
    this.sessionState.delete(ptyId);
  }
}

export const ptySessionManager = new PtySessionManager();