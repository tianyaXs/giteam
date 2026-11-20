// 0.2.60 全平台失败：automation/pi_agent 大 async 状态机把 rustc 查询深度顶穿默认 128。
#![recursion_limit = "512"]

pub mod asset_graph;
pub mod automation;
pub mod cloud;
pub mod command_runner;
pub mod control;
pub mod dingtalk;
pub mod pi_agent;
pub mod share;
pub mod skills_market;
