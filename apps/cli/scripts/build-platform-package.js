#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cliRoot, getCurrentPlatformKey, listPlatforms, platformMatrix } from './platform-manifest.js';

const args = process.argv.slice(2);
const shouldPack = args.includes('--pack');
const buildAll = args.includes('--all');
const platformArgIndex = args.indexOf('--platform');
const explicitPlatform = platformArgIndex >= 0 ? args[platformArgIndex + 1] : null;

const selectedKeys = buildAll
  ? listPlatforms().map((platform) => platform.key)
  : [explicitPlatform || getCurrentPlatformKey()].filter(Boolean);

if (!selectedKeys.length) {
  console.error('[giteam] unsupported platform, pass --platform explicitly');
  process.exit(1);
}

run('node', ['./scripts/sync-rust-sources.js']);
run('node', ['./scripts/sync-platform-packages.js']);

for (const key of selectedKeys) {
  const platform = platformMatrix[key];
  if (!platform) {
    console.error(`[giteam] unknown platform key: ${key}`);
    process.exit(1);
  }

  run('cargo', ['build', '--release', '--target', platform.rustTarget]);

  const builtBinary = join(cliRoot, 'target', platform.rustTarget, 'release', 'giteam');
  if (!existsSync(builtBinary)) {
    console.error(`[giteam] built binary not found: ${builtBinary}`);
    process.exit(1);
  }

  const outputDir = join(platform.packageDir, 'bin');
  const outputBinary = join(outputDir, platform.binaryFileName);
  mkdirSync(outputDir, { recursive: true });
  copyFileSync(builtBinary, outputBinary);
  chmodSync(outputBinary, 0o755);
  console.log(`[giteam] staged ${platform.packageName} -> ${outputBinary}`);

  if (shouldPack) {
    run('npm', ['pack'], { cwd: platform.packageDir });
  }
}

function run(command, commandArgs, extra = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: extra.cwd || cliRoot,
    stdio: 'inherit',
    env: process.env
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
