import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

const SERVER_PATH = path.join(__dirname, '..', 'dist', 'index.js');

/**
 * Spawns the filesystem server with given arguments and returns exit info
 */
async function spawnServer(args: string[], timeoutMs = 3000): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn('node', [SERVER_PATH, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ exitCode: code, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ exitCode: 1, stderr: err.message });
    });
  });
}

describe('Startup Directory Validation', () => {
  let testDir: string;
  let accessibleDir: string;
  let accessibleDir2: string;
  let readonlyDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-startup-test-'));
    accessibleDir = path.join(testDir, 'accessible');
    accessibleDir2 = path.join(testDir, 'accessible2');
    readonlyDir = path.join(testDir, 'readonly');
    await fs.mkdir(accessibleDir, { recursive: true });
    await fs.mkdir(accessibleDir2, { recursive: true });
    await fs.mkdir(readonlyDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('New argument format', () => {
    it('should start successfully with simple paths', async () => {
      const result = await spawnServer([accessibleDir, accessibleDir2]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
      expect(result.stderr).not.toContain('Error:');
    });

    it('should start with read-only flag', async () => {
      const result = await spawnServer(['-r', readonlyDir, accessibleDir]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
      expect(result.stderr).toContain('readonly');
    });

    it('should start with --readonly flag', async () => {
      const result = await spawnServer(['--readonly', readonlyDir, accessibleDir]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
      expect(result.stderr).toContain('readonly');
    });

    it('should start with custom mcp path mapping', async () => {
      const result = await spawnServer([`${accessibleDir}=/mcp/data`, accessibleDir2]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
      expect(result.stderr).toContain('/mcp/data');
    });

    it('should start with read-only and custom mcp path', async () => {
      const result = await spawnServer(['-r', `${readonlyDir}=/mcp/ro`, accessibleDir]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
      expect(result.stderr).toContain('/mcp/ro');
      expect(result.stderr).toContain('readonly');
    });

    it('should start with mixed formats', async () => {
      const result = await spawnServer([
        accessibleDir,
        '-r', readonlyDir,
        `${accessibleDir2}=/mcp/data2`,
        '-r', `${readonlyDir}=/mcp/ro2`
      ]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    });
  });

  describe('Validation errors', () => {
    it('should exit with error when host path does not exist', async () => {
      const nonExistentDir = path.join(testDir, 'non-existent-dir-12345');
      const result = await spawnServer([nonExistentDir, accessibleDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('does not exist');
    });

    it('should exit with error when host path is not a directory', async () => {
      const filePath = path.join(testDir, 'not-a-directory.txt');
      await fs.writeFile(filePath, 'content');
      const result = await spawnServer([filePath, accessibleDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('not a directory');
    });

    it('should exit with error when mcp path is not absolute', async () => {
      const result = await spawnServer([`${accessibleDir}=relative/path`]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('MCP path must be absolute');
    });

    it('should exit with error when mcp path contains =', async () => {
      const result = await spawnServer([`${accessibleDir}=/mcp/path=extra`]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('cannot contain');
    });

    it('should exit with error when path starts with --', async () => {
      const result = await spawnServer(['--invalid-path', accessibleDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('cannot start with');
    });

    it('should exit with error when path starts with -r', async () => {
      const result = await spawnServer(['-r-invalid-path', accessibleDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('cannot start with');
    });

    it('should exit with error when host paths are nested', async () => {
      const nestedDir = path.join(accessibleDir, 'nested');
      await fs.mkdir(nestedDir, { recursive: true });
      const result = await spawnServer([accessibleDir, nestedDir]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('nested');
    });

    it('should exit with error when mcp paths are nested', async () => {
      const result = await spawnServer([
        `${accessibleDir}=/mcp/parent`,
        `${accessibleDir2}=/mcp/parent/child`
      ]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('nested');
    });

    it('should exit with error when -r flag has no following path', async () => {
      const result = await spawnServer(['-r']);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('Missing path after');
    });

    it('should exit with error when no arguments provided', async () => {
      const result = await spawnServer([]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Usage:');
    });
  });

  describe('Symlink handling', () => {
    it('should resolve symlinks in host paths', async () => {
      const realDir = path.join(testDir, 'real-dir');
      const linkDir = path.join(testDir, 'link-dir');
      await fs.mkdir(realDir, { recursive: true });
      await fs.symlink(realDir, linkDir);
      
      const result = await spawnServer([linkDir]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
      expect(result.stderr).toContain('real-dir');
    });
  });

  describe('Case insensitivity for mcp paths', () => {
    it('should treat mcp paths case-insensitively', async () => {
      const result = await spawnServer([
        `${accessibleDir}=/MCP/Data`,
        `${accessibleDir2}=/mcp/data2`
      ]);
      expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    });
  });
});