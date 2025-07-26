import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { WorktreeOperations } from '../worktree-operations';

describe('MCP Server - WorktreeOperations', () => {
  let tempDir: string;
  let worktreeOps: WorktreeOperations;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), 'mcp-test-'));
    worktreeOps = new WorktreeOperations(tempDir, 'test-worktree-1');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('File Operations', () => {
    it('should read existing files', async () => {
      const testFile = 'test-read.txt';
      const testContent = 'Hello, MCP Server!';
      
      // Create a test file
      await fs.writeFile(join(tempDir, testFile), testContent);
      
      const readContent = await worktreeOps.readFile(testFile);
      expect(readContent).toBe(testContent);
    });

    it('should write files successfully', async () => {
      const testFile = 'test-write.txt';
      const testContent = 'This is written by MCP server';
      
      await worktreeOps.writeFile(testFile, testContent);
      
      const writtenContent = await fs.readFile(join(tempDir, testFile), 'utf-8');
      expect(writtenContent).toBe(testContent);
    });

    it('should handle non-existent files appropriately', async () => {
      await expect(worktreeOps.readFile('nonexistent.txt'))
        .rejects.toThrow();
    });

    it('should handle binary files', async () => {
      const binaryData = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]); // PNG header
      const binaryFile = 'test.png';
      
      await fs.writeFile(join(tempDir, binaryFile), binaryData);
      
      const stats = await worktreeOps.getFileStats(binaryFile);
      expect(stats.size).toBe(binaryData.length);
      expect(stats.isFile).toBe(true);
    });

    it('should handle large files efficiently', async () => {
      const largeContent = 'A'.repeat(10000); // 10KB file
      const largeFile = 'large-test.txt';
      
      await worktreeOps.writeFile(largeFile, largeContent);
      
      const readContent = await worktreeOps.readFile(largeFile);
      expect(readContent).toBe(largeContent);
      expect(readContent.length).toBe(10000);
    });
  });

  describe('Directory Operations', () => {
    it('should list directory contents', async () => {
      // Create some test files
      await fs.writeFile(join(tempDir, 'file1.txt'), 'content1');
      await fs.writeFile(join(tempDir, 'file2.txt'), 'content2');
      await fs.mkdir(join(tempDir, 'subdir'));
      
      const contents = await worktreeOps.listDirectory('.');
      expect(contents).toContain('[FILE] file1.txt');
      expect(contents).toContain('[FILE] file2.txt');
      expect(contents).toContain('[DIR] subdir');
    });

    it('should handle nested directory creation', async () => {
      const nestedFile = 'deep/nested/path/file.txt';
      const content = 'nested content';
      
      await worktreeOps.writeFile(nestedFile, content);
      
      const readContent = await worktreeOps.readFile(nestedFile);
      expect(readContent).toBe(content);
    });

    it('should handle empty directories', async () => {
      await fs.mkdir(join(tempDir, 'empty-dir'));
      
      const contents = await worktreeOps.listDirectory('empty-dir');
      expect(contents).toEqual([]);
    });
  });

  describe('File Stats', () => {
    it('should return file statistics', async () => {
      const testFile = 'stats-test.txt';
      const testContent = 'file stats test';
      
      await worktreeOps.writeFile(testFile, testContent);
      
      const stats = await worktreeOps.getFileStats(testFile);
      expect(stats.isFile).toBe(true);
      expect(stats.isDirectory).toBe(false);
      expect(stats.size).toBe(testContent.length);
      expect(stats.mtime).toBeInstanceOf(Date);
    });

    it('should identify directories correctly', async () => {
      await fs.mkdir(join(tempDir, 'test-dir'));
      
      const stats = await worktreeOps.getFileStats('test-dir');
      expect(stats.isFile).toBe(false);
      expect(stats.isDirectory).toBe(true);
    });

    it('should handle non-existent files', async () => {
      await expect(worktreeOps.getFileStats('nonexistent-item'))
        .rejects.toThrow();
    });
  });

  describe('Command Execution', () => {
    it('should execute commands in the worktree directory', async () => {
      // Create a test file first
      await worktreeOps.writeFile('test-command.txt', 'test content');
      
      const result = await worktreeOps.executeCommand('ls', ['-la']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('test-command.txt');
    });

    it('should handle command failures', async () => {
      await expect(worktreeOps.executeCommand('nonexistent-command'))
        .rejects.toThrow('Failed to execute command');
    });

    it('should execute git commands in worktree context', async () => {
      // Initialize git repo for testing
      await worktreeOps.executeCommand('git', ['init']);
      
      const result = await worktreeOps.executeCommand('git', ['status']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBeTruthy();
    });
  });

  describe('Security Features', () => {
    it('should prevent path traversal attacks', async () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\windows\\system32\\config\\sam',
        '/etc/shadow',
        'C:\\Windows\\System32\\drivers\\etc\\hosts'
      ];
      
      for (const path of maliciousPaths) {
        await expect(worktreeOps.readFile(path))
          .rejects.toThrow();
      }
    });

    it('should validate file paths are within worktree', async () => {
      const outsidePaths = [
        '/tmp/outside-worktree.txt',
        '../outside-file.txt',
        '/home/user/outside.txt'
      ];
      
      for (const path of outsidePaths) {
        await expect(worktreeOps.readFile(path))
          .rejects.toThrow();
      }
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle many small files efficiently', async () => {
      const startTime = Date.now();
      
      // Create 100 small files
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(worktreeOps.writeFile(`file${i}.txt`, `content${i}`));
      }
      
      await Promise.all(promises);
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
      
      // Verify all files were created
      const contents = await worktreeOps.listDirectory('.');
      expect(contents.length).toBeGreaterThanOrEqual(100);
    });

    it('should handle deep directory structures', async () => {
      const deepPath = 'level1/level2/level3/level4/level5/deep-file.txt';
      const content = 'deep content';
      
      await worktreeOps.writeFile(deepPath, content);
      
      const readContent = await worktreeOps.readFile(deepPath);
      expect(readContent).toBe(content);
    });
  });

  describe('Worktree Context', () => {
    it('should maintain worktree isolation', async () => {
      // Create a file in the worktree
      await worktreeOps.writeFile('isolated-file.txt', 'isolated content');
      
      // Verify it's in the correct location
      const fullPath = join(tempDir, 'isolated-file.txt');
      const exists = await fs.access(fullPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });

    it('should execute all operations relative to worktree root', async () => {
      // Create nested structure
      await worktreeOps.writeFile('subdir/nested-file.txt', 'nested content');
      
      // List should work from root
      const rootContents = await worktreeOps.listDirectory('.');
      expect(rootContents).toContain('[DIR] subdir');
      
      // List should work from subdir
      const subdirContents = await worktreeOps.listDirectory('subdir');
      expect(subdirContents).toContain('[FILE] nested-file.txt');
    });
  });
});