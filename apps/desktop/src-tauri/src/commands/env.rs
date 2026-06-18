use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const INSTALL_TIMEOUT_SECS: u64 = 15 * 60;
const UNINSTALL_TIMEOUT_SECS: u64 = 2 * 60;

/// Shared shell helpers for uninstall scripts. Homebrew may hang while fetching
/// formulae.brew.sh even with HOMEBREW_NO_AUTO_UPDATE; timed brew + Cellar fallback
/// keeps the desktop UI responsive.
const UNINSTALL_SHELL_HELPERS: &str = r#"
giteam_run_timed() {
  local timeout_secs=$1
  shift
  "$@" &
  local pid=$!
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null && [ "$elapsed" -lt "$timeout_secs" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null || true
    return 124
  fi
  wait "$pid"
  return $?
}

giteam_brew_cellar_name() {
  local formula=$1
  case "$formula" in */*) echo "${formula##*/}" ;; *) echo "$formula" ;; esac
}

giteam_brew_formula_installed() {
  local base
  base=$(giteam_brew_cellar_name "$1")
  for prefix in /opt/homebrew /usr/local; do
    if [ -d "$prefix/Cellar/$base" ]; then
      return 0
    fi
  done
  return 1
}

giteam_brew_remove_formula() {
  local base
  base=$(giteam_brew_cellar_name "$1")
  for prefix in /opt/homebrew /usr/local; do
    if [ -d "$prefix/Cellar/$base" ]; then
      rm -rf "$prefix/Cellar/$base"
      rm -f "$prefix/bin/$base"
      rm -rf "$prefix/opt/$base"
      echo "[giteam] removed $prefix/Cellar/$base directly"
    fi
  done
}

giteam_brew_uninstall() {
  local formula=$1
  if ! command -v brew >/dev/null 2>&1; then
    return 0
  fi
  if ! giteam_brew_formula_installed "$formula"; then
    return 0
  fi
  echo "[giteam] uninstalling brew formula: $formula"
  if giteam_run_timed 12 env HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ANALYTICS=1 brew uninstall --force "$formula"; then
    echo "[giteam] brew uninstall $formula succeeded"
  else
    echo "[giteam] brew uninstall $formula timed out or failed; removing Cellar directly"
    giteam_brew_remove_formula "$formula"
  fi
}

giteam_find_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return
  fi
  for p in "$HOME/.npm-global/bin/npm" "/usr/local/bin/npm" "/opt/homebrew/bin/npm" "/opt/homebrew/Caskroom/miniconda/base/bin/npm" "/opt/homebrew/Caskroom/miniconda3/base/bin/npm"; do
    if [ -x "$p" ]; then
      echo "$p"
      return
    fi
  done
}

giteam_npm_uninstall() {
  local npm_cmd
  npm_cmd=$(giteam_find_npm)
  if [ -z "$npm_cmd" ]; then
    return 0
  fi
  echo "[giteam] npm uninstall: $*"
  giteam_run_timed 60 "$npm_cmd" uninstall -g "$@" || echo "[giteam] npm uninstall timed out or failed"
}
"#;

fn wrap_runtime_script(name: &str, action: &str, script: &str) -> String {
    match action {
        "uninstall" => format!("{UNINSTALL_SHELL_HELPERS}\n{script}"),
        "bootstrap" | "install" if name == "opencode" => {
            format!("{BOOTSTRAP_SHELL_HELPERS}\n{script}")
        }
        _ => script.to_string(),
    }
}

fn apply_homebrew_offline_env(cmd: &mut Command) {
    cmd.env("HOMEBREW_NO_AUTO_UPDATE", "1");
    cmd.env("HOMEBREW_NO_INSTALL_CLEANUP", "1");
    cmd.env("HOMEBREW_NO_ANALYTICS", "1");
}

