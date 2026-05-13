import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Workspace } from '../workspace.js';

describe('Workspace', () => {
  let tmpDir: string;
  let workspace: Workspace;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'agent-test-'));
    workspace = new Workspace(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should write and read files', async () => {
    await workspace.write('test.txt', 'hello world');
    const content = await workspace.read('test.txt');
    expect(content).toBe('hello world');
  });

  it('should return null for missing files', async () => {
    const content = await workspace.read('nonexistent.txt');
    expect(content).toBeNull();
  });

  it('should create intermediate directories on write', async () => {
    await workspace.write('a/b/c/test.txt', 'deep');
    const content = await workspace.read('a/b/c/test.txt');
    expect(content).toBe('deep');
  });

  it('should append to files', async () => {
    await workspace.write('log.txt', 'line1\n');
    await workspace.append('log.txt', 'line2\n');
    const content = await workspace.read('log.txt');
    expect(content).toBe('line1\nline2\n');
  });

  it('should edit files by replacing text', async () => {
    await workspace.write('config.txt', 'key: old_value');
    const success = await workspace.edit('config.txt', 'old_value', 'new_value');
    expect(success).toBe(true);
    const content = await workspace.read('config.txt');
    expect(content).toBe('key: new_value');
  });

  it('should return false when edit text not found', async () => {
    await workspace.write('config.txt', 'key: value');
    const success = await workspace.edit('config.txt', 'nonexistent', 'new');
    expect(success).toBe(false);
  });

  it('should list directory contents', async () => {
    await workspace.write('file1.txt', '');
    await workspace.write('file2.txt', '');
    await mkdir(path.join(tmpDir, 'subdir'));
    const entries = await workspace.list('.');
    expect(entries).toContain('file1.txt');
    expect(entries).toContain('file2.txt');
    expect(entries).toContain('subdir');
  });

  it('should return empty array for missing dirs', async () => {
    const entries = await workspace.list('nonexistent');
    expect(entries).toEqual([]);
  });

  it('should check file existence', async () => {
    await workspace.write('exists.txt', 'content');
    expect(workspace.exists('exists.txt')).toBe(true);
    expect(workspace.exists('no.txt')).toBe(false);
  });

  it('should delete files', async () => {
    await workspace.write('delete-me.txt', 'bye');
    expect(workspace.exists('delete-me.txt')).toBe(true);
    const deleted = await workspace.delete('delete-me.txt');
    expect(deleted).toBe(true);
    expect(workspace.exists('delete-me.txt')).toBe(false);
  });

  it('should rename files', async () => {
    await workspace.write('old.txt', 'content');
    const renamed = await workspace.rename('old.txt', 'new.txt');
    expect(renamed).toBe(true);
    expect(workspace.exists('old.txt')).toBe(false);
    expect(workspace.exists('new.txt')).toBe(true);
  });

  it('should handle absolute paths', async () => {
    const absPath = path.join(tmpDir, 'abs.txt');
    await workspace.write(absPath, 'absolute');
    expect(workspace.exists(absPath)).toBe(true);
  });
});
