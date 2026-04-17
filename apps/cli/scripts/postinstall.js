#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getCurrentPlatformKey, getCurrentPlatformPackage, listPlatforms } from './platform-manifest.js';

const require = createRequire(import.meta.url);
const platformKey = getCurrentPlatformKey();
const platformPackage = getCurrentPlatformPackage();
const cargoAvailable = spawnSync('cargo', ['--version'], {
  stdio: 'ignore',
  env: process.env
}).status === 0;

if (platformPackage) {
  try {
    require.resolve(`${platformPackage.packageName}/package.json`);
    console.log(`[giteam] using prebuilt package ${platformPackage.packageName}`);
    process.exit(0);
  } catch {
    // Continue to fallback messaging below.
  }
}

if (cargoAvailable) {
  console.log('[giteam] prebuilt package unavailable, Cargo fallback remains available');
  process.exit(0);
}

const supported = listPlatforms().map((item) => item.key).join(', ');
console.warn(
  `[giteam] no prebuilt package available for ${platformKey || 'this platform'} and Cargo was not found.\n` +
    `Supported prebuilt targets: ${supported}\n` +
    'Install Rust/Cargo to enable source fallback, or use a supported prebuilt platform package.'
);
