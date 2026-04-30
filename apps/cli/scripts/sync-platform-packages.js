#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bugsUrl, cliRoot, homepageUrl, listPlatforms, packageAuthor, packageKeywords, repositoryUrl } from './platform-manifest.js';

const rootPackagePath = join(cliRoot, 'package.json');
const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
const version = rootPackage.version;
rootPackage.optionalDependencies = Object.fromEntries(
  listPlatforms().map((platform) => [platform.packageName, version])
);
delete rootPackage.dependencies;
writeFileSync(rootPackagePath, `${JSON.stringify(rootPackage, null, 2)}\n`);

for (const platform of listPlatforms()) {
  mkdirSync(join(platform.packageDir, 'bin'), { recursive: true });
  const packageJson = {
    name: platform.packageName,
    version,
    description: `Prebuilt ${platform.os}/${platform.cpu} binary for giteam`,
    author: packageAuthor,
    type: 'module',
    repository: {
      type: 'git',
      url: repositoryUrl
    },
    homepage: homepageUrl,
    bugs: {
      url: bugsUrl
    },
    keywords: packageKeywords,
    publishConfig: {
      access: 'public'
    },
    os: [platform.os],
    cpu: [platform.cpu],
    files: ['bin/giteam', 'README.md', 'package.json']
  };
  writeFileSync(join(platform.packageDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(
    join(platform.packageDir, 'README.md'),
    `# ${platform.packageName}\n\nPrebuilt binary package for \`giteam\` on \`${platform.os}/${platform.cpu}\`.\n`
  );
}

console.log(`[giteam] synced ${listPlatforms().length} platform package manifests to version ${version}`);
