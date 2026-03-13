import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  packages: Record<string, string>;
}

const PACKAGES_TO_DETECT = [
  '@rapierphysicsplugin/shared',
  '@rapierphysicsplugin/client',
  '@rapierphysicsplugin/server',
  '@babylonjs/core',
  '@dimforge/rapier3d-compat',
  '@dimforge/rapier3d-simd-compat',
];

function readPackageVersion(cwd: string, packageName: string): string | null {
  try {
    const pkgPath = join(cwd, 'node_modules', ...packageName.split('/'), 'package.json');
    const content = readFileSync(pkgPath, 'utf-8');
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

export function collectEnvironment(cwd: string = process.cwd()): EnvironmentInfo {
  const packages: Record<string, string> = {};

  for (const name of PACKAGES_TO_DETECT) {
    const version = readPackageVersion(cwd, name);
    if (version) {
      packages[name] = version;
    }
  }

  return {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    packages,
  };
}
