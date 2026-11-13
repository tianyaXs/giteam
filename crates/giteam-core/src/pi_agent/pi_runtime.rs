//! pi 专用 tokio runtime：隔离 pi 内核 future 的执行环境（治本「请求挂死」）。
//!
//! 根因（2026-11-10 五层排除实证，见 examples/pi_stream_hang_probe.rs）：pi 的
//! async IO 走 asupersync。宿主把 pi future 嵌进 tauri 的共享 tokio runtime 时，
//! asupersync 检测不到自己的任务上下文（Cx），TcpStream 的 readiness 等待退化
//! 为 `fallback_rewake` 立即自唤醒热忙等（asupersync fork@82e7e6f stream.rs）；
//! 共享 runtime 高负载时该热忙等任务被 tokio 协作调度反复让位，进度趋零——
//! 表现为请求「时好时坏」地挂死数分钟。pi CLI 自己跑在 asupersync Runtime 上
//! 所以稳定；本模块给 pi 的 future 一个独占的小 runtime，热忙等只消耗自己的
//! worker，不再与宿主任务（tunnel 轮询、UI 事件、文件扫描）互相挤饿。
//!
//! 跨 runtime 桥接安全性：asupersync TcpStream 的 poll 走 task-local Cx，不依赖
//! tokio reactor，pi future 在任意 tokio runtime 上行为一致；service 侧的
//! `futures::lock::Mutex`、broadcast channel、同步回调均 runtime 无关。

use std::future::Future;
use std::sync::OnceLock;

use tokio::runtime::Runtime;

/// pi 专用 runtime，进程级单例。两个 worker：一个可能被 asupersync 的
/// fallback 热忙等占住，另一个照常推进其余 pi 任务；与宿主 runtime 完全隔离。
static PI_RUNTIME: OnceLock<Runtime> = OnceLock::new();

fn runtime() -> &'static Runtime {
    PI_RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("pi-agent-rt")
            .enable_all()
            .build()
            .expect("pi agent runtime init")
    })
}

/// 在 pi 专用 runtime 上执行 future，当前任务等待其完成。
///
/// pi 内核的 async 调用（create_agent_session / prompt 流式 / messages / …）
/// 一律经此桥接，不得直接在宿主 runtime 上 poll。panic 原样在调用方恢复，
/// 语义与直接 await 一致。
pub async fn run<F, R>(future: F) -> R
where
    F: Future<Output = R> + Send + 'static,
    R: Send + 'static,
{
    match runtime().spawn(future).await {
        Ok(result) => result,
        Err(join_error) if join_error.is_panic() => {
            std::panic::resume_unwind(join_error.into_panic())
        }
        Err(join_error) => panic!("pi runtime task cancelled unexpectedly: {join_error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_executes_and_returns_value() {
        let value = tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("caller runtime")
            .block_on(async { run(async { 21 * 2 }).await });
        assert_eq!(value, 42);
    }

    #[test]
    fn run_propagates_panic_from_task() {
        let result = std::panic::catch_unwind(tokio::runtime::Builder::new_current_thread);
        // caller runtime 自身构建不应失败；panic 传播在下方 block_on 内验证。
        assert!(result.is_ok());
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
        assert!(caught.is_err(), "panic inside pi task must propagate");
    }
}