/// Shared shell helpers for macOS runtime bootstrap. Skips brew when present,
/// never runs `brew update`, and surfaces network timeouts clearly.
const BOOTSTRAP_SHELL_HELPERS: &str = r#"
giteam_run_timed() {
  local timeout_secs=$1
  shift
  "$@" &
  local pid=$!
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null && [ "$elapsed" -lt "$timeout_secs" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    wait "$pid" 2>/dev/null || true
    return 124
  fi
  wait "$pid"
  return $?
}

giteam_network_fail() {
  echo "NETWORK_ERROR: 安装超时，请检查网络连接后重试。"
  exit 2
}

giteam_brew_install() {
  local spec=$1
  local timeout_secs=${2:-180}
  if ! giteam_run_timed "$timeout_secs" env HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ANALYTICS=1 brew install -v "$spec"; then
    echo "NETWORK_ERROR: $spec 安装超时，请检查网络连接后重试。"
    exit 2
  fi
}

giteam_npm_install_global() {
  local timeout_secs=$1
  shift
  local npm_cmd=""
  if command -v npm >/dev/null 2>&1; then
    npm_cmd=$(command -v npm)
  else
    for p in "$HOME/.npm-global/bin/npm" "/usr/local/bin/npm" "/opt/homebrew/bin/npm" "/opt/homebrew/Caskroom/miniconda/base/bin/npm" "/opt/homebrew/Caskroom/miniconda3/base/bin/npm"; do
      if [ -x "$p" ]; then
        npm_cmd=$p
        break
      fi
    done
  fi
  if [ -z "$npm_cmd" ]; then
    echo "npm is required but not found in PATH."
    exit 2
  fi
  if ! giteam_run_timed "$timeout_secs" "$npm_cmd" install -g --loglevel info --progress=true "$@"; then
    echo "NETWORK_ERROR: npm 安装超时，请检查网络连接后重试。"
    exit 2
  fi
}

giteam_find_npm() {
  if command -v npm >/dev/null 2>&1; then
    command -v npm
    return
  fi
  for p in "$HOME/.npm-global/bin/npm" "/usr/local/bin/npm" "/opt/homebrew/bin/npm" "/opt/homebrew/Caskroom/miniconda/base/bin/npm" "/opt/homebrew/Caskroom/miniconda3/base/bin/npm"; do
    if [ -x "$p" ]; then
      echo "$p"
      return
    fi
  done
}

giteam_install_opencode() {
  local timeout_secs=${1:-300}
  local curl_timeout=60
  export PATH="$HOME/.opencode/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
  if command -v opencode >/dev/null 2>&1 || [ -x "$HOME/.opencode/bin/opencode" ]; then
    echo "[giteam] PROGRESS: 88 OpenCode 已安装"
    return 0
  fi
  local npm_cmd
  npm_cmd=$(giteam_find_npm)
  if [ -n "$npm_cmd" ]; then
    echo "[giteam] PROGRESS: 68 正在通过 npm 安装 OpenCode..."
    if giteam_run_timed "$timeout_secs" "$npm_cmd" install -g opencode-ai; then
      if command -v opencode >/dev/null 2>&1 || [ -x "$HOME/.opencode/bin/opencode" ]; then
        echo "[giteam] PROGRESS: 88 OpenCode 已安装"
        return 0
      fi
    fi
    echo "[giteam] npm 安装失败，尝试官方脚本..."
  fi
  echo "[giteam] PROGRESS: 74 正在通过官方脚本安装 OpenCode..."
  if giteam_run_timed "$curl_timeout" bash -c 'curl -fsSL https://opencode.ai/install | bash -s -- --no-modify-path'; then
    if command -v opencode >/dev/null 2>&1 || [ -x "$HOME/.opencode/bin/opencode" ]; then
      echo "[giteam] PROGRESS: 88 OpenCode 已安装"
      return 0
    fi
  fi
  if [ -z "$npm_cmd" ]; then
    echo "NETWORK_ERROR: OpenCode 安装失败，未找到 npm 且官方脚本不可用。请检查网络后重试。"
  else
    echo "NETWORK_ERROR: OpenCode 安装失败，请检查网络连接后重试。"
  fi
  exit 2
}
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDependencyStatus {
    pub name: String,
    pub checked: bool,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub install_hint: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRequirementsStatus {
    pub platform: String,
    pub homebrew_installed: bool,
    pub git: RuntimeDependencyStatus,
    pub entire: RuntimeDependencyStatus,
    pub opencode: RuntimeDependencyStatus,
    pub giteam: RuntimeDependencyStatus,
}

#[derive(Debug, Clone)]
struct RuntimeActionJob {
    job_id: String,
    name: String,
    action: String,
    status: String,
    log: String,
    started_at_ms: i64,
    finished_at_ms: Option<i64>,
    exit_code: Option<i32>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActionJobStatus {
    pub job_id: String,
    pub name: String,
    pub action: String,
    pub status: String,
    pub log: String,
    pub started_at_ms: i64,
    pub finished_at_ms: Option<i64>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

static JOBS: OnceLock<Mutex<HashMap<String, RuntimeActionJob>>> = OnceLock::new();

fn jobs() -> &'static Mutex<HashMap<String, RuntimeActionJob>> {
    JOBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn build_path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
        .collect();
    let extras = [
        format!("{home}/.opencode/bin"),
        format!("{home}/.local/bin"),
        format!("{home}/.npm-global/bin"),
        format!("{home}/.cargo/bin"),
        format!("{home}/miniconda3/bin"),
        format!("{home}/anaconda3/bin"),
        format!("{home}/.pyenv/shims"),
        // Homebrew Cask installs Miniconda here; GUI apps often do not inherit this in PATH.
        "/opt/homebrew/Caskroom/miniconda/base/bin".to_string(),
        "/opt/homebrew/Caskroom/miniconda3/base/bin".to_string(),
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/bin".to_string(),
        "/bin".to_string(),
        "/usr/sbin".to_string(),
        "/sbin".to_string(),
    ];
    for dir in extras {
        if !dir.is_empty() && !dirs.iter().any(|d| d == &dir) {
            dirs.push(dir);
        }
    }
    dirs.join(":")
}

fn append_job_log(job_id: &str, msg: &str) {
    if let Ok(mut map) = jobs().lock() {
        if let Some(job) = map.get_mut(job_id) {
            job.log.push_str(msg);
            if !msg.ends_with('\n') {
                job.log.push('\n');
            }
        }
    }
}

fn set_job_done(job_id: &str, success: bool, exit_code: Option<i32>, err: Option<String>) {
    if let Ok(mut map) = jobs().lock() {
        if let Some(job) = map.get_mut(job_id) {
            job.status = if success {
                "succeeded".to_string()
            } else {
                "failed".to_string()
            };
            job.exit_code = exit_code;
            job.error = err;
            job.finished_at_ms = Some(now_millis());
        }
    }
}

/// Runtime Setup 只关心「npm 全局是否安装 giteam」。
/// 开发仓库根目录的 `node_modules/.bin/giteam` 不应让卸载后仍显示为已安装。
pub(crate) fn check_giteam_npm_global() -> RuntimeDependencyStatus {
    const INSTALL_HINT: &str = "npm install -g giteam@latest";
    let script = r##"
BIN=""
if command -v giteam >/dev/null 2>&1; then
  BIN=$(command -v giteam)
fi
if [ -n "$BIN" ] && printf '%s' "$BIN" | grep -q 'node_modules/.bin'; then
  BIN=""
fi
if [ -z "$BIN" ]; then
  for p in "$HOME/.npm-global/bin/giteam" "/usr/local/bin/giteam" "/opt/homebrew/bin/giteam" "/opt/homebrew/Caskroom/miniconda/base/bin/giteam" "/opt/homebrew/Caskroom/miniconda3/base/bin/giteam"; do
    if [ -x "$p" ]; then
      BIN=$p
      break
    fi
  done
fi
if [ -z "$BIN" ]; then
  printf 'NO_PKG\t\t\t\n'
  exit 0
fi
VER=$("$BIN" --version 2>/dev/null | head -1 | tr -d '\r')
printf 'OK\t%s\t%s\t\n' "$BIN" "$VER"
exit 0
"##;

    let Ok((code, stdout, _)) = run_shell_capture(script, 12) else {
        return RuntimeDependencyStatus {
            name: "giteam".to_string(),
            checked: true,
            installed: false,
            path: None,
            version: None,
            latest_version: None,
            update_available: false,
            install_hint: INSTALL_HINT.to_string(),
        };
    };

    if code != 0 {
        return RuntimeDependencyStatus {
            name: "giteam".to_string(),
            checked: true,
            installed: false,
            path: None,
            version: None,
            latest_version: None,
            update_available: false,
            install_hint: INSTALL_HINT.to_string(),
        };
    }

    let line = stdout.lines().next().unwrap_or("");
    let mut parts = line.splitn(4, '\t');
    let status = parts.next().unwrap_or("").trim();
    let path = parts.next().unwrap_or("").trim();
    let ver = parts.next().unwrap_or("").trim();

    if status != "OK" {
        return RuntimeDependencyStatus {
            name: "giteam".to_string(),
            checked: true,
            installed: false,
            path: None,
            version: None,
            latest_version: None,
            update_available: false,
            install_hint: INSTALL_HINT.to_string(),
        };
    }

    let path_opt = if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    };
    let ver_opt = if ver.is_empty() {
        None
    } else {
        Some(ver.to_string())
    };
    let installed = path_opt.is_some() && ver_opt.is_some();

    RuntimeDependencyStatus {
        name: "giteam".to_string(),
        checked: true,
        installed,
        path: path_opt,
        version: ver_opt,
        latest_version: None,
        update_available: false,
        install_hint: INSTALL_HINT.to_string(),
    }
}

fn check_dep(name: &str, version_args: &[&str], install_hint: &str) -> RuntimeDependencyStatus {
    // zsh caches `command -v` results; clear the table so uninstall/reinstall reflects immediately.
    let path_cmd = format!("rehash 2>/dev/null || true; command -v {name}");
    let path_out = run_shell_capture(&path_cmd, 5)
        .ok()
        .filter(|(code, _, _)| *code == 0)
        .map(|(_, stdout, _)| stdout.trim().to_string())
        .filter(|s| !s.is_empty());

    let version_script = format!("{} {}", name, version_args.join(" "));
    let version_out = run_shell_capture(&version_script, 8)
        .ok()
        .filter(|(code, _, _)| *code == 0)
        .map(|(_, stdout, _)| stdout.lines().next().unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty());

    // Do not treat a stale `command -v` path as "installed" if the binary is gone or broken.
    let installed = path_out.is_some() && version_out.is_some();

    RuntimeDependencyStatus {
        name: name.to_string(),
        checked: true,
        installed,
        path: path_out,
        version: version_out,
        latest_version: None,
        update_available: false,
        install_hint: install_hint.to_string(),
    }
}

#[tauri::command]
pub async fn check_runtime_dependency(name: &str) -> Result<RuntimeDependencyStatus, String> {
    let dep_name = name.to_string();
    tauri::async_runtime::spawn_blocking(move || match dep_name.as_str() {
        "git" => Ok(check_dep("git", &["--version"], "brew install git")),
        "entire" => Ok(check_dep(
            "entire",
            &["--version"],
            "brew tap entireio/tap && brew install entireio/tap/entire",
        )),
        "opencode" => Ok(check_dep(
            "opencode",
            &["--version"],
            "npm install -g opencode-ai",
        )),
        "giteam" => Ok(check_giteam_npm_global()),
        _ => Err(format!("unsupported dependency: {}", dep_name)),
    })
    .await
    .map_err(|e| format!("failed to check dependency: {e}"))?
}

fn run_shell_capture(script: &str, timeout_secs: u64) -> Result<(i32, String, String), String> {
    let mut cmd = Command::new("/bin/zsh");
    // Use non-interactive zsh so ~/.zshrc cannot pollute stdout (breaks `command -v` parsing).
    cmd.args(["-fc", script]);
    cmd.env("PATH", build_path_env());
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn shell: {e}"))?;

    let start = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|e| format!("failed waiting shell: {e}"))?
        {
            let out = child
                .stdout
                .take()
                .ok_or_else(|| "missing stdout pipe".to_string())?;
            let err = child
                .stderr
                .take()
                .ok_or_else(|| "missing stderr pipe".to_string())?;
            let mut out_reader = BufReader::new(out);
            let mut err_reader = BufReader::new(err);
            let mut stdout = String::new();
            let mut stderr = String::new();
            out_reader
                .read_to_string(&mut stdout)
                .map_err(|e| format!("read stdout failed: {e}"))?;
            err_reader
                .read_to_string(&mut stderr)
                .map_err(|e| format!("read stderr failed: {e}"))?;
            return Ok((status.code().unwrap_or(-1), stdout, stderr));
        }
        if start.elapsed() > Duration::from_secs(timeout_secs) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("command timed out".to_string());
        }
        thread::sleep(Duration::from_millis(120));
    }
}

