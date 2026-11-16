//! 根因探针：用 giteam 同款 pi HTTP 栈（asupersync transport）连续跑两轮 SSE
//! 请求，复现「第一轮带图完成后第二轮挂死」。
//!
//! 用法：
//! cargo run --example pi_stream_hang_probe -- \
//!   --url http://192.168.50.77:3921/v1/chat/completions \
//!   --key-file /tmp/giteam-rootcause/.key \
//!   --payload /tmp/giteam-rootcause/req_small.json \
//!   --payload /tmp/giteam-rootcause/req_with_image.json

use std::time::Instant;

use futures::StreamExt;
use pi::http::client::Client;

fn main() {
    let mut args = std::env::args().skip(1);
    let mut url = String::new();
    let mut key_file = String::new();
    let mut payloads: Vec<String> = Vec::new();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--url" => url = args.next().unwrap_or_default(),
            "--key-file" => key_file = args.next().unwrap_or_default(),
            "--payload" => payloads.push(args.next().unwrap_or_default()),
            other => {
                eprintln!("未知参数 {other}");
                std::process::exit(2);
            }
        }
    }
    if url.is_empty() || key_file.is_empty() || payloads.is_empty() {
        eprintln!("需要 --url --key-file --payload（可多次）");
        std::process::exit(2);
    }
    let key = std::fs::read_to_string(&key_file)
        .expect("read key file")
        .trim()
        .to_string();

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    runtime.block_on(async move {
        let client = Client::new();
        for (round, path) in payloads.iter().enumerate() {
            let body = std::fs::read(path).expect("read payload");
            println!(
                "[round {round}] POST {} body={} bytes",
                url,
                body.len()
            );
            let started = Instant::now();
            let request = client
                .post(&url)
                .header("Content-Type", "application/json")
                .header("Accept", "text/event-stream")
                .header("Authorization", format!("Bearer {key}"))
                .body(body);
            let response = match request.send().await {
                Ok(response) => response,
                Err(error) => {
                    println!("[round {round}] SEND FAILED after {:.2}s: {error}", started.elapsed().as_secs_f64());
                    return;
                }
            };
            println!(
                "[round {round}] status={} headers-in={:.2}s",
                response.status(),
                started.elapsed().as_secs_f64()
            );
            let mut stream = response.bytes_stream();
            let mut total = 0usize;
            let mut chunks = 0usize;
            let mut first_token_at: Option<f64> = None;
            let mut done = false;
            while let Some(item) = stream.next().await {
                match item {
                    Ok(bytes) => {
                        if first_token_at.is_none() {
                            first_token_at = Some(started.elapsed().as_secs_f64());
                        }
                        total += bytes.len();
                        chunks += 1;
                        if std::str::from_utf8(&bytes).map(|s| s.contains("[DONE]")).unwrap_or(false) {
                            done = true;
                        }
                    }
                    Err(error) => {
                        println!(
                            "[round {round}] STREAM ERROR after {:.2}s (chunks={chunks} bytes={total}): {error}",
                            started.elapsed().as_secs_f64()
                        );
                        break;
                    }
                }
            }
            println!(
                "[round {round}] DONE done-marker={done} chunks={chunks} bytes={total} total={:.2}s first-byte={first_token_at:?}",
                started.elapsed().as_secs_f64()
            );
        }
    });
}
