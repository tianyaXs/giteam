//! bash 命令安全分级：只读命令直行白名单（Codex execpolicy safe 白名单
//! 思路的保守移植）。
//!
//! 判定原则（全部 fail-closed——不确定就问）：
//! - 复合命令按 `&&`/`||`/`;`/`|`/`&` 拆段，**每段**都必须只读才直行；
//! - 含变量展开 `$`、命令替换反引号、任何重定向 `<`/`>`（含 heredoc）、
//!   命令路径含 `/`（防 PATH 外二进制）一律需审批；
//! - 白名单只收无写形态的命令；有条件只读的（find/sort/git 子命令）逐
//!   flag 核查，写形态 flag 一票否决；
//! - `env`/`sed`/`awk`/`xargs`/`tee` 等可执行任意程序或改文件的命令
//!   v1 不放行（宁可多问）。
//!
//! 该白名单只影响"是否弹审批"，不影响 permissions.json 的用户显式放行
//! （那在更早的快路径）；也绝非沙箱——它只是把明显无害的只读探测从
//! 审批负担里摘出去。

/// 判定一条 bash 命令是否整体只读（可免审批直行）。
#[must_use]
pub fn is_readonly_command(command: &str) -> bool {
    let command = command.trim();
    if command.is_empty() {
        return false;
    }
    // fail-closed 字符集：变量/命令/进程替换、重定向与 heredoc。
    // 引号内的这些字符会误拆段导致整条判否——保守方向的误判（多问一次）
    // 可接受，反向（漏放写命令）不可接受。
    if ['$', '`', '<', '>'].iter().any(|ch| command.contains(*ch)) {
        return false;
    }
    split_segments(command).iter().all(|segment| segment_is_readonly(segment))
}

/// 按 shell 控制操作符拆段（字符级；引号内操作符同样拆分，见上文注释）。
fn split_segments(command: &str) -> Vec<String> {
    command
        .split(['&', '|', ';'])
        .map(str::trim)
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect()
}

/// 无条件只读命令：核心探测集（无任何写/执行形态）。
const ALWAYS_READONLY: &[&str] = &[
    "cat", "head", "tail", "grep", "rg", "pwd", "echo", "wc", "file", "stat", "which", "type",
    "printenv", "date", "whoami", "uname", "du", "df", "tree", "jq", "cut", "uniq", "diff", "ls",
    "ps",
];

/// find 的写形态 flag 前缀（-delete/-exec/-execdir/-ok/-okdir/-fprint*）。
const FIND_WRITE_FLAGS: &[&str] = &["-delete", "-exec", "-execdir", "-ok", "-okdir", "-fprint"];

/// 单段（无控制操作符）是否只读。
fn segment_is_readonly(segment: &str) -> bool {
    let tokens: Vec<&str> = segment.split_whitespace().collect();
    if tokens.is_empty() {
        return false;
    }
    // 剥离环境赋值前缀（VAR=x cmd）：赋值本身无副作用，命令部分照常判定。
    let mut start = 0;
    while start < tokens.len() && is_env_assignment(tokens[start]) {
        start += 1;
    }
    let Some(first) = tokens.get(start) else {
        return false; // 纯赋值（VAR=x）——无命令，保守问。
    };
    // 命令路径含 '/' 一律问：/tmp/evil/ls 防不胜防，也挡 ./script。
    if first.contains('/') {
        return false;
    }
    let args = &tokens[start + 1..];
    match *first {
        "find" => !args
            .iter()
            .any(|arg| FIND_WRITE_FLAGS.iter().any(|flag| arg.starts_with(flag))),
        "sort" => !args.iter().any(|arg| *arg == "-o" || arg.starts_with("--output")),
        "git" => git_subcommand_is_readonly(args),
        name => ALWAYS_READONLY.contains(&name),
    }
}

/// `VAR=value` 形式（key 是合法 shell 标识符）。
fn is_env_assignment(token: &str) -> bool {
    match token.split_once('=') {
        Some((key, _)) => !key.is_empty() && key.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') && !key.starts_with('-'),
        None => false,
    }
}

/// git 子命令只读判定。无条件只读集 + 条件子命令（branch/tag/config/stash）
/// 逐参数核查；`--output` 写文件能力全局否决。
fn git_subcommand_is_readonly(args: &[&str]) -> bool {
    if args.iter().any(|arg| *arg == "--output" || arg.starts_with("--output=")) {
        return false;
    }
    let Some(sub) = args.first().copied() else {
        return true; // 裸 git / git --version：只打印。
    };
    match sub {
        "status" | "log" | "diff" | "show" | "blame" | "rev-parse" | "ls-files" | "describe"
        | "shortlog" | "reflog" | "name-rev" | "merge-base" | "cat-file" | "rev-list"
        | "remote" => true,
        // 无参或纯 flag 是列举；带位置参数即创建/删除。
        "branch" | "tag" => args[1..].iter().all(|arg| arg.starts_with('-')),
        // 只认读取形态；`git config key value` 是写。
        "config" => args
            .get(1)
            .is_some_and(|arg| *arg == "--list" || *arg == "-l" || arg.starts_with("--get")),
        // `git stash` 无参是 push，只有 `git stash list` 只读。
        "stash" => args.get(1).copied() == Some("list"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readonly_probing_commands_pass() {
        for command in [
            "ls",
            "ls -la src",
            "cat Cargo.toml",
            "grep -rn \"TODO\" src/",
            "git status",
            "git log --oneline -5",
            "git diff HEAD~1",
            "git show abc123",
            "git branch -a",
            "git config --get user.name",
            "git stash list",
            "find . -name '*.rs'",
            "cat package.json | grep name",
            "FOO=bar ls /tmp",
            "echo hello",
            "pwd && git status",
        ] {
            assert!(is_readonly_command(command), "should pass: {command}");
        }
    }

    #[test]
    fn mutating_and_ambiguous_commands_fail_closed() {
        for command in [
            "rm -rf /",
            "cargo build",
            "npm install",
            "git commit -m x",
            "git checkout -b feature",
            "git branch new-branch",
            "git config user.name New",
            "git stash",
            "find . -delete",
            "find . -exec rm {} +",
            "sort -o out.txt data.txt",
            "git diff --output=patch.txt",
            // fail-closed 字符集：替换/重定向/变量/路径执行。
            "cat $(which ls)",
            "echo `whoami`",
            "echo hi > file.txt",
            "cat < input.txt",
            "ls $HOME",
            "/usr/bin/git status",
            "./scripts/build.sh",
            // 拆段后任一非只读即整体问。
            "git status && npm test",
            "cat f | xargs rm",
            // v1 明确不放行的高危面。
            "env",
            "sed -n 1p file",
            "awk '{print}' file",
            "xargs ls",
            "tee out.txt",
        ] {
            assert!(!is_readonly_command(command), "should fail: {command}");
        }
    }

    #[test]
    fn quoted_metacharacters_fail_closed_too() {
        // 引号内的 | 不做语义解析（v1 不带 shell parser）：拆段误判为
        // "b" 命令不在白名单 → 整体判否——保守方向正确。
        assert!(!is_readonly_command("echo \"a|b\""));
        // 空段/纯空白拒绝。
        assert!(!is_readonly_command("   "));
        assert!(!is_readonly_command(""));
    }
}
