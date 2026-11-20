//! pi 内核 future 的执行桥。
//!
//! # 默认：独占 tokio（`pi-agent-rt`）
//! 历史实证（见 `examples/pi_stream_hang_probe.rs`）：把 pi/asupersync future
//! 直接嵌进 Tauri 共享 tokio 会 `fallback_rewake` 热忙等并挤饿 UI。独占
//! 2-worker tokio 已在生产路径验证。
//!
//! # 可选：asupersync Runtime（`GITEAM_PI_RUNTIME=asupersync`）
//! 对齐 `examples/basic_sdk.rs`。在 macOS 上与宿主 tokio 并存时曾出现
//! `tokio-rt-worker` **stack overflow**（Runtime/reactor 初始化或跨 runtime
//! 交互），故不作为默认；需真机明确验证后再考虑切换。
//!
//! # 模式（`GITEAM_PI_RUNTIME`）
//! - 未设置 / `tokio`（默认）：独占 2-worker tokio。
//! - `asupersync`：独立 asupersync multi-thread + reactor（实验）。
//! - `host`：当前 executor 直跑（A/B，易挂死，仅诊断）。

use std::future::Future;
use std::sync::OnceLock;

/// 解析执行模式；非法值回落默认 tokio。
fn runtime_mode() -> RuntimeMode {
    match std::env::var("GITEAM_PI_RUNTIME")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "host" => RuntimeMode::Host,
        "asupersync" => RuntimeMode::Asupersync,
        "" | "tokio" | "default" => RuntimeMode::Tokio,
        other => {
            eprintln!("[pi-agent] unknown GITEAM_PI_RUNTIME={other:?}, using tokio");
            RuntimeMode::Tokio
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RuntimeMode {
    Asupersync,
    Host,
    Tokio,
}

fn asupersync_runtime() -> &'static asupersync::runtime::Runtime {
    static RUNTIME: OnceLock<asupersync::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        // 不在 tokio worker 上同步 build：asupersync Runtime+reactor 初始化栈很深，
        // 曾导致宿主 `tokio-rt-worker` stack overflow。放到独立 OS 线程完成。
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("pi-asupersync-init".into())
            .stack_size(16 * 1024 * 1024)
            .spawn(move || {
                let result = (|| {
                    let reactor = asupersync::runtime::reactor::create_reactor()
                        .map_err(|error| error.to_string())?;
                    asupersync::runtime::RuntimeBuilder::multi_thread()
                        .worker_threads(2)
                        .with_reactor(reactor)
                        .build()
                        .map_err(|error| error.to_string())
                })();
                let _ = tx.send(result);
            })
            .expect("spawn pi asupersync init thread")
            .join()
            .expect("pi asupersync init thread join");
        rx.recv()
            .expect("pi asupersync init channel")
            .expect("pi asupersync runtime init")
    })
}

fn tokio_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("pi-agent-rt")
            // 略增栈：pi/asupersync future 状态机帧偏大，默认栈在嵌套 poll 时曾溢出。
            .thread_stack_size(8 * 1024 * 1024)
            .enable_all()
            .build()
            .expect("pi tokio runtime init")
    })
}

/// 在选定的 pi runtime 上执行 future，当前任务等待其完成。
///
/// pi 内核的 async 调用（create_agent_session / prompt 流式 / messages / …）
/// 默认经独占 tokio 桥接。panic 原样在调用方恢复。
pub async fn run<F, R>(future: F) -> R
where
    F: Future<Output = R> + Send + 'static,
    R: Send + 'static,
{
    match runtime_mode() {
        RuntimeMode::Host => future.await,
        RuntimeMode::Tokio => match tokio_runtime().spawn(future).await {
            Ok(result) => result,
            Err(join_error) if join_error.is_panic() => {
                std::panic::resume_unwind(join_error.into_panic())
            }
            Err(join_error) => panic!("pi tokio runtime task cancelled unexpectedly: {join_error}"),
        },
        RuntimeMode::Asupersync => {
            let (tx, rx) = tokio::sync::oneshot::channel();
            // spawn 本身也可能触碰宿主 TLS；放到 blocking 线程调用 spawn API。
            let handle = asupersync_runtime().handle();
            let _join = tokio::task::spawn_blocking(move || {
                handle.spawn(async move {
                    let _ = tx.send(future.await);
                })
            })
            .await
            .expect("pi asupersync spawn_blocking join");
            match rx.await {
                Ok(result) => result,
                Err(_) => panic!("pi asupersync runtime task dropped result channel"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_executes_and_returns_value() {
        std::env::set_var("GITEAM_PI_RUNTIME", "tokio");
        let value = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("caller runtime")
            .block_on(async { run(async { 21 * 2 }).await });
        std::env::remove_var("GITEAM_PI_RUNTIME");
        assert_eq!(value, 42);
    }

    #[test]
    fn run_propagates_panic_from_task() {
        std::env::set_var("GITEAM_PI_RUNTIME", "host");
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("caller runtime");
        let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            runtime.block_on(async {
                run(async {
                    panic!("pi task boom");
                })
                .await
            });
        }));
        std::env::remove_var("GITEAM_PI_RUNTIME");
        assert!(caught.is_err(), "panic inside pi task must propagate");
    }

    #[test]
    fn runtime_mode_defaults_to_tokio() {
        std::env::remove_var("GITEAM_PI_RUNTIME");
        assert_eq!(runtime_mode(), RuntimeMode::Tokio);
        std::env::set_var("GITEAM_PI_RUNTIME", "asupersync");
        assert_eq!(runtime_mode(), RuntimeMode::Asupersync);
        std::env::set_var("GITEAM_PI_RUNTIME", "host");
        assert_eq!(runtime_mode(), RuntimeMode::Host);
        std::env::remove_var("GITEAM_PI_RUNTIME");
    }
}
