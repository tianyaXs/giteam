#!/usr/bin/env node

import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cliRoot } from './platform-manifest.js';

const repoRoot = join(cliRoot, '..', '..');
const outputRoot = join(cliRoot, 'npm-src');

rmSync(outputRoot, { recursive: true, force: true });

mkdirSync(join(outputRoot, 'apps', 'cli'), { recursive: true });
mkdirSync(join(outputRoot, 'crates', 'giteam-core'), { recursive: true });

cpSync(join(cliRoot, 'Cargo.toml'), join(outputRoot, 'apps', 'cli', 'Cargo.toml'));
cpSync(join(cliRoot, 'src'), join(outputRoot, 'apps', 'cli', 'src'), { recursive: true });
cpSync(
  join(repoRoot, 'crates', 'giteam-core', 'Cargo.toml'),
  join(outputRoot, 'crates', 'giteam-core', 'Cargo.toml')
);
cpSync(
  join(repoRoot, 'crates', 'giteam-core', 'src'),
  join(outputRoot, 'crates', 'giteam-core', 'src'),
  { recursive: true }
);

console.log(`[giteam] synced Rust fallback sources -> ${outputRoot}`);
