import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const cliRoot = join(__dirname, '..');
export const repositoryUrl = 'git+https://github.com/tianyaXs/giteam.git';
export const homepageUrl = 'https://github.com/tianyaXs/giteam#readme';
export const bugsUrl = 'https://github.com/tianyaXs/giteam/issues';
export const packageKeywords = ['giteam', 'cli', 'tauri', 'opencode', 'lan'];
export const packageAuthor = 'giteam Contributors';

export const platformMatrix = {
  'darwin-arm64': {
    key: 'darwin-arm64',
    os: 'darwin',
    cpu: 'arm64',
    rustTarget: 'aarch64-apple-darwin',
    packageName: 'giteam-darwin-arm64',
    packageDir: join(cliRoot, 'npm', 'darwin-arm64'),
    binaryFileName: 'giteam'
  },
  'darwin-x64': {
    key: 'darwin-x64',
    os: 'darwin',
    cpu: 'x64',
    rustTarget: 'x86_64-apple-darwin',
    packageName: 'giteam-darwin-x64',
    packageDir: join(cliRoot, 'npm', 'darwin-x64'),
    binaryFileName: 'giteam'
  },
  'linux-arm64': {
    key: 'linux-arm64',
    os: 'linux',
    cpu: 'arm64',
    rustTarget: 'aarch64-unknown-linux-gnu',
    packageName: 'giteam-linux-arm64',
    packageDir: join(cliRoot, 'npm', 'linux-arm64'),
    binaryFileName: 'giteam'
  },
  'linux-x64': {
    key: 'linux-x64',
    os: 'linux',
    cpu: 'x64',
    rustTarget: 'x86_64-unknown-linux-gnu',
    packageName: 'giteam-linux-x64',
    packageDir: join(cliRoot, 'npm', 'linux-x64'),
    binaryFileName: 'giteam'
  }
};

export function getPlatformKey(os, cpu) {
  const key = `${os}-${cpu}`;
  return platformMatrix[key] ? key : null;
}

export function getCurrentPlatformKey() {
  return getPlatformKey(process.platform, process.arch);
}

export function getCurrentPlatformPackage() {
  const key = getCurrentPlatformKey();
  return key ? platformMatrix[key] : null;
}

export function listPlatforms() {
  return Object.values(platformMatrix);
}

export function listPlatformKeys() {
  return Object.keys(platformMatrix);
}
