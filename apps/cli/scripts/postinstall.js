#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCurrentPlatformKey, getCurrentPlatformPackage, listPlatforms } from './platform-manifest.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const platformKey = getCurrentPlatformKey();
const platformPackage = getCurrentPlatformPackage();
const cargoCommand = process.platform === 'win32' ? 'cargo.exe' : 'cargo';
const cargoAvailable = spawnSync(cargoCommand, ['--version'], {
  stdio: 'ignore',
  env: process.env
}).status === 0;

/**
 * npm 全局更新后 launchd/systemd 仍可能指向旧路径，或同路径下旧进程未重载。
 * 若本机已有托管服务定义，则自动 ensure，避免用户再手跑 reconcile。
 */
function ensureManagedService() {
  if (process.env.GITEAM_SKIP_SERVICE_ENSURE === '1') {
    return;
  }

  const home = (process.env.HOME || '').trim();
  if (!home) {
    return;
  }

  const plist = join(home, 'Library', 'LaunchAgents', 'com.giteam.control-service.plist');
  const xdg = (process.env.XDG_CONFIG_HOME || '').trim();
  const unit = join(
    xdg || join(home, '.config'),
    'systemd',
    'user',
    'com.giteam.control-service.service'
  );

  if (!existsSync(plist) && !existsSync(unit)) {
    return;
  }

  const binJs = join(root, 'bin', 'giteam.js');
  if (!existsSync(binJs)) {
    console.warn('[giteam] managed service found but bin/giteam.js missing; skip ensure');
    return;
  }

  console.log('[giteam] ensuring managed control service matches this install…');
  const result = spawnSync(process.execPath, [binJs, 'service', 'ensure'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    console.warn(
      '[giteam] service ensure failed (non-fatal). Later `giteam status` will retry, or run: giteam service ensure'
    );
  }
}

if (platformPackage) {
  try {
    require.resolve(`${platformPackage.packageName}/package.json`);
    console.log(`[giteam] using prebuilt package ${platformPackage.packageName}`);
    ensureManagedService();
    process.exit(0);
  } catch {
    // Continue to fallback messaging below.
  }
}

if (cargoAvailable) {
  console.log('[giteam] prebuilt package unavailable, Cargo fallback remains available');
  ensureManagedService();
  process.exit(0);
}

const supported = listPlatforms().map((item) => item.key).join(', ');
console.warn(
  `[giteam] no prebuilt package available for ${platformKey || 'this platform'} and Cargo was not found.\n` +
    `Supported prebuilt targets: ${supported}\n` +
    'Install Rust/Cargo to enable source fallback, or use a supported prebuilt platform package.'
);
ensureManagedService();
