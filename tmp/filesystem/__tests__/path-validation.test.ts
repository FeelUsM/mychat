import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { isPathWithinAllowedDirectories } from '../path-validation.js';

/**
 * Check if the current environment supports symlink creation
 */
async function checkSymlinkSupport(): Promise<boolean> {
  const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symlink-test-'));
  try {
    const targetFile = path.join(testDir, 'target.txt');
    const linkFile = path.join(testDir, 'link.txt');
    
    await fs.writeFile(targetFile, 'test');
    await fs.symlink(targetFile, linkFile);
    
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') {
      return false;
    }
    throw error;
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
}

let symlinkSupported: boolean | null = null;

async function getSymlinkSupport(): Promise<boolean> {
  if (symlinkSupported === null) {
    symlinkSupported = await checkSymlinkSupport();
    if (!symlinkSupported) {
      console.log('\n⚠️  Symlink tests will be skipped - symlink creation not supported in this environment');
      console.log('   On Windows, enable Developer Mode or run as Administrator to enable symlink tests');
    }
  }
  return symlinkSupported;
}

describe('Path Validation', () => {
  it('allows exact directory match', () => {
    const allowed = ['/home/user/project'];
    expect(isPathWithinAllowedDirectories('/home/user/project', allowed)).toBe(true);
  });

  it('allows subdirectories', () => {
    const allowed = ['/home/user/project'];
    expect(isPathWithinAllowedDirectories('/home/user/project/src', allowed)).toBe(true);
    expect(isPathWithinAllowedDirectories('/home/user/project/src/index.js', allowed)).toBe(true);
    expect(isPathWithinAllowedDirectories('/home/user/project/deeply/nested/file.txt', allowed)).toBe(true);
  });

  it('blocks similar directory names (prefix vulnerability)', () => {
    const allowed = ['/home/user/project'];
    expect(isPathWithinAllowedDirectories('/home/user/project2', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user/project_backup', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user/project-old', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user/projectile', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user/project.bak', allowed)).toBe(false);
  });

  it('blocks paths outside allowed directories', () => {
    const allowed = ['/home/user/project'];
    expect(isPathWithinAllowedDirectories('/home/user/other', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/etc/passwd', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/', allowed)).toBe(false);
  });

  it('handles multiple allowed directories', () => {
    const allowed = ['/home/user/project1', '/home/user/project2'];
    expect(isPathWithinAllowedDirectories('/home/user/project1/src', allowed)).toBe(true);
    expect(isPathWithinAllowedDirectories('/home/user/project2/src', allowed)).toBe(true);
    expect(isPathWithinAllowedDirectories('/home/user/project3', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user/project1_backup', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user/project2-old', allowed)).toBe(false);
  });

  it('blocks parent and sibling directories', () => {
    const allowed = ['/test/allowed'];

    // Parent directory
    expect(isPathWithinAllowedDirectories('/test', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/', allowed)).toBe(false);

    // Sibling with common prefix
    expect(isPathWithinAllowedDirectories('/test/allowed_sibling', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/test/allowed2', allowed)).toBe(false);
  });

  it('handles paths with special characters', () => {
    const allowed = ['/home/user/my-project (v2)'];

    expect(isPathWithinAllowedDirectories('/home/user/my-project (v2)', allowed)).toBe(true);
    expect(isPathWithinAllowedDirectories('/home/user/my-project (v2)/src', allowed)).toBe(true);
    expect(isPathWithinAllowedDirectories('/home/user/my-project (v2)_backup', allowed)).toBe(false);
    expect(isPathWithinAllowedDirectories('/home/user/my-project', allowed)).toBe(false);
  });

  describe('Input validation', () => {
    it('rejects empty inputs', () => {
      const allowed = ['/home/user/project'];

      expect(isPathWithinAllowedDirectories('', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project', [])).toBe(false);
    });

    it('handles trailing separators correctly', () => {
      const allowed = ['/home/user/project'];

      // Path with trailing separator should still match
      expect(isPathWithinAllowedDirectories('/home/user/project/', allowed)).toBe(true);

      // Allowed directory with trailing separator
      const allowedWithSep = ['/home/user/project/'];
      expect(isPathWithinAllowedDirectories('/home/user/project', allowedWithSep)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/project/', allowedWithSep)).toBe(true);

      // Should still block similar names with or without trailing separators
      expect(isPathWithinAllowedDirectories('/home/user/project2', allowedWithSep)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project2', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project2/', allowed)).toBe(false);
    });

    it('skips empty directory entries in allowed list', () => {
      const allowed = ['', '/home/user/project', ''];
      expect(isPathWithinAllowedDirectories('/home/user/project', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/project/src', allowed)).toBe(true);

      // Should still validate properly with empty entries
      expect(isPathWithinAllowedDirectories('/home/user/other', allowed)).toBe(false);
    });

    it('handles Windows paths with trailing separators', () => {
      if (path.sep === '\\') {
        const allowed = ['C:\\Users\\project'];

        // Path with trailing separator
        expect(isPathWithinAllowedDirectories('C:\\Users\\project\\', allowed)).toBe(true);

        // Allowed with trailing separator
        const allowedWithSep = ['C:\\Users\\project\\'];
        expect(isPathWithinAllowedDirectories('C:\\Users\\project', allowedWithSep)).toBe(true);
        expect(isPathWithinAllowedDirectories('C:\\Users\\project\\', allowedWithSep)).toBe(true);

        // Should still block similar names
        expect(isPathWithinAllowedDirectories('C:\\Users\\project2\\', allowed)).toBe(false);
      }
    });
  });

  describe('Error handling', () => {
    it('normalizes relative paths to absolute', () => {
      const allowed = [process.cwd()];

      // Relative paths get normalized to absolute paths based on cwd
      expect(isPathWithinAllowedDirectories('relative/path', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('./file', allowed)).toBe(true);

      // Parent directory references that escape allowed directory
      const parentAllowed = ['/home/user/project'];
      expect(isPathWithinAllowedDirectories('../parent', parentAllowed)).toBe(false);
    });

    it('returns false for relative paths in allowed directories', () => {
      const badAllowed = ['relative/path', '/some/other/absolute/path'];

      // Relative paths in allowed dirs are normalized to absolute based on cwd
      // The normalized 'relative/path' won't match our test path
      expect(isPathWithinAllowedDirectories('/some/other/absolute/path/file', badAllowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/absolute/path/file', badAllowed)).toBe(false);
    });

    it('handles null and undefined inputs gracefully', () => {
      const allowed = ['/home/user/project'];

      // Should return false, not crash
      expect(isPathWithinAllowedDirectories(null as any, allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories(undefined as any, allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/path', null as any)).toBe(false);
      expect(isPathWithinAllowedDirectories('/path', undefined as any)).toBe(false);
    });
  });

  describe('Unicode and special characters', () => {
    it('handles unicode characters in paths', () => {
      const allowed = ['/home/user/café'];

      expect(isPathWithinAllowedDirectories('/home/user/café', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/café/file', allowed)).toBe(true);

      // Different unicode representation won't match (not normalized)
      const decomposed = '/home/user/cafe\u0301'; // e + combining accent
      expect(isPathWithinAllowedDirectories(decomposed, allowed)).toBe(false);
    });

    it('handles paths with spaces correctly', () => {
      const allowed = ['/home/user/my project'];

      expect(isPathWithinAllowedDirectories('/home/user/my project', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/my project/file', allowed)).toBe(true);

      // Partial matches should fail
      expect(isPathWithinAllowedDirectories('/home/user/my', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/my proj', allowed)).toBe(false);
    });
  });

  describe('Overlapping allowed directories', () => {
    it('handles nested allowed directories correctly', () => {
      const allowed = ['/home', '/home/user', '/home/user/project'];

      // All paths under /home are allowed
      expect(isPathWithinAllowedDirectories('/home/anything', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/anything', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/project/anything', allowed)).toBe(true);

      // First match wins (most permissive)
      expect(isPathWithinAllowedDirectories('/home/other/deep/path', allowed)).toBe(true);
    });

    it('handles root directory as allowed', () => {
      const allowed = ['/'];

      // Everything is allowed under root (dangerous configuration)
      expect(isPathWithinAllowedDirectories('/', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/any/path', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/etc/passwd', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/secret', allowed)).toBe(true);

      // But only on the same filesystem root
      if (path.sep === '\\') {
        expect(isPathWithinAllowedDirectories('D:\\other', ['/'])).toBe(false);
      }
    });
  });

  describe('Cross-platform behavior', () => {
    it('handles Windows-style paths on Windows', () => {
      if (path.sep === '\\') {
        const allowed = ['C:\\Users\\project'];
        expect(isPathWithinAllowedDirectories('C:\\Users\\project', allowed)).toBe(true);
        expect(isPathWithinAllowedDirectories('C:\\Users\\project\\src', allowed)).toBe(true);
        expect(isPathWithinAllowedDirectories('C:\\Users\\project2', allowed)).toBe(false);
        expect(isPathWithinAllowedDirectories('C:\\Users\\project_backup', allowed)).toBe(false);
      }
    });

    it('handles Unix-style paths on Unix', () => {
      if (path.sep === '/') {
        const allowed = ['/home/user/project'];
        expect(isPathWithinAllowedDirectories('/home/user/project', allowed)).toBe(true);
        expect(isPathWithinAllowedDirectories('/home/user/project/src', allowed)).toBe(true);
        expect(isPathWithinAllowedDirectories('/home/user/project2', allowed)).toBe(false);
      }
    });
  });

  describe('Validation Tests - Path Traversal', () => {
    it('blocks path traversal attempts', () => {
      const allowed = ['/home/user/project'];

      // Basic traversal attempts
      expect(isPathWithinAllowedDirectories('/home/user/project/../../../etc/passwd', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project/../../other', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project/../project2', allowed)).toBe(false);

      // Mixed traversal with valid segments
      expect(isPathWithinAllowedDirectories('/home/user/project/src/../../project2', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project/./../../other', allowed)).toBe(false);

      // Multiple traversal sequences
      expect(isPathWithinAllowedDirectories('/home/user/project/../project/../../../etc', allowed)).toBe(false);
    });

    it('blocks traversal in allowed directories', () => {
      const allowed = ['/home/user/project/../safe'];

      // The allowed directory itself should be normalized and safe
      expect(isPathWithinAllowedDirectories('/home/user/safe/file', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/project/file', allowed)).toBe(false);
    });

    it('handles complex traversal patterns', () => {
      const allowed = ['/home/user/project'];

      // Double dots in filenames (not traversal) - these normalize to paths within allowed dir
      expect(isPathWithinAllowedDirectories('/home/user/project/..test', allowed)).toBe(true); // Not traversal
      expect(isPathWithinAllowedDirectories('/home/user/project/test..', allowed)).toBe(true); // Not traversal
      expect(isPathWithinAllowedDirectories('/home/user/project/te..st', allowed)).toBe(true); // Not traversal

      // Actual traversal
      expect(isPathWithinAllowedDirectories('/home/user/project/../test', allowed)).toBe(false); // Is traversal - goes to /home/user/test

      // Edge case: /home/user/project/.. normalizes to /home/user (parent dir)
      expect(isPathWithinAllowedDirectories('/home/user/project/..', allowed)).toBe(false); // Goes to parent
    });
  });

  describe('Validation Tests - Null Bytes', () => {
    it('rejects paths with null bytes', () => {
      const allowed = ['/home/user/project'];

      expect(isPathWithinAllowedDirectories('/home/user/project\x00/etc/passwd', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project/test\x00.txt', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('\x00/home/user/project', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project/\x00', allowed)).toBe(false);
    });

    it('rejects allowed directories with null bytes', () => {
      const allowed = ['/home/user/project\x00'];

      expect(isPathWithinAllowedDirectories('/home/user/project', allowed)).toBe(false);
      expect(isPathWithinAllowedDirectories('/home/user/project/file', allowed)).toBe(false);
    });
  });

  describe('Validation Tests - Special Characters', () => {
    it('allows percent signs in filenames', () => {
      const allowed = ['/home/user/project'];

      // Percent is a valid filename character
      expect(isPathWithinAllowedDirectories('/home/user/project/report_50%.pdf', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/project/Q1_25%_growth', allowed)).toBe(true);
      expect(isPathWithinAllowedDirectories('/home/user/project/%41', allowed)).toBe(true); // File named %41

      // URL encoding is NOT decoded by path.normalize, so these are just odd filenames
      expect(isPathWithinAllowedDirectories('/home/user/project/%2e%2e', allowed)).toBe(true); // File named "%2e%2e"
      expect(isPathWithinAllowedDirectories('/home/user/project/file%20name', allowed)).toBe(true); // File with %20 in name
    });

    it('handles percent signs in allowed directories', () => {
      const allowed = ['/home/user/project%20files'];

      // This is a directory literally named "project%20files"
      expect(isPathWithinAllowedDirectories('/home/user/project%20files/test', allowed)).toBe(true);
    });
  });

  describe('Symlink Tests', () => {
    let testDir: string;
    let allowedDir: string;
    let forbiddenDir: string;

    beforeEach(async () => {
      const supported = await getSymlinkSupport();
      if (!supported) {
        return; // Tests will be skipped
      }

      testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'path-validation-symlink-'));
      allowedDir = path.join(testDir, 'allowed');
      forbiddenDir = path.join(testDir, 'forbidden');
      await fs.mkdir(allowedDir, { recursive: true });
      await fs.mkdir(forbiddenDir, { recursive: true });
    });

    afterEach(async () => {
      if (testDir) {
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });

    it('should allow symlinks within allowed directories', async () => {
      const supported = await getSymlinkSupport();
      if (!supported) return;

      const targetFile = path.join(allowedDir, 'target.txt');
      const symlinkPath = path.join(allowedDir, 'symlink.txt');

      await fs.writeFile(targetFile, 'TARGET CONTENT');
      await fs.symlink(targetFile, symlinkPath);

      // The symlink path itself is within allowed directory
      expect(isPathWithinAllowedDirectories(symlinkPath, [allowedDir])).toBe(true);
    });

    it('should detect symlinks pointing outside allowed directories', async () => {
      const supported = await getSymlinkSupport();
      if (!supported) return;

      const targetFile = path.join(forbiddenDir, 'secret.txt');
      const symlinkPath = path.join(allowedDir, 'symlink.txt');

      await fs.writeFile(targetFile, 'SECRET CONTENT');
      await fs.symlink(targetFile, symlinkPath);

      // The symlink path is within allowed directory
      expect(isPathWithinAllowedDirectories(symlinkPath, [allowedDir])).toBe(true);

      // But the real path is outside
      const realPath = await fs.realpath(symlinkPath);
      expect(isPathWithinAllowedDirectories(realPath, [allowedDir])).toBe(false);
    });

    it('should allow symlinks pointing to other locations within allowed directories', async () => {
      const supported = await getSymlinkSupport();
      if (!supported) return;

      const targetFile = path.join(allowedDir, 'subdir', 'target.txt');
      const symlinkPath = path.join(allowedDir, 'symlink.txt');

      await fs.mkdir(path.dirname(targetFile), { recursive: true });
      await fs.writeFile(targetFile, 'TARGET CONTENT');
      await fs.symlink(targetFile, symlinkPath);

      const realPath = await fs.realpath(symlinkPath);
      expect(isPathWithinAllowedDirectories(realPath, [allowedDir])).toBe(true);
    });

    it('should handle symlinks to parent directories within allowed tree', async () => {
      const supported = await getSymlinkSupport();
      if (!supported) return;

      const subdir = path.join(allowedDir, 'subdir');
      const symlinkPath = path.join(subdir, 'parent-link');

      await fs.mkdir(subdir, { recursive: true });
      await fs.symlink(allowedDir, symlinkPath);

      const realPath = await fs.realpath(symlinkPath);
      expect(isPathWithinAllowedDirectories(realPath, [allowedDir])).toBe(true);
    });
  });
});