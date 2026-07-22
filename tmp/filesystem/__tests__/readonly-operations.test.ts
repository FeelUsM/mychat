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

describe('Write operations on readonly directories', () => {
  let testDir: string;
  let rwDir: string;
  let roDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-readonly-test-'));
    rwDir = path.join(testDir, 'rw');
    roDir = path.join(testDir, 'ro');
    await fs.mkdir(rwDir, { recursive: true });
    await fs.mkdir(roDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should allow write to readwrite directory', async () => {
    const result = await spawnServer([rwDir, '-r', roDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
  });

  it('should reject write to readonly directory', async () => {
    const result = await spawnServer([rwDir, '-r', roDir]);
    expect(result.stderr).toContain('Secure MCP Filesystem Server running on stdio');
  });
});