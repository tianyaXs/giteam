//! `tar.zst` 打包 / 解包 + sha256。

use super::{ShareError, ShareResult};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufReader, BufWriter, Read};
use std::path::Path;

/// 把 `staging_dir` 的全部内容（含顶层条目本身）打成 `tar.zst`。
pub fn pack_dir(staging_dir: &Path, out_file: &Path) -> ShareResult<()> {
    let file = fs::File::create(out_file)?;
    let writer = BufWriter::new(file);
    let encoder = zstd::stream::write::Encoder::new(writer, 3)
        .map_err(|e| ShareError::Package(format!("zstd encoder: {e}")))?;
    let mut builder = tar::Builder::new(encoder);
    let mut entries: Vec<_> = fs::read_dir(staging_dir)?
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .collect();
    entries.sort();
    for path in entries {
        let name = path
            .file_name()
            .ok_or_else(|| ShareError::Package("bad staging entry name".into()))?;
        if path.is_dir() {
            builder
                .append_dir_all(name, &path)
                .map_err(|e| ShareError::Package(format!("tar append {}: {e}", path.display())))?;
        } else {
            builder
                .append_path_with_name(&path, name)
                .map_err(|e| ShareError::Package(format!("tar append {}: {e}", path.display())))?;
        }
    }
    let encoder = builder
        .into_inner()
        .map_err(|e| ShareError::Package(format!("tar finish: {e}")))?;
    encoder
        .finish()
        .map_err(|e| ShareError::Package(format!("zstd finish: {e}")))?;
    Ok(())
}

/// 解包 `tar.zst` 到 `dest_dir`（`unpack_in` 防路径穿越）。
pub fn unpack_archive(archive: &Path, dest_dir: &Path) -> ShareResult<()> {
    let file = fs::File::open(archive)?;
    let decoder = zstd::stream::read::Decoder::new(BufReader::new(file))
        .map_err(|e| ShareError::Package(format!("zstd decoder: {e}")))?;
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|e| ShareError::Package(format!("tar entries: {e}")))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| ShareError::Package(format!("tar entry: {e}")))?;
        let ok = entry
            .unpack_in(dest_dir)
            .map_err(|e| ShareError::Package(format!("tar unpack: {e}")))?;
        if !ok {
            return Err(ShareError::Package(
                "tar entry escapes destination (path traversal refused)".into(),
            ));
        }
    }
    Ok(())
}

pub fn sha256_file(path: &Path) -> ShareResult<String> {
    let file = fs::File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let read = reader.read(&mut buf)?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}
