import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawn } from 'child_process';

const SERVER_PATH = path.join(__dirname, '..', 'dist', 'index.js');

/**
 * Spawns the filesystem server with given arguments and returns exit info
 */
async function spawnServer(args: string[], timeoutMs = 5000): Promise<{ exitCode: number | null; stderr: string }> {
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

describe('Startup Validation - New Argument Format', () => {
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

  it('should start successfully with simple paths', async () => {
    const result = await spawnServer([accessibleDir, accessibleDir2]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    expect(result.stderr).not.toContain('Error:');
  });

  it('should start with readonly flag', async () => {
    const result = await spawnServer(['-r', readonlyDir, accessibleDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    expect(result.stderr).toContain('(readonly)');
  });

  it('should start with --readonly flag', async () => {
    const result = await spawnServer(['--readonly', readonlyDir, accessibleDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    expect(result.stderr).toContain('(readonly)');
  });

  it('should start with host=mcp mapping', async () => {
    const result = await spawnServer([`${accessibleDir}=/mcp/data`, accessibleDir2]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    expect(result.stderr).toContain('/mcp/data');
  });

  it('should start with readonly host=mcp mapping', async () => {
    const result = await spawnServer(['-r', `${readonlyDir}=/mcp/ro`, accessibleDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    expect(result.stderr).toContain('/mcp/ro');
    expect(result.stderr).toContain('(readonly)');
  });

  it('should skip inaccessible directory and continue with accessible one', async () => {
    const nonExistentDir = path.join(testDir, 'non-existent-dir-12345');

    const result = await spawnServer([nonExistentDir, accessibleDir]);

    expect(result.stderr).toContain('Error: Host path does not exist or is not accessible');
    expect(result.exitCode).toBe(1);
  });

  it('should exit with error when ALL directories are inaccessible', async () => {
    const nonExistent1 = path.join(testDir, 'non-existent-1');
    const nonExistent2 = path.join(testDir, 'non-existent-2');

    const result = await spawnServer([nonExistent1, nonExistent2]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Host path does not exist or is not accessible');
  });

  it('should warn when path is not a directory', async () => {
    const filePath = path.join(testDir, 'not-a-directory.txt');
    await fs.writeFile(filePath, 'content');

    const result = await spawnServer([filePath, accessibleDir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Host path is not a directory');
  });

  it('should reject nested host paths', async () => {
    const nestedDir = path.join(accessibleDir, 'nested');
    await fs.mkdir(nestedDir, { recursive: true });

    const result = await spawnServer([accessibleDir, nestedDir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Host paths must not be nested');
  });

  it('should reject nested mcp paths', async () => {
    const result = await spawnServer([`${accessibleDir}=/mcp/data`, `${accessibleDir2}=/mcp/data/nested`]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: MCP paths must not be nested');
  });

  it('should reject mcp path not starting with /', async () => {
    const result = await spawnServer([`${accessibleDir}=mcp/data`]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: MCP path must be absolute');
  });

  it('should reject path starting with --', async () => {
    const result = await spawnServer(['--invalid-path', accessibleDir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Invalid path');
  });

  it('should reject path starting with -r', async () => {
    const result = await spawnServer(['-r-invalid-path', accessibleDir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Invalid path');
  });

  it('should reject path containing = in mcp part', async () => {
    const result = await spawnServer([`${accessibleDir}=/mcp/data=extra`]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: MCP path cannot contain');
  });

  it('should reject missing path after -r flag', async () => {
    const result = await spawnServer(['-r']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Missing path after');
  });

  it('should reject invalid mapping format', async () => {
    const result = await spawnServer(['host=']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Error: Invalid mapping format');
  });

  it('should show usage when no arguments provided', async () => {
    const result = await spawnServer([]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Usage: mcp-server-filesystem');
  });
});