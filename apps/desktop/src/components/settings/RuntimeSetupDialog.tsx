import { RefreshIcon } from "../../components/icons";
import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";

type RuntimeSetupDialogProps = {
  runtimeStatus: RuntimeRequirementsStatus;
  runtimeChecking: boolean;
  checkingDeps: Record<RuntimeDepName, boolean>;
  installingDep: string;
  installingElapsed: number;
  runtimeJob: RuntimeActionJobStatus | null;
  runtimeInstallLog: string;
  runtimeLogTail: string;
  expandedLogDep: RuntimeDepName | null;
  onClose: () => void;
  onDismiss: () => void;
  onRefresh: () => void;
  onRunDependencyAction: (name: RuntimeDepName, action: "install" | "uninstall") => void;
  onToggleLog: (name: RuntimeDepName) => void;
};

function runtimeDepName(dep: RuntimeDependencyStatus): RuntimeDepName {
  return dep.name as RuntimeDepName;
}

function RuntimeDependencyRow(props: {
  dep: RuntimeDependencyStatus;
  checking: boolean;
  installingDep: string;
  installingElapsed: number;
  runtimeJob: RuntimeActionJobStatus | null;
  runtimeInstallLog: string;
  runtimeLogTail: string;
  expandedLogDep: RuntimeDepName | null;
  onRunDependencyAction: (name: RuntimeDepName, action: "install" | "uninstall") => void;
  onToggleLog: (name: RuntimeDepName) => void;
}) {
  const depName = runtimeDepName(props.dep);
  const busy = props.installingDep === props.dep.name;
  const disabled = Boolean(props.installingDep) || props.checking;
  const action = props.dep.installed ? "uninstall" : "install";

  return (
    <div className="env-check-row">
      <div>
        <strong>{props.dep.name}</strong>{" "}
        <span className={props.checking ? "muted" : props.dep.installed ? "env-ok" : "env-missing"}>
          {props.checking ? "Checking..." : (props.dep.checked ? (props.dep.installed ? "Installed" : "Missing") : "Unknown")}
        </span>
        {props.dep.version && !props.checking ? <div className="small muted">{props.dep.version}</div> : null}
        {props.dep.path ? <div className="small muted">{props.dep.path}</div> : null}
        {!props.dep.installed ? <div className="small muted">{props.dep.installHint}</div> : null}
      </div>
      <div className="toolbar">
        <button
          className={busy ? "chip env-chip-loading" : "chip"}
          disabled={disabled}
          onClick={() => props.onRunDependencyAction(depName, action)}
        >
          {busy ? (
            <>
              <span className="env-btn-spinner" aria-hidden="true" />
              {props.runtimeJob?.action === "uninstall" ? "Uninstalling..." : "Installing..."} {props.installingElapsed}s
            </>
          ) : (
            `${props.dep.installed ? "Uninstall" : "Install"} ${props.dep.name}`
          )}
        </button>
      </div>
      {props.runtimeJob && props.runtimeJob.name === props.dep.name ? (
        <div className="env-inline-status">
          <button
            className="env-progress-button"
            onClick={() => props.onToggleLog(depName)}
            title={props.expandedLogDep === depName ? "Hide details" : "Show details"}
          >
            <span className="env-progress-track-inline" aria-hidden="true">
              <span className={props.runtimeJob.status === "running" ? "env-progress-inline-indeterminate" : "env-progress-inline-done"} />
            </span>
            <span className="env-progress-label">
              {props.runtimeJob.action} · {props.runtimeJob.status} {busy ? `· ${props.installingElapsed}s` : ""}
            </span>
          </button>
          <div className="env-log-tail" title={props.runtimeLogTail || "No logs yet"}>
            {props.runtimeLogTail || "Waiting for logs..."}
          </div>
          {props.expandedLogDep === depName ? (
            <pre className="env-install-log">{props.runtimeInstallLog || "No logs yet."}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeSetupDialog(props: RuntimeSetupDialogProps) {
  const deps = [props.runtimeStatus.git, props.runtimeStatus.entire, props.runtimeStatus.opencode, props.runtimeStatus.giteam]
    .filter((d): d is RuntimeDependencyStatus => Boolean(d));

  return (
    <div className="modal-mask" onClick={props.onClose}>
      <div className="modal-card env-setup-card" onClick={(e) => e.stopPropagation()}>
        <div className="env-setup-head">
          <h3>Runtime Setup</h3>
          <button
            className="env-refresh-circle"
            title="Refresh runtime check"
            aria-label="Refresh runtime check"
            disabled={props.runtimeChecking || Boolean(props.installingDep)}
            onClick={props.onRefresh}
          >
            <span className={props.runtimeChecking ? "refresh-spin" : ""}><RefreshIcon /></span>
          </button>
        </div>
        <p className="small muted">Manage git, Entire CLI, OpenCode plugin, and giteam runtime.</p>

        <div className="env-check-list">
          {deps.map((dep) => {
            const depName = runtimeDepName(dep);
            return (
              <RuntimeDependencyRow
                key={dep.name}
                dep={dep}
                checking={props.checkingDeps[depName]}
                installingDep={props.installingDep}
                installingElapsed={props.installingElapsed}
                runtimeJob={props.runtimeJob}
                runtimeInstallLog={props.runtimeInstallLog}
                runtimeLogTail={props.runtimeLogTail}
                expandedLogDep={props.expandedLogDep}
                onRunDependencyAction={props.onRunDependencyAction}
                onToggleLog={props.onToggleLog}
              />
            );
          })}
        </div>

        <div className="toolbar" style={{ justifyContent: "space-between" }}>
          <div />
          <div className="toolbar">
            <button className="chip" onClick={props.onDismiss}>Continue anyway</button>
            <button className="chip" onClick={props.onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
