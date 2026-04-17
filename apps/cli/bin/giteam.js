#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCurrentPlatformPackage, listPlatforms } from '../scripts/platform-manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);

const run = (command, commandArgs, label = command) => {
  const child = spawn(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on('error', (err) => {
    if (command === 'cargo') {
      console.error(
        `[giteam] failed to start Cargo fallback: ${err.message}\n` +
          'Install Rust/Cargo, or use a supported prebuilt package.'
      );
    } else {
      console.error(`[giteam] failed to start ${label}: ${err.message}`);
    }
    process.exit(1);
  });
};

const commandSource = resolveCommandSource();

if (!commandSource) {
  const supported = listPlatforms()
    .map((item) => item.key)
    .join(', ');
  console.error(
    `[giteam] no runnable binary found for ${process.platform}/${process.arch}.\n` +
      `Checked prebuilt package, local target binaries, and Cargo fallback.\n` +
      `Supported prebuilt targets: ${supported}`
  );
  process.exit(1);
}

run(commandSource.command, commandSource.args, commandSource.label);

function resolveCommandSource() {
  const platformPackage = getCurrentPlatformPackage();
  if (platformPackage) {
    try {
      const packageJsonPath = require.resolve(`${platformPackage.packageName}/package.json`);
      const binaryPath = join(dirname(packageJsonPath), 'bin', platformPackage.binaryFileName);
      if (existsSync(binaryPath)) {
        return {
          command: binaryPath,
          args,
          label: platformPackage.packageName
        };
      }
    } catch {
      // Optional dependency was not installed for this platform.
    }
  }

  const releaseBin = join(root, 'target', 'release', 'giteam');
  if (existsSync(releaseBin)) {
    return { command: releaseBin, args, label: 'local release binary' };
  }

  const debugBin = join(root, 'target', 'debug', 'giteam');
  if (existsSync(debugBin)) {
    return { command: debugBin, args, label: 'local debug binary' };
  }

  const packagedManifest = join(root, 'npm-src', 'apps', 'cli', 'Cargo.toml');
  if (existsSync(packagedManifest)) {
    return {
      command: 'cargo',
      args: ['run', '--manifest-path', packagedManifest, '--', ...args],
      label: 'packaged source fallback'
    };
  }

  const localManifest = join(root, 'Cargo.toml');
  if (existsSync(localManifest)) {
    return {
      command: 'cargo',
      args: ['run', '--manifest-path', localManifest, '--', ...args],
      label: 'local source fallback'
    };
  }

  return null;
}