fn install_script(name: &str, action: &str) -> Result<&'static str, String> {
    match (name, action) {
        ("git", "install") => Ok(r#"if command -v brew >/dev/null 2>&1; then
  brew install git
else
  xcode-select --install || true
  echo "Homebrew not found. Triggered Xcode Command Line Tools installer."
fi"#),
        ("git", "uninstall") => Ok(r#"if command -v brew >/dev/null 2>&1; then
  giteam_brew_uninstall git || true
else
  echo "Git installed by Xcode Command Line Tools must be removed manually."
fi"#),
        ("entire", "install") => Ok(r#"if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required to install Entire CLI."
  exit 2
fi
brew tap entireio/tap
brew install entireio/tap/entire"#),
        ("entire", "uninstall") => Ok(r##"giteam_brew_uninstall entire
if [ -f "$HOME/.local/bin/entire" ]; then
  rm -f "$HOME/.local/bin/entire"
fi
echo "Entire uninstall finished.""##),
        ("opencode", "install") => Ok(r##"giteam_install_opencode 300
echo "OpenCode install finished.""##),
        ("opencode", "uninstall") => Ok(r##"giteam_brew_uninstall opencode
giteam_brew_uninstall anomalyco/tap/opencode
giteam_npm_uninstall opencode-ai @opencode-ai/opencode opencode
if [ -x "$HOME/.opencode/bin/opencode" ]; then
  rm -f "$HOME/.opencode/bin/opencode"
  echo "[giteam] removed $HOME/.opencode/bin/opencode"
fi
echo "OpenCode uninstall finished.""##),
        ("giteam", "install") | ("giteam", "update") => Ok(r##"NPM_CMD=""
if command -v npm >/dev/null 2>&1; then
  NPM_CMD=$(command -v npm)
else
  for p in "$HOME/.npm-global/bin/npm" "/usr/local/bin/npm" "/opt/homebrew/bin/npm" "/opt/homebrew/Caskroom/miniconda/base/bin/npm" "/opt/homebrew/Caskroom/miniconda3/base/bin/npm"; do
    if [ -x "$p" ]; then
      NPM_CMD=$p
      break
    fi
  done
fi
if [ -z "$NPM_CMD" ]; then
  echo "npm is required to install giteam CLI (not found in PATH)."
  exit 2
fi
# Install the highest published version, ignoring dist-tags.
# Do NOT rely on `node` existing in GUI PATH; use python3 to parse JSON.
PYTHON_CMD=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_CMD=$(command -v python3)
else
  for p in "/usr/bin/python3" "/opt/homebrew/bin/python3" "$HOME/.pyenv/shims/python3" "/opt/homebrew/Caskroom/miniconda/base/bin/python3" "/opt/homebrew/Caskroom/miniconda3/base/bin/python3"; do
    if [ -x "$p" ]; then
      PYTHON_CMD=$p
      break
    fi
  done
fi
if [ -z "$PYTHON_CMD" ]; then
  echo "python3 is required to install latest giteam version (not found in PATH)."
  exit 2
fi
VERSIONS_JSON=$("$NPM_CMD" view giteam versions --json 2>/dev/null || true)
LATEST=$("$NPM_CMD" view giteam versions --json 2>/dev/null | "$PYTHON_CMD" -c 'import json,sys; raw=sys.stdin.read().strip(); 
import sys as _s
try: arr=json.loads(raw) if raw else []
except Exception: arr=[]
_s.stdout.write(str(arr[-1]).strip() if isinstance(arr,list) and arr else "")')
echo "[giteam] versions=$(echo "$VERSIONS_JSON" | tr -d '\n' | cut -c1-2000)"
echo "[giteam] resolved_latest=$LATEST"
if [ -z "$LATEST" ]; then
  echo "[giteam] falling back to dist-tag latest"
  "$NPM_CMD" install -g giteam@latest
else
  "$NPM_CMD" install -g "giteam@$LATEST"
fi
PREFIX=$("$NPM_CMD" prefix -g)
BIN="$PREFIX/bin/giteam"
if [ -x "$BIN" ]; then
  echo "[giteam] installed_version=$("$BIN" --version 2>/dev/null | head -1 | tr -d '\r')"
  echo "[giteam] installed_bin=$BIN"
else
  echo "[giteam] install finished but bin not found at $BIN"
fi"##),
        ("giteam", "uninstall") => Ok(r##"giteam_npm_uninstall giteam
echo "giteam uninstall finished.""##),
        // Mirrors the standalone macOS runtime bootstrap script so first-launch
        // setup can run inside the packaged desktop app without relying on an
        // external file path.
        ("runtime", "bootstrap") => Ok(r##"set -e
if [ "$(uname -s)" != "Darwin" ]; then
  echo "Runtime bootstrap only supports macOS."
  exit 1
fi

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

log() {
  printf '==> %s\n' "$1"
}

ensure_brew_in_shell() {
  if has_cmd brew; then
    return
  fi
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    return
  fi
  if [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
}

install_homebrew() {
  if has_cmd brew; then
    log "Homebrew already installed"
    return
  fi
  log "Installing Homebrew"
  if ! giteam_run_timed 600 env NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; then
    echo "NETWORK_ERROR: Homebrew 安装超时，请检查网络连接后重试。"
    exit 2
  fi
  ensure_brew_in_shell
  if ! has_cmd brew; then
    echo "Homebrew installation failed."
    exit 2
  fi
}

ensure_git() {
  if has_cmd git; then
    log "git already installed"
    return
  fi
  log "Installing git"
  giteam_brew_install git
}

ensure_node() {
  if has_cmd node && has_cmd npm; then
    log "node/npm already installed"
    return
  fi
  log "Installing node"
  giteam_brew_install node
}

ensure_entire() {
  if has_cmd entire; then
    log "Entire already installed"
    return
  fi
  log "Installing Entire"
  if ! giteam_run_timed 120 env HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 HOMEBREW_NO_ANALYTICS=1 brew tap entireio/tap; then
    giteam_network_fail
  fi
  giteam_brew_install entireio/tap/entire
}

ensure_opencode() {
  if has_cmd opencode; then
    log "OpenCode already installed"
    return
  fi
  log "Installing OpenCode"
  giteam_install_opencode 300
}

ensure_giteam() {
  if has_cmd giteam; then
    log "giteam already installed"
    return
  fi
  log "Installing giteam"
  giteam_npm_install_global 300 giteam@latest
}

install_homebrew
ensure_brew_in_shell
ensure_git
ensure_node
ensure_brew_in_shell
ensure_entire
ensure_opencode
ensure_giteam
echo "Runtime bootstrap complete.""##),
        _ => Err(format!("unsupported action: {action} {name}")),
    }
}

#[tauri::command]
pub async fn check_runtime_requirements() -> RuntimeRequirementsStatus {
    tauri::async_runtime::spawn_blocking(check_runtime_requirements_sync)
        .await
        .unwrap_or_else(|_| check_runtime_requirements_sync())
}

fn check_runtime_requirements_sync() -> RuntimeRequirementsStatus {
    let homebrew = check_dep("brew", &["--version"], "Install Homebrew first.");
    let git = check_dep("git", &["--version"], "brew install git");
    let entire = check_dep(
        "entire",
        &["--version"],
        "brew tap entireio/tap && brew install entireio/tap/entire",
    );
    let opencode = check_dep("opencode", &["--version"], "npm install -g opencode-ai");
    let giteam = check_giteam_npm_global();
    RuntimeRequirementsStatus {
        platform: std::env::consts::OS.to_string(),
        homebrew_installed: homebrew.installed,
        git,
        entire,
        opencode,
        giteam,
    }
}

#[tauri::command]
pub fn start_runtime_dependency_action(name: &str, action: &str) -> Result<String, String> {
    let script = install_script(name, action)?;
    let job_id = format!("job-{}-{}", now_millis(), std::process::id());
    let job = RuntimeActionJob {
        job_id: job_id.clone(),
        name: name.to_string(),
        action: action.to_string(),
        status: "running".to_string(),
        log: format!("Starting {action} for {name}...\n"),
        started_at_ms: now_millis(),
        finished_at_ms: None,
        exit_code: None,
        error: None,
    };
    {
        let mut map = jobs()
            .lock()
            .map_err(|_| "failed to lock install jobs".to_string())?;
        map.insert(job_id.clone(), job);
    }

    let script_owned = wrap_runtime_script(name, action, script);
    let action_owned = action.to_string();
    let job_id_for_thread = job_id.clone();
    thread::spawn(move || {
        let mut cmd = Command::new("/bin/zsh");
        cmd.args(["-fc", &script_owned]);
        cmd.env("PATH", build_path_env());
        if action_owned == "uninstall" || action_owned == "bootstrap" {
            apply_homebrew_offline_env(&mut cmd);
        }
        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                append_job_log(&job_id_for_thread, &format!("spawn error: {e}"));
                set_job_done(
                    &job_id_for_thread,
                    false,
                    Some(-1),
                    Some(format!("failed to spawn process: {e}")),
                );
                return;
            }
        };

        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(out) = stdout {
            let jid = job_id_for_thread.clone();
            thread::spawn(move || {
                let reader = BufReader::new(out);
                for line in reader.lines().map_while(Result::ok) {
                    append_job_log(&jid, &line);
                }
            });
        }

        if let Some(err) = stderr {
            let jid = job_id_for_thread.clone();
            thread::spawn(move || {
                let reader = BufReader::new(err);
                for line in reader.lines().map_while(Result::ok) {
                    append_job_log(&jid, &line);
                }
            });
        }

        let start = Instant::now();
        let timeout_secs = if action_owned == "uninstall" {
            UNINSTALL_TIMEOUT_SECS
        } else {
            INSTALL_TIMEOUT_SECS
        };
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    if status.success() {
                        set_job_done(&job_id_for_thread, true, status.code(), None);
                    } else {
                        set_job_done(
                            &job_id_for_thread,
                            false,
                            status.code(),
                            Some(format!("action failed with code {:?}", status.code())),
                        );
                    }
                    break;
                }
                Ok(None) => {
                    if start.elapsed() > Duration::from_secs(timeout_secs) {
                        let _ = child.kill();
                        let _ = child.wait();
                        append_job_log(&job_id_for_thread, "runtime dependency action timed out.");
                        set_job_done(
                            &job_id_for_thread,
                            false,
                            Some(-1),
                            Some("runtime dependency action timed out".to_string()),
                        );
                        break;
                    }
                    thread::sleep(Duration::from_millis(150));
                }
                Err(e) => {
                    append_job_log(&job_id_for_thread, &format!("wait error: {e}"));
                    set_job_done(
                        &job_id_for_thread,
                        false,
                        Some(-1),
                        Some(format!("failed waiting process: {e}")),
                    );
                    break;
                }
            }
        }
    });

    Ok(job_id)
}

#[tauri::command]
pub fn get_runtime_dependency_action(job_id: &str) -> Result<RuntimeActionJobStatus, String> {
    let map = jobs()
        .lock()
        .map_err(|_| "failed to lock install jobs".to_string())?;
    let job = map
        .get(job_id)
        .ok_or_else(|| format!("job not found: {job_id}"))?;
    Ok(RuntimeActionJobStatus {
        job_id: job.job_id.clone(),
        name: job.name.clone(),
        action: job.action.clone(),
        status: job.status.clone(),
        log: job.log.clone(),
        started_at_ms: job.started_at_ms,
        finished_at_ms: job.finished_at_ms,
        exit_code: job.exit_code,
        error: job.error.clone(),
    })
}
