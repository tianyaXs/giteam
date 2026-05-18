#!/usr/bin/env node

import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cliRoot } from './platform-manifest.js';

const repoRoot = join(cliRoot, '..', '..');
const sourceDir = join(repoRoot, 'apps', 'desktop', 'dist-web');
const targetDir = join(cliRoot, 'web-assets');

if (!existsSync(join(sourceDir, 'index.html'))) {
  console.error(
    `[giteam] web assets not found at ${sourceDir}. Run: npm --prefix apps/desktop run build:web`
  );
  process.exit(1);
}

rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, { recursive: true });

console.log(`[giteam] synced web assets -> ${targetDir}`);
