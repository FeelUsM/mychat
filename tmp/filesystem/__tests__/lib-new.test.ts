import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  setAllowedDirectories,
  getAllowedDirectories,
  resolveMcpPath,
  isMcpPathReadonly,
  validatePath,
  AllowedDir,
} from '../lib.js';

// Mock fs module
vi.mock('fs/promises');
const mockFs = fs as any;

describe('New Lib Functions - Path Resolution & Readonly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set up allowed directories with mixed readonly/readwrite
    const allowedDirs: AllowedDir[] = [
      { hostPath: '/home/user', mcpPath: '/home/user', readonly: false },
      { hostPath: '/tmp', mcpPath: '/tmp', readonly: false },
      { hostPath: '/host/data', mcpPath: '/mcp/data', readonly: false },
      { hostPath: '/host/readonly', mcpPath: '/mcp/readonly', readonly: true },
      { hostPath: '/host/ro', mcpPath: '/mcp/ro', readonly: true },
    ];
    setAllowedDirectories(allowedDirs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setAllowedDirectories([]);
  });

  describe('resolveMcpPath', () => {
    it('resolves exact mcp path match', async () => {
      const result = await resolveMcpPath('/home/user/file.txt');
      expect(result).toBe('/home/user/file.txt');
    });

    it('resolves subdirectory paths', async () => {
      const result = await resolveMcpPath('/home/user/src/index.ts');
      expect(result).toBe('/home/user/src/index.ts');
    });

    it('resolves with custom mcp path mapping', async () => {
      const result = await resolveMcpPath('/mcp/data/test.txt');
      expect(result).toBe('/host/data/test.txt');
    });

    it('resolves subdirectory with custom mcp path mapping', async () => {
      const result = await resolveMcpPath('/mcp/data/subdir/file.txt');
      expect(result).toBe('/host/data/subdir/file.txt');
    });

    it('handles case-insensitive mcp paths', async () => {
      const result = await resolveMcpPath('/MCP/DATA/file.txt');
      expect(result).toBe('/host/data/file.txt');
    });

    it('throws for paths outside allowed directories', async () => {
      await expect(resolveMcpPath('/etc/passwd'))
        .rejects.toThrow('Access denied - path outside allowed directories');
    });

    it('throws for paths not matching any allowed directory', async () => {
      await expect(resolveMcpPath('/nonexistent/file.txt'))
        .rejects.toThrow('Access denied - path outside allowed directories');
    });

    it('throws for paths that would escape host directory', async () => {
      // Try to escape via path traversal in mcp path
      await expect(resolveMcpPath('/mcp/data/../../etc/passwd'))
        .rejects.toThrow('Access denied');
    });
  });

  describe('isMcpPathReadonly', () => {
    it('returns true for readonly directories', () => {
      expect(isMcpPathReadonly('/mcp/readonly/file.txt')).toBe(true);
      expect(isMcpPathReadonly('/mcp/readonly')).toBe(true);
      expect(isMcpPathReadonly('/mcp/readonly/subdir/file.txt')).toBe(true);
      expect(isMcpPathReadonly('/mcp/ro/file.txt')).toBe(true);
    });

    it('returns false for readwrite directories', () => {
      expect(isMcpPathReadonly('/home/user/file.txt')).toBe(false);
      expect(isMcpPathReadonly('/tmp/file.txt')).toBe(false);
      expect(isMcpPathReadonly('/mcp/data/file.txt')).toBe(false);
    });

    it('returns true for paths outside allowed directories', () => {
      expect(isMcpPathReadonly('/outside/file.txt')).toBe(true);
    });
  });

  describe('validatePath', () => {
    beforeEach(() => {
      mockFs.realpath.mockImplementation(async (p: any) => p.toString());
    });

    it('validates allowed paths for read', async () => {
      const result = await validatePath('/home/user/file.txt', false);
      expect(result).toBe('/home/user/file.txt');
    });

    it('validates allowed paths for write', async () => {
      const result = await validatePath('/home/user/file.txt', true);
      expect(result).toBe('/home/user/file.txt');
    });

    it('rejects disallowed paths', async () => {
      await expect(validatePath('/etc/passwd', false))
        .rejects.toThrow('Access denied - path outside allowed directories');
    });

    it('handles non-existent files by checking parent directory', async () => {
      const newFilePath = '/home/user/newfile.txt';
      const parentPath = '/home/user';
      
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      
      mockFs.realpath
        .mockRejectedValueOnce(enoentError)
        .mockResolvedValueOnce(parentPath);
      
      const result = await validatePath(newFilePath, false);
      expect(result).toBe(path.resolve(newFilePath));
    });

    it('rejects when parent directory does not exist', async () => {
      const newFilePath = '/home/user/nonexistent/newfile.txt';
      
      const enoentError1 = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError1.code = 'ENOENT';
      const enoentError2 = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError2.code = 'ENOENT';
      
      mockFs.realpath
        .mockRejectedValueOnce(enoentError1)
        .mockRejectedValueOnce(enoentError2);
      
      await expect(validatePath(newFilePath, false))
        .rejects.toThrow('Parent directory does not exist');
    });

    it('rejects write to readonly directory', async () => {
      await expect(validatePath('/mcp/readonly/file.txt', true))
        .rejects.toThrow('Access denied - directory is read-only');
    });

    it('allows read from readonly directory', async () => {
      const result = await validatePath('/mcp/readonly/file.txt', false);
      expect(result).toBe('/mcp/readonly/file.txt');
    });

    it('rejects write to readonly subdirectory', async () => {
      await expect(validatePath('/mcp/readonly/subdir/file.txt', true))
        .rejects.toThrow('Access denied - directory is read-only');
    });

    it('rejects write when parent is readonly', async () => {
      const newFilePath = '/mcp/readonly/newfile.txt';
      const parentPath = '/host/readonly';
      
      const enoentError = new Error('ENOENT') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      
      mockFs.realpath
        .mockRejectedValueOnce(enoentError)
        .mockResolvedValueOnce(parentPath);
      
      await expect(validatePath(newFilePath, true))
        .rejects.toThrow('Access denied - parent directory is read-only');
    });
  });

  describe('getAllowedDirectories', () => {
    it('returns copy of allowed directories', () => {
      const dirs = getAllowedDirectories();
      expect(dirs).toHaveLength(5);
      expect(dirs[0]).toEqual({ hostPath: '/home/user', mcpPath: '/home/user', readonly: false });
      expect(dirs[3]).toEqual({ hostPath: '/host/readonly', mcpPath: '/mcp/readonly', readonly: true });
    });

    it('returns independent copy', () => {
      const dirs1 = getAllowedDirectories();
      const dirs2 = getAllowedDirectories();
      expect(dirs1).not.toBe(dirs2);
      dirs1.push({ hostPath: '/test', mcpPath: '/test', readonly: false });
      expect(getAllowedDirectories()).toHaveLength(5);
    });
  });
});