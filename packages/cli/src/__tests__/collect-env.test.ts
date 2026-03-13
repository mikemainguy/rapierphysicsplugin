import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectEnvironment } from '../collect-env.js';
import { readFileSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

const mockReadFileSync = vi.mocked(readFileSync);

describe('collectEnvironment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return node version, platform, and arch', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const env = collectEnvironment('/fake/path');

    expect(env.nodeVersion).toBe(process.version);
    expect(env.platform).toBe(process.platform);
    expect(env.arch).toBe(process.arch);
  });

  it('should detect installed packages', () => {
    mockReadFileSync.mockImplementation((path) => {
      const pathStr = String(path);
      if (pathStr.includes('@rapierphysicsplugin/shared')) {
        return JSON.stringify({ version: '1.0.13' });
      }
      if (pathStr.includes('@babylonjs/core')) {
        return JSON.stringify({ version: '8.0.0' });
      }
      throw new Error('ENOENT');
    });

    const env = collectEnvironment('/fake/path');

    expect(env.packages['@rapierphysicsplugin/shared']).toBe('1.0.13');
    expect(env.packages['@babylonjs/core']).toBe('8.0.0');
    expect(env.packages['@dimforge/rapier3d-compat']).toBeUndefined();
  });

  it('should handle missing packages gracefully', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const env = collectEnvironment('/fake/path');

    expect(Object.keys(env.packages)).toHaveLength(0);
  });

  it('should handle malformed package.json', () => {
    mockReadFileSync.mockImplementation((path) => {
      const pathStr = String(path);
      if (pathStr.includes('@rapierphysicsplugin/shared')) {
        return '{ invalid json }}}';
      }
      throw new Error('ENOENT');
    });

    const env = collectEnvironment('/fake/path');

    expect(env.packages['@rapierphysicsplugin/shared']).toBeUndefined();
  });

  it('should handle package.json without version field', () => {
    mockReadFileSync.mockImplementation((path) => {
      const pathStr = String(path);
      if (pathStr.includes('@rapierphysicsplugin/shared')) {
        return JSON.stringify({ name: '@rapierphysicsplugin/shared' });
      }
      throw new Error('ENOENT');
    });

    const env = collectEnvironment('/fake/path');

    expect(env.packages['@rapierphysicsplugin/shared']).toBeUndefined();
  });
});
