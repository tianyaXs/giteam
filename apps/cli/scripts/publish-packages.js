#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cliRoot, listPlatforms } from './platform-manifest.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipBuild = args.includes('--skip-build');
const noRoot = args.includes('--no-root');
const rootOnly = args.includes('--root-only');
const skipMissingTargets = args.includes('--skip-missing-targets');
const npmTagIndex = args.indexOf('--tag');
const npmTag = npmTagIndex >= 0 ? args[npmTagIndex + 1] : null;
const otpIndex = args.indexOf('--otp');
const otp = otpIndex >= 0 ? args[otpIndex + 1] : null;
const platformArgValues = collectArgs('--platform');

const rootPackage = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const version = rootPackage.version;
const allPlatforms = listPlatforms();
const selectedPlatforms = platformArgValues.length
  ? allPlatforms.filter((platform) => platformArgValues.includes(platform.key))
  : allPlatforms;

if (rootOnly && platformArgValues.length > 0) {
  console.error('[giteam] --root-only cannot be combined with --platform');
  process.exit(1);
}

run('node', ['./scripts/sync-rust-sources.js']);
run('node', ['./scripts/sync-platform-packages.js']);

if (!rootOnly && !skipBuild) {
  const buildablePlatforms = [];
  for (const platform of selectedPlatforms) {
    if (!hasRustTarget(platform.rustTarget)) {
      const hint = `rustup target add ${platform.rustTarget}`;
      if (skipMissingTargets) {
        console.warn(
          `[giteam] skip build/publish for ${platform.key}: rust target not installed (${platform.rustTarget}). Install with: ${hint}`
        );
        continue;
      }
      console.error(
        `[giteam] rust target not installed for ${platform.key}: ${platform.rustTarget}\n` +
          `[giteam] install it with: ${hint}\n` +
          `[giteam] or publish only selected platforms, e.g.:\n` +
          `  npm run publish:check -- --dry-run --platform darwin-arm64 --no-root\n` +
          `[giteam] or opt-in skipping missing targets:\n` +
          `  npm run publish:npm -- --skip-missing-targets`
      );
      process.exit(1);
    }
    buildablePlatforms.push(platform);
  }

  for (const platform of buildablePlatforms) {
    run('node', ['./scripts/build-platform-package.js', '--platform', platform.key]);
  }
}

if (!rootOnly) {
  for (const platform of selectedPlatforms) {
    if (skipMissingTargets && !hasRustTarget(platform.rustTarget)) {
      continue;
    }
    const binaryPath = join(platform.packageDir, 'bin', platform.binaryFileName);
    if (!existsSync(binaryPath)) {
      console.error(`[giteam] missing prebuilt binary for ${platform.key}: ${binaryPath}`);
      process.exit(1);
    }
  }
}

if (!rootOnly) {
  for (const platform of selectedPlatforms) {
    if (skipMissingTargets && !hasRustTarget(platform.rustTarget)) {
      continue;
    }
    publishPackage(platform.packageDir, platform.packageName);
  }
}
if (!noRoot) {
  publishPackage(cliRoot, rootPackage.name);
}

console.log(
  `[giteam] ${dryRun ? 'dry-run verified' : 'published'} npm release for version ${version}`
);

function publishPackage(packageDir, packageName) {
  const publishArgs = ['publish'];
  if (dryRun) {
    publishArgs.push('--dry-run');
  }
  if (npmTag) {
    publishArgs.push('--tag', npmTag);
  }
  if (otp) {
    publishArgs.push('--otp', otp);
  }

  console.log(`[giteam] ${dryRun ? 'checking' : 'publishing'} ${packageName}`);
  run('npm', publishArgs, { cwd: packageDir });
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

function collectArgs(flag) {
  const values = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === flag && args[i + 1]) {
      values.push(args[i + 1]);
      i += 1;
    }
  }
  return values;
}

function hasRustTarget(targetTriple) {
  const t = String(targetTriple || '').trim();
  if (!t) return false;
  const res = spawnSync('rustup', ['target', 'list', '--installed'], {
    cwd: cliRoot,
    encoding: 'utf8'
  });
  if (res.status !== 0 || typeof res.stdout !== 'string') {
    // If rustup isn't available, fall back to "unknown" and let cargo fail loudly.
    return false;
  }
  const installed = new Set(
    res.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
  return installed.has(t);
}
