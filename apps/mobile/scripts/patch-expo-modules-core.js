const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', '..', '..');
const gradlePluginFile = path.join(
  rootDir,
  'node_modules',
  'expo-modules-core',
  'expo-module-gradle-plugin',
  'build.gradle.kts'
);

const kotlinVersion = '2.1.0';

patchMetroExports();
patchMetroCacheExports();
patchExpoCliMetroTerminal();

if (fs.existsSync(gradlePluginFile)) {
  const source = fs.readFileSync(gradlePluginFile, 'utf8');
  const newSource = source.replace(/kotlin\("jvm"\) version "[\d.]+"/, `kotlin("jvm") version "${kotlinVersion}"`);
  if (newSource !== source) {
    fs.writeFileSync(gradlePluginFile, newSource);
    console.log(`[patch-expo-modules-core] patched Kotlin version to ${kotlinVersion} in expo-module-gradle-plugin`);
  }
}

const file = path.join(
  rootDir,
  'node_modules',
  'expo-modules-core',
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'adapters',
  'react',
  'permissions',
  'PermissionsService.kt'
);

if (!fs.existsSync(file)) {
  patchReactNativeMarked();
  process.exit(0);
}

const before = 'return requestedPermissions.contains(permission)';
const after = 'return requestedPermissions?.contains(permission) == true';
const source = fs.readFileSync(file, 'utf8');

if (source.includes(after)) {
  patchReactNativeMarked();
  process.exit(0);
}

if (!source.includes(before)) {
  console.warn('[patch-expo-modules-core] target line not found, skipping');
  patchReactNativeMarked();
  process.exit(0);
}

fs.writeFileSync(file, source.replace(before, after));
console.log('[patch-expo-modules-core] patched PermissionsService.kt');
patchReactNativeMarked();

function patchReactNativeMarked() {
  const parserFile = path.join(
    rootDir,
    'node_modules',
    'react-native-marked',
    'src',
    'lib',
    'Parser.tsx'
  );
  if (!fs.existsSync(parserFile)) return;
  const parserSource = fs.readFileSync(parserFile, 'utf8');
  const parserBefore = `\t\t\t\t\tthis.styles.code,\n\t\t\t\t\tthis.styles.em,`;
  const parserAfter = `\t\t\t\t\tthis.styles.code,\n\t\t\t\t\tthis.styles.codespan,`;
  if (parserSource.includes(parserAfter)) return;
  if (!parserSource.includes(parserBefore)) {
    console.warn('[patch-react-native-marked] target line not found, skipping');
    return;
  }
  fs.writeFileSync(parserFile, parserSource.replace(parserBefore, parserAfter));
  console.log('[patch-react-native-marked] patched code block text style');
}

function patchMetroExports() {
  const metroPackageFile = path.join(rootDir, 'node_modules', 'metro', 'package.json');
  if (!fs.existsSync(metroPackageFile)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(metroPackageFile, 'utf8'));
    const exportsMap = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : null;
    if (!exportsMap) return;
    if (exportsMap['./src/lib/TerminalReporter']) return;
    exportsMap['./src/lib/TerminalReporter'] = './src/lib/TerminalReporter.js';
    fs.writeFileSync(metroPackageFile, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log('[patch-metro] exported metro/src/lib/TerminalReporter');
  } catch (error) {
    console.warn('[patch-metro] failed to patch metro exports', error);
  }
}

function patchMetroCacheExports() {
  const metroCachePackageFile = path.join(rootDir, 'node_modules', 'metro-cache', 'package.json');
  if (!fs.existsSync(metroCachePackageFile)) return;
  try {
    const pkg = JSON.parse(fs.readFileSync(metroCachePackageFile, 'utf8'));
    const exportsMap = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports : null;
    if (!exportsMap) return;
    if (exportsMap['./src/stores/FileStore']) return;
    exportsMap['./src/stores/FileStore'] = './src/stores/FileStore.js';
    fs.writeFileSync(metroCachePackageFile, `${JSON.stringify(pkg, null, 2)}\n`);
    console.log('[patch-metro-cache] exported metro-cache/src/stores/FileStore');
  } catch (error) {
    console.warn('[patch-metro-cache] failed to patch metro-cache exports', error);
  }
}

function patchExpoCliMetroTerminal() {
  const expoCliMetroFile = path.join(
    rootDir,
    'apps',
    'mobile',
    'node_modules',
    '@expo',
    'cli',
    'build',
    'src',
    'start',
    'server',
    'metro',
    'instantiateMetro.js'
  );
  if (!fs.existsSync(expoCliMetroFile)) return;
  const before = `        const sendLog = (...args)=>{\n            this._logLines.push(// format args like console.log\n            _nodeUtil().default.format(...args));\n            this._scheduleUpdate();\n            // Flush the logs to the terminal immediately so logs at the end of the process are not lost.\n            this.flush();\n        };`;
  const after = `        const sendLog = (...args)=>{\n            _metroCore().Terminal.prototype.log.call(this, ...args);\n            // Flush the logs to the terminal immediately so logs at the end of the process are not lost.\n            this.flush();\n        };`;
  const source = fs.readFileSync(expoCliMetroFile, 'utf8');
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    console.warn('[patch-expo-cli] instantiateMetro sendLog block not found, skipping');
    return;
  }
  fs.writeFileSync(expoCliMetroFile, source.replace(before, after));
  console.log('[patch-expo-cli] patched Metro terminal logger');
}
