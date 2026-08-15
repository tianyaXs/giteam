#!/usr/bin/env node
/**
 * Moirai-era sherpa patches used to ship empty jniLibs/*.so placeholders.
 * Those satisfy exists() and skip prebuilt download, then CMake fails to link.
 * Delete 0-byte .so so Gradle re-downloads real prebuilts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jniRoot = path.join(
  root,
  'node_modules/react-native-sherpa-onnx/android/src/main/jniLibs',
);

if (!fs.existsSync(jniRoot)) {
  process.exit(0);
}

let removed = 0;
for (const abi of fs.readdirSync(jniRoot)) {
  const abiDir = path.join(jniRoot, abi);
  if (!fs.statSync(abiDir).isDirectory()) continue;
  for (const name of fs.readdirSync(abiDir)) {
    if (!name.endsWith('.so')) continue;
    const file = path.join(abiDir, name);
    const st = fs.statSync(file);
    if (st.size === 0) {
      fs.unlinkSync(file);
      removed += 1;
    }
  }
}

if (removed > 0) {
  console.log(`[sherpa] removed ${removed} empty jniLibs/*.so stub(s); Gradle will re-download prebuilts`);
}
