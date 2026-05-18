#!/usr/bin/env node

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { cliRoot, listPlatforms } from './platform-manifest.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipBuild = args.includes('--skip-build');
const noRoot = args.includes('--no-root');
const rootOnly = args.includes('--root-only');
const skipMissingTargets = args.includes('--skip-missing-targets');
const noAutoBump = args.includes('--no-auto-bump');
const npmTagIndex = args.indexOf('--tag');
const npmTag = npmTagIndex >= 0 ? args[npmTagIndex + 1] : null;
const otpIndex = args.indexOf('--otp');
const otp = otpIndex >= 0 ? args[otpIndex + 1] : null;
const platformArgValues = collectArgs('--platform');

const allPlatforms = listPlatforms();
const selectedPlatforms = platformArgValues.length
  ? allPlatforms.filter((platform) => platformArgValues.includes(platform.key))
  : allPlatforms;

if (rootOnly && platformArgValues.length > 0) {
  console.error('[giteam] --root-only cannot be combined with --platform');
  process.exit(1);
}

const releaseStatePath = join(cliRoot, '.publish-release.json');
const originalVersion = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8')).version;
let shouldRestoreDryRunVersion = false;
if (dryRun && !noAutoBump) {
  process.on('exit', () => {
    if (!shouldRestoreDryRunVersion) return;
    syncVersionFiles(originalVersion);
    spawnSync('node', ['./scripts/sync-platform-packages.js'], { cwd: cliRoot, stdio: 'ignore', env: process.env });
    spawnSync('node', ['./scripts/sync-rust-sources.js'], { cwd: cliRoot, stdio: 'ignore', env: process.env });
  });
}
const version = prepareReleaseVersion();
const rootPackage = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));

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
  if (!dryRun && existsSync(releaseStatePath)) {
    rmSync(releaseStatePath, { force: true });
  }
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

function prepareReleaseVersion() {
  const rootPackagePath = join(cliRoot, 'package.json');
  const currentRootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
  if (noAutoBump) {
    return currentRootPackage.version;
  }

  const state = readReleaseState();
  const nextVersion = state?.version || bumpPatchVersion(currentRootPackage.version);
  if (!state?.version) {
    if (!dryRun) {
      writeReleaseState({ version: nextVersion, baseVersion: currentRootPackage.version, startedAt: new Date().toISOString() });
    } else {
      shouldRestoreDryRunVersion = true;
    }
    console.log(`[giteam] release version ${dryRun ? 'preview ' : 'bumped '}${currentRootPackage.version} -> ${nextVersion}`);
  } else {
    if (dryRun) shouldRestoreDryRunVersion = true;
    console.log(`[giteam] using in-progress release version ${nextVersion}`);
  }

  syncVersionFiles(nextVersion);
  return nextVersion;
}

function syncVersionFiles(nextVersion) {
  const rootPackagePath = join(cliRoot, 'package.json');
  const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
  rootPackage.version = nextVersion;
  rootPackage.optionalDependencies = Object.fromEntries(
    listPlatforms().map((platform) => [platform.packageName, nextVersion])
  );
  writeJson(rootPackagePath, rootPackage);

  replaceFile(join(cliRoot, 'Cargo.toml'), /version = "[^"]+"/, `version = "${nextVersion}"`);
  const cargoLockPath = join(cliRoot, 'Cargo.lock');
  if (existsSync(cargoLockPath)) {
    replaceFirstPackageVersion(cargoLockPath, 'giteam-cli', nextVersion);
  }

  const repoRoot = join(cliRoot, '..', '..');
  const rootLockPath = join(repoRoot, 'package-lock.json');
  if (existsSync(rootLockPath)) {
    syncPackageLockCliVersion(rootLockPath, nextVersion);
  }
}

function bumpPatchVersion(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    console.error(`[giteam] cannot auto-bump invalid semver: ${version}`);
    process.exit(1);
  }
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}${match[4] || ''}`;
}

function readReleaseState() {
  if (!existsSync(releaseStatePath)) return null;
  try {
    return JSON.parse(readFileSync(releaseStatePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeReleaseState(state) {
  writeJson(releaseStatePath, state);
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceFile(path, pattern, replacement) {
  const raw = readFileSync(path, 'utf8');
  const next = raw.replace(pattern, replacement);
  if (next !== raw) writeFileSync(path, next);
}

function replaceFirstPackageVersion(lockPath, packageName, nextVersion) {
  const raw = readFileSync(lockPath, 'utf8');
  const pattern = new RegExp(`(name = "${escapeRegExp(packageName)}"\\nversion = ")[^"]+(" )?`, 'm');
  let next = raw.replace(pattern, `$1${nextVersion}$2`);
  if (next === raw) {
    next = raw.replace(new RegExp(`(name = "${escapeRegExp(packageName)}"\\nversion = ")[^"]+(")`, 'm'), `$1${nextVersion}$2`);
  }
  if (next !== raw) writeFileSync(lockPath, next);
}

function syncPackageLockCliVersion(lockPath, nextVersion) {
  let raw = readFileSync(lockPath, 'utf8');
  raw = raw.replace(/("apps\/cli": \{\n\s+"name": "giteam",\n\s+"version": ")[^"]+(")/, `$1${nextVersion}$2`);
  const platformDeps = listPlatforms()
    .map((platform, index, platforms) => {
      const suffix = index === platforms.length - 1 ? '' : ',';
      return `        "${platform.packageName}": "${nextVersion}"${suffix}`;
    })
    .join('\n');
  raw = raw.replace(
    /("apps\/cli": \{[\s\S]*?"optionalDependencies": \{\n)([\s\S]*?)(\s+\}\n\s+\})/,
    `$1${platformDeps}\n$3`
  );
  writeFileSync(lockPath, raw);
}

function escapeRegExp(input) {
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
