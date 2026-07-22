import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { normalizePath, expandHome } from '../path-utils.js';

describe('Path Utils', () => {
  describe('normalizePath', () => {
    it('normalizes Unix paths', () => {
      expect(normalizePath('/home/user/project')).toBe('/home/user/project');
      expect(normalizePath('/home/user/project/')).toBe('/home/user/project');
      expect(normalizePath('/home//user///project')).toBe('/home/user/project');
      expect(normalizePath('/home/user/../user/project')).toBe('/home/user/project');
      expect(normalizePath('/home/user/./project')).toBe('/home/user/project');
    });

    it('handles WSL paths', () => {
      expect(normalizePath('/mnt/c/Users/test')).toBe('/mnt/c/Users/test');
      expect(normalizePath('/mnt/d/project')).toBe('/mnt/d/project');
    });

    it('handles Windows paths on Windows', () => {
      if (process.platform === 'win32') {
        expect(normalizePath('C:\\Users\\test')).toBe('C:\\Users\\test');
        expect(normalizePath('C:/Users/test')).toBe('C:\\Users\\test');
        expect(normalizePath('C:')).toBe('C:\\');
      }
    });

    it('handles UNC paths on Windows', () => {
      if (process.platform === 'win32') {
        expect(normalizePath('\\\\server\\share')).toBe('\\\\server\\share');
        expect(normalizePath('\\\\\\server\\share')).toBe('\\\\server\\share');
      }
    });

    it('removes surrounding quotes', () => {
      expect(normalizePath('"/home/user/project"')).toBe('/home/user/project');
      expect(normalizePath("'/home/user/project'")).toBe('/home/user/project');
    });

    it('trims whitespace', () => {
      expect(normalizePath('  /home/user/project  ')).toBe('/home/user/project');
    });
  });

  describe('expandHome', () => {
    it('expands tilde', () => {
      const home = os.homedir();
      expect(expandHome('~/project')).toBe(path.join(home, 'project'));
      expect(expandHome('~')).toBe(home);
    });

    it('leaves non-tilde paths unchanged', () => {
      expect(expandHome('/home/user/project')).toBe('/home/user/project');
      expect(expandHome('relative/path')).toBe('relative/path');
    });
  });
});