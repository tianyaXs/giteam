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
patchMetroWorkletsBundleModeSha();
patchDrawerLayoutSpring();
patchMetroRuntimeWorkletsHmr();
ensureMobileNodeModuleLink('react-native-worklets');

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

function patchMetroWorkletsBundleModeSha() {
  const dependencyGraphFile = path.join(
    rootDir,
    'apps',
    'mobile',
    'node_modules',
    'metro',
    'src',
    'node-haste',
    'DependencyGraph.js'
  );
  if (!fs.existsSync(dependencyGraphFile)) return;
  const source = fs.readFileSync(dependencyGraphFile, 'utf8');
  const guard = 'mixedPath.includes("react-native-worklets/.worklets/")';
  if (source.includes(guard)) return;
  const before = `  async getOrComputeSha1(mixedPath) {
    const result = await this._fileSystem.getOrComputeSha1(mixedPath);`;
  const after = `  async getOrComputeSha1(mixedPath) {
    if (${guard}) {
      const createHash = require("crypto").createHash;
      return {
        sha1: createHash("sha1").update(performance.now().toString()).digest("hex"),
      };
    }
    const result = await this._fileSystem.getOrComputeSha1(mixedPath);`;
  if (!source.includes(before)) {
    console.warn('[patch-metro-worklets] DependencyGraph SHA block not found, skipping');
    return;
  }
  fs.writeFileSync(dependencyGraphFile, source.replace(before, after));
  console.log('[patch-metro-worklets] patched Bundle Mode SHA fallback');
}

function patchDrawerLayoutSpring() {
  const drawerFile = path.join(
    rootDir,
    'apps',
    'mobile',
    'node_modules',
    'react-native-drawer-layout',
    'lib',
    'module',
    'views',
    'Drawer.native.js'
  );
  if (!fs.existsSync(drawerFile)) return;
  const source = fs.readFileSync(drawerFile, 'utf8');
  const before = `      stiffness: 1000,
      damping: 500,
      mass: 3,`;
  const after = `      stiffness: 280,
      damping: 42,
      mass: 1.0,`;
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    console.warn('[patch-drawer-layout] spring config not found, skipping');
    return;
  }
  fs.writeFileSync(drawerFile, source.replace(before, after));
  console.log('[patch-drawer-layout] softened drawer spring animation');
}

function patchMetroRuntimeWorkletsHmr() {
  const hmrClientFile = path.join(
    rootDir,
    'apps',
    'mobile',
    'node_modules',
    'metro-runtime',
    'src',
    'modules',
    'HMRClient.js'
  );
  if (!fs.existsSync(hmrClientFile)) return;
  const source = fs.readFileSync(hmrClientFile, 'utf8');
  const guard = 'global.__workletsModuleProxy?.propagateModuleUpdate';
  if (source.includes(guard)) return;
  const before = `const EventEmitter = require("./vendor/eventemitter3");
const HEARTBEAT_INTERVAL_MS = 20_000;
const inject = ({ module: [id, code], sourceURL }) => {`;
  const after = `const EventEmitter = require("./vendor/eventemitter3");
const HEARTBEAT_INTERVAL_MS = 20_000;
const inject = ({ module: [id, code], sourceURL }) => {
  if (${guard}) {
    global.__workletsModuleProxy.propagateModuleUpdate(code, sourceURL);
  }`;
  if (!source.includes(before)) {
    console.warn('[patch-metro-runtime] HMR inject block not found, skipping');
    return;
  }
  fs.writeFileSync(hmrClientFile, source.replace(before, after));
  console.log('[patch-metro-runtime] patched worklets HMR propagation');
}

function ensureMobileNodeModuleLink(packageName) {
  const sourceDir = path.join(rootDir, 'node_modules', packageName);
  const mobileNodeModulesDir = path.join(rootDir, 'apps', 'mobile', 'node_modules');
  const targetDir = path.join(mobileNodeModulesDir, packageName);
  if (!fs.existsSync(sourceDir) || !fs.existsSync(mobileNodeModulesDir)) return;
  try {
    if (fs.existsSync(targetDir)) {
      const stat = fs.lstatSync(targetDir);
      if (stat.isSymbolicLink()) {
        const current = fs.realpathSync(targetDir);
        const expected = fs.realpathSync(sourceDir);
        if (current === expected) return;
      } else {
        return;
      }
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    fs.symlinkSync(sourceDir, targetDir, 'dir');
    console.log(`[patch-mobile-node-modules] linked ${packageName} into apps/mobile/node_modules`);
  } catch (error) {
    console.warn(`[patch-mobile-node-modules] failed to link ${packageName}`, error);
  }
}
