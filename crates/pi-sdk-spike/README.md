# Pi SDK 进程内集成 Spike

该 crate 仅用于验证 Giteam 嵌入 `pi::sdk` 的构建、事件、工具、取消和退出行为，不属于产品运行时。

## 约束

- Pi 精确锁定为上游 commit `b27abd576cc0d2f39e2eef8f87f7897edec53b4f`（版本号 `0.1.22`）。
- crates.io 发布包 `0.1.22` 在嵌入构建时会触发 `Future + Send` 编译错误，而同版本上游仓库源码在其锁定工具链下可构建；因此 Spike 使用已审计 commit，而不是只锁版本号。
- 不依赖 OpenCode，不提供 RPC 产品回退。
- 默认只做二进制启动检查，不访问模型网络。
- 设置 `PI_SPIKE_RUN=1` 后才创建真实 Pi session 并发送 Prompt。

## 构建

```bash
RUSTUP_TOOLCHAIN=nightly-2026-07-05 \
cargo check --manifest-path crates/pi-sdk-spike/Cargo.toml
```

## 运行真实 Prompt

```bash
PI_SPIKE_RUN=1 \
PI_PROVIDER=openai \
PI_MODEL=gpt-4o \
OPENAI_API_KEY=... \
PI_SPIKE_PROMPT='Reply with the word ready.' \
  RUSTUP_TOOLCHAIN=nightly-2026-07-05 cargo run --manifest-path crates/pi-sdk-spike/Cargo.toml
```

## 验证取消

```bash
PI_SPIKE_RUN=1 \
PI_SPIKE_ABORT=1 \
PI_PROVIDER=openai \
PI_MODEL=gpt-4o \
OPENAI_API_KEY=... \
RUSTUP_TOOLCHAIN=nightly-2026-07-05 cargo run --manifest-path crates/pi-sdk-spike/Cargo.toml
```

不要提交任何 API key、Provider token 或真实用户 Session 数据。
