const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
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
  process.exit(0);
}

const before = 'return requestedPermissions.contains(permission)';
const after = 'return requestedPermissions?.contains(permission) == true';
const source = fs.readFileSync(file, 'utf8');

if (source.includes(after)) {
  process.exit(0);
}

if (!source.includes(before)) {
  console.warn('[patch-expo-modules-core] target line not found, skipping');
  process.exit(0);
}

fs.writeFileSync(file, source.replace(before, after));
console.log('[patch-expo-modules-core] patched PermissionsService.kt');
