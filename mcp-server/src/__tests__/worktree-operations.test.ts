import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorktreeOperations } from '../worktree-operations';

describe('WorktreeOperations', () => {
  let tempDir: string;
  let worktreeOps: WorktreeOperations;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(join(tmpdir(), 'worktree-test-'));
    worktreeOps = new WorktreeOperations(tempDir, 'test-worktree-1');
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true });
  });

  describe('executeCommand', () => {
    it('should execute simple commands successfully', async () => {
      const result = await worktreeOps.executeCommand('echo', ['hello world']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('hello world');
      expect(result.stderr).toBe('');
    });

    it('should handle command errors', async () => {
      await expect(worktreeOps.executeCommand('nonexistent-command'))
        .rejects.toThrow('Failed to execute command');
    });

    it('should execute commands in the worktree directory', async () => {
      const result = await worktreeOps.executeCommand('pwd');
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(tempDir);
    });
  });

  describe('readFile', () => {
    it('should read existing files', async () => {
      const testContent = 'Hello, World!';
      const testFile = 'test.txt';
      
      await fs.writeFile(join(tempDir, testFile), testContent);
      
      const content = await worktreeOps.readFile(testFile);
      expect(content).toBe(testContent);
    });

    it('should throw error for non-existent files', async () => {
      await expect(worktreeOps.readFile('nonexistent.txt'))
        .rejects.toThrow('File not found');
    });

    it('should prevent path traversal attacks', async () => {
      await expect(worktreeOps.readFile('../../../etc/passwd'))
        .rejects.toThrow('Path traversal attempt detected');
    });
  });

  describe('writeFile', () => {
    it('should write files successfully', async () => {
      const testContent = 'Test content';
      const testFile = 'output.txt';
      
      await worktreeOps.writeFile(testFile, testContent);
      
      const writtenContent = await fs.readFile(join(tempDir, testFile), 'utf-8');
      expect(writtenContent).toBe(testContent);
    });

    it('should create directories if they don\'t exist', async () => {
      const testContent = 'Nested content';
      const testFile = 'nested/dir/file.txt';
      
      await worktreeOps.writeFile(testFile, testContent);
      
      const writtenContent = await fs.readFile(join(tempDir, testFile), 'utf-8');
      expect(writtenContent).toBe(testContent);
    });

    it('should prevent path traversal in write operations', async () => {
      await expect(worktreeOps.writeFile('../../../tmp/malicious.txt', 'content'))
        .rejects.toThrow('Path traversal attempt detected');
    });
  });

  describe('listDirectory', () => {
    it('should list directory contents', async () => {
      // Create test files and directories
      await fs.writeFile(join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(join(tempDir, 'file2.txt'), 'content2');
      await fs.mkdir(join(tempDir, 'subdir'));
      
      const entries = await worktreeOps.listDirectory('.');
      
      expect(entries).toContain('[FILE] file1.txt');
      expect(entries).toContain('[FILE] file2.txt');
      expect(entries).toContain('[DIR] subdir');
    });

    it('should handle empty directories', async () => {
      const entries = await worktreeOps.listDirectory('.');
      
      expect(entries).toEqual([]);
    });

    it('should throw error for non-existent directories', async () => {
      await expect(worktreeOps.listDirectory('nonexistent'))
        .rejects.toThrow('Directory not found');
    });
  });

  describe('getFileStats', () => {
    it('should return file statistics', async () => {
      const testContent = 'Test file content';
      const testFile = 'stats-test.txt';
      
      await fs.writeFile(join(tempDir, testFile), testContent);
      
      const stats = await worktreeOps.getFileStats(testFile);
      
      expect(stats.size).toBe(testContent.length);
      expect(stats.isFile).toBe(true);
      expect(stats.isDirectory).toBe(false);
      expect(stats.mtime).toBeInstanceOf(Date);
    });

    it('should identify directories correctly', async () => {
      const testDir = 'test-directory';
      
      await fs.mkdir(join(tempDir, testDir));
      
      const stats = await worktreeOps.getFileStats(testDir);
      
      expect(stats.isDirectory).toBe(true);
      expect(stats.isFile).toBe(false);
    });
  });

  describe('getWorktreeInfo', () => {
    it('should return worktree information', () => {
      const info = worktreeOps.getWorktreeInfo();
      
      expect(info.path).toBe(tempDir);
      expect(info.id).toBe('test-worktree-1');
    });
  });
});