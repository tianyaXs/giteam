use rand::RngCore;
use sha2::{Digest, Sha256};

pub fn new_id(prefix: &str) -> String {
    format!("{}_{}", prefix, hex::encode(random_bytes(16)))
}

pub fn new_secret(prefix: &str, nbytes: usize) -> String {
    format!("{}_{}", prefix, hex::encode(random_bytes(nbytes)))
}

pub fn random_bytes(n: usize) -> Vec<u8> {
    let mut buf = vec![0u8; n];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

pub fn hash_secret(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn access_key_id(access_key: &str) -> String {
    // public-ish id prefix for lookup without storing plaintext
    let digest = hash_secret(access_key);
    format!("aki_{}", &digest[..16])
}
