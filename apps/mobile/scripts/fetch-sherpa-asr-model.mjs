/**
 * Prepare Sherpa offline SenseVoice ASR model for Android assets.
 *
 * Order:
 * 1. Local vendor/ already has model → sync to android assets
 * 2. Sibling Moirai vendor/assets → copy into vendor + assets
 * 3. Only then download from GitHub (opt-in via --download)
 *
 * Usage:
 *   node scripts/fetch-sherpa-asr-model.mjs
 *   node scripts/fetch-sherpa-asr-model.mjs --download
 *   node scripts/fetch-sherpa-asr-model.mjs --download --bundle   # embed into APK (large)
 */
import { spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { cp, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, '..');
const allowDownload = process.argv.includes('--download');

const DEFAULT_MODEL_ID =
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09';
const modelId = process.env.SHERPA_ASR_MODEL_ID ?? DEFAULT_MODEL_ID;
const archiveName = `${modelId}.tar.bz2`;
const downloadUrl = `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${archiveName}`;
/** GitHub 不通时用 HF 镜像拉 model.int8.onnx + tokens.txt */
const hfRepo =
  process.env.SHERPA_ASR_HF_REPO ??
  (modelId.includes('sense-voice') ? `csukuangfj/${modelId}` : '');
const hfMirrorBase = (
  process.env.SHERPA_ASR_HF_MIRROR ?? 'https://hf-mirror.com'
).replace(/\/$/, '');

const vendorDir = path.join(mobileRoot, 'vendor', 'sherpa-asr-models', modelId);
const cacheDir = path.join(mobileRoot, 'vendor', 'sherpa-asr-cache');
const cacheArchive = path.join(cacheDir, archiveName);
const androidAssetsDir = path.join(
  mobileRoot,
  'android',
  'app',
  'src',
  'main',
  'assets',
  'models',
  modelId
);

const siblingCandidates = [
  path.resolve(mobileRoot, '../../../Moirai/apps/mobile/vendor/sherpa-asr-models', modelId),
  path.resolve(
    mobileRoot,
    '../../../Moirai/apps/mobile/android/app/src/main/assets/models',
    modelId
  ),
  path.resolve(mobileRoot, '../../Moirai/apps/mobile/vendor/sherpa-asr-models', modelId),
  path.resolve(
    mobileRoot,
    '../../Moirai/apps/mobile/android/app/src/main/assets/models',
    modelId
  )
];

async function hasOnnxFiles(dir) {
  if (!existsSync(dir)) return false;
  const entries = await readdir(dir);
  return entries.some((name) => name.endsWith('.onnx'));
}

async function syncDirectory(sourceDir, targetDir) {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(path.dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });
}

async function downloadFile(url, destination) {
  mkdirSync(path.dirname(destination), { recursive: true });
  try {
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('Empty response body');
    await pipeline(response.body, createWriteStream(destination));
    return;
  } catch (fetchError) {
    console.warn(
      `fetch failed (${fetchError instanceof Error ? fetchError.message : fetchError}), trying curl ...`
    );
  }
  const result = spawnSync(
    'curl',
    ['-fL', '--retry', '3', '--retry-delay', '2', '-o', destination, url],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) throw new Error(`Download failed: ${url}`);
}

function extractArchive(archivePath, destinationDir) {
  mkdirSync(destinationDir, { recursive: true });
  const result = spawnSync('tar', ['-xjf', archivePath, '-C', destinationDir], {
    stdio: 'inherit'
  });
  if (result.status !== 0) throw new Error(`tar extraction failed for ${archivePath}`);
}

async function ensureVendorFromSibling() {
  for (const candidate of siblingCandidates) {
    if (!(await hasOnnxFiles(candidate))) continue;
    console.log(`Copying from sibling: ${candidate}`);
    await syncDirectory(candidate, vendorDir);
    return true;
  }
  return false;
}

async function ensureVendorByHfMirror() {
  if (!hfRepo) return false;
  console.log(`Trying HF mirror: ${hfMirrorBase}/${hfRepo}`);
  mkdirSync(vendorDir, { recursive: true });
  for (const fileName of ['tokens.txt', 'model.int8.onnx']) {
    const url = `${hfMirrorBase}/${hfRepo}/resolve/main/${fileName}`;
    const dest = path.join(vendorDir, fileName);
    console.log(`Downloading ${fileName} ...`);
    await downloadFile(url, dest);
  }
  return hasOnnxFiles(vendorDir);
}

async function ensureVendorByDownload() {
  console.log(`Downloading ${archiveName} ...`);
  try {
    if (!existsSync(cacheArchive)) {
      await downloadFile(downloadUrl, cacheArchive);
      const sizeMb = (await stat(cacheArchive)).size / (1024 * 1024);
      console.log(`Saved archive (${sizeMb.toFixed(1)} MB): ${cacheArchive}`);
    } else {
      console.log(`Using cached archive: ${cacheArchive}`);
    }

    const tempExtractDir = path.join(cacheDir, 'extract', modelId);
    rmSync(tempExtractDir, { recursive: true, force: true });
    console.log('Extracting ...');
    extractArchive(cacheArchive, path.dirname(tempExtractDir));

    const extractedDir = path.join(path.dirname(tempExtractDir), modelId);
    if (!(await hasOnnxFiles(extractedDir))) {
      throw new Error(`Extracted model missing .onnx files: ${extractedDir}`);
    }
    await syncDirectory(extractedDir, vendorDir);
    return;
  } catch (error) {
    console.warn(
      `GitHub archive failed (${error instanceof Error ? error.message : error}); falling back to HF mirror ...`
    );
    if (!(await ensureVendorByHfMirror())) {
      throw error;
    }
  }
}

async function main() {
  console.log(`Model: ${modelId}`);

  if (await hasOnnxFiles(vendorDir)) {
    console.log(`Vendor model already present: ${vendorDir}`);
  } else if (await ensureVendorFromSibling()) {
    console.log(`Vendor model ready: ${vendorDir}`);
  } else if (allowDownload) {
    console.log(`Source: ${downloadUrl}`);
    await ensureVendorByDownload();
    console.log(`Vendor model ready: ${vendorDir}`);
  } else {
    console.error(
      [
        'Sherpa ASR model not found locally.',
        `Expected: ${vendorDir}`,
        'Tried sibling Moirai vendor/assets paths.',
        'Copy the model folder there, or re-run with --download.'
      ].join('\n')
    );
    process.exit(1);
  }

  // 默认不打进 APK（设置里按需下载）。仅 --bundle 才同步到 android assets。
  const allowBundle = process.argv.includes('--bundle');
  if (!allowBundle) {
    if (existsSync(androidAssetsDir)) {
      console.log(
        `Skipping Android assets sync (use --bundle to embed). Existing assets left at: ${androidAssetsDir}`
      );
      console.log('Tip: delete android/app/src/main/assets/models to shrink APK.');
    } else {
      console.log('Done. Model is for local/dev only; runtime download happens in Settings.');
    }
    return;
  }

  if (!existsSync(path.join(mobileRoot, 'android', 'app'))) {
    console.warn('android/app not found — run `npx expo prebuild` first, then re-run this script.');
    return;
  }

  console.log(`Syncing to Android assets: ${androidAssetsDir}`);
  await syncDirectory(vendorDir, androidAssetsDir);
  console.log('Done. Rebuild with: npx expo run:android');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
