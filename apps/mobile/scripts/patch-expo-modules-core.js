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
