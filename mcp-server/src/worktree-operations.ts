import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join, resolve } from 'path';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class WorktreeOperations {
  constructor(
    private readonly worktreePath: string,
    private readonly worktreeId: string
  ) {}

  /**
   * Execute a command in the worktree directory
   */
  async executeCommand(command: string, args: string[] = []): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: this.worktreePath,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 0,
        });
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to execute command: ${error.message}`));
      });

      // Set a timeout to prevent hanging processes
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGTERM');
          reject(new Error('Command execution timed out'));
        }
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Read a file from the worktree
   */
  async readFile(relativePath: string): Promise<string> {
    const fullPath = this.getSecurePath(relativePath);
    
    try {
      const content = await fs.readFile(fullPath, 'utf-8');
      return content;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`File not found: ${relativePath}`);
      }
      throw new Error(`Failed to read file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Write content to a file in the worktree
   */
  async writeFile(relativePath: string, content: string): Promise<void> {
    const fullPath = this.getSecurePath(relativePath);
    
    try {
      // Ensure directory exists
      const dir = join(fullPath, '..');
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(fullPath, content, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * List directory contents
   */
  async listDirectory(relativePath: string = '.'): Promise<string[]> {
    const fullPath = this.getSecurePath(relativePath);
    
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries.map(entry => {
        const prefix = entry.isDirectory() ? '[DIR] ' : '[FILE] ';
        return `${prefix}${entry.name}`;
      });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        throw new Error(`Directory not found: ${relativePath}`);
      }
      throw new Error(`Failed to list directory: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get file stats (size, modified time, etc.)
   */
  async getFileStats(relativePath: string): Promise<{
    size: number;
    isDirectory: boolean;
    isFile: boolean;
    mtime: Date;
  }> {
    const fullPath = this.getSecurePath(relativePath);
    
    try {
      const stats = await fs.stat(fullPath);
      return {
        size: stats.size,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
        mtime: stats.mtime,
      };
    } catch (error) {
      throw new Error(`Failed to get file stats: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Ensure path is within worktree directory (security measure)
   */
  private getSecurePath(relativePath: string): string {
    const fullPath = resolve(this.worktreePath, relativePath);
    const normalizedWorktreePath = resolve(this.worktreePath);
    
    if (!fullPath.startsWith(normalizedWorktreePath)) {
      throw new Error(`Path traversal attempt detected: ${relativePath}`);
    }
    
    return fullPath;
  }

  /**
   * Get worktree information
   */
  getWorktreeInfo(): { path: string; id: string } {
    return {
      path: this.worktreePath,
      id: this.worktreeId,
    };
  }
}