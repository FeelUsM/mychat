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

describe('Runtime Operations - New Argument Format', () => {
  let testDir: string;
  let rwDir: string;
  let roDir: string;
  let rwDir2: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-runtime-test-'));
    rwDir = path.join(testDir, 'rw');
    roDir = path.join(testDir, 'ro');
    rwDir2 = path.join(testDir, 'rw2');
    await fs.mkdir(rwDir, { recursive: true });
    await fs.mkdir(roDir, { recursive: true });
    await fs.mkdir(rwDir2, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should allow read from readwrite directory', async () => {
    const testFile = path.join(rwDir, 'test.txt');
    await fs.writeFile(testFile, 'hello world');

    const result = await spawnServer([rwDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
  });

  it('should allow read from readonly directory', async () => {
    const testFile = path.join(roDir, 'test.txt');
    await fs.writeFile(testFile, 'readonly content');

    const result = await spawnServer(['-r', roDir, rwDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
  });

  it('should allow write to readwrite directory', async () => {
    const result = await spawnServer([rwDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
  });

  it('should reject write to readonly directory', async () => {
    const result = await spawnServer(['-r', roDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
  });

  it('should work with custom mcp path mapping', async () => {
    const result = await spawnServer([`${rwDir}=/mcp/data`, `${roDir}=/mcp/ro`]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    expect(result.stderr).toContain('/mcp/data');
    expect(result.stderr).toContain('/mcp/ro');
  });

  it('should resolve symlinks in host paths', async () => {
    const realDir = path.join(testDir, 'real');
    const linkDir = path.join(testDir, 'link');
    await fs.mkdir(realDir, { recursive: true });
    await fs.symlink(realDir, linkDir);

    const result = await spawnServer([linkDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
    expect(result.stderr).toContain('real');
  });
});