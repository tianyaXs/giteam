import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";

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
  autoInitAvailable: boolean;
  onClose: () => void;
  onDismiss: () => void;
  onRefresh: () => void;
  onRunAutoInit: () => void;
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
        <div className="env-row-head">
          <strong>{props.dep.name}</strong>
          <Badge variant={props.checking ? "secondary" : props.dep.installed ? "success" : "destructive"} className="env-status-badge">
            {props.checking ? "Checking..." : (props.dep.checked ? (props.dep.installed ? "Installed" : "Missing") : "Unknown")}
          </Badge>
        </div>
        {props.dep.version && !props.checking ? <div className="small muted">{props.dep.version}</div> : null}
        {props.dep.path ? <div className="small muted">{props.dep.path}</div> : null}
        {!props.dep.installed ? <div className="small muted">{props.dep.installHint}</div> : null}
      </div>
      <div className="toolbar">
        <Button
          variant={props.dep.installed ? "ghost" : "secondary"}
          size="sm"
          className={busy ? "gt-settings-action-btn env-chip-loading" : "gt-settings-action-btn"}
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
        </Button>
      </div>
      {props.runtimeJob && props.runtimeJob.name === props.dep.name ? (
        <div className="env-inline-status">
          <Button
            variant="ghost"
            className="env-progress-button !grid !h-auto !w-full !justify-stretch"
            onClick={() => props.onToggleLog(depName)}
            title={props.expandedLogDep === depName ? "Hide details" : "Show details"}
          >
            <span className="env-progress-track-inline" aria-hidden="true">
              <span className={props.runtimeJob.status === "running" ? "env-progress-inline-indeterminate" : "env-progress-inline-done"} />
            </span>
            <span className="env-progress-label">
              {props.runtimeJob.action} · {props.runtimeJob.status} {busy ? `· ${props.installingElapsed}s` : ""}
            </span>
          </Button>
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
  const activeJobMatchesDep = deps.some((dep) => dep.name === props.runtimeJob?.name);
  const showGlobalRuntimeJob = Boolean(props.runtimeJob && !activeJobMatchesDep);
  const autoInitRunning = props.runtimeJob?.name === "runtime"
    && props.runtimeJob?.action === "bootstrap"
    && props.runtimeJob?.status === "running";
  const autoInitBusy = Boolean(props.installingDep) || props.runtimeChecking;

  return (
    <Dialog open onOpenChange={(open) => {
      if (!open) props.onClose();
    }}>
      <DialogContent className="gt-settings-dialog-content">
        <DialogTitle className="sr-only">Runtime Setup</DialogTitle>
        <DialogDescription className="sr-only">Manage git, Entire CLI, OpenCode plugin, and giteam runtime.</DialogDescription>
        <div className="modal-card env-setup-card">
          <div className="env-setup-head">
            <h3>Runtime Setup</h3>
            <Button
              variant="ghost"
              size="icon"
              className="env-refresh-circle"
              title="Refresh runtime check"
              aria-label="Refresh runtime check"
              disabled={props.runtimeChecking || Boolean(props.installingDep)}
              onClick={props.onRefresh}
            >
              <span className={props.runtimeChecking ? "refresh-spin" : ""}>↻</span>
            </Button>
          </div>
          <p className="small muted">Manage git, Entire CLI, OpenCode plugin, and giteam runtime.</p>

          {props.autoInitAvailable ? (
            <div className="toolbar" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <div className="small muted">macOS can automatically initialize the full runtime on first launch.</div>
              <Button
                variant="contrast"
                size="sm"
                className={autoInitRunning ? "gt-settings-action-btn env-chip-loading" : "gt-settings-action-btn"}
                disabled={autoInitBusy}
                onClick={props.onRunAutoInit}
              >
                {autoInitRunning ? (
                  <>
                    <span className="env-btn-spinner" aria-hidden="true" />
                    Auto initializing... {props.installingElapsed}s
                  </>
                ) : (
                  "Auto initialize"
                )}
              </Button>
            </div>
          ) : null}

          {showGlobalRuntimeJob ? (
            <div className="env-inline-status" style={{ marginBottom: 12 }}>
              <div className="env-progress-button" title={props.runtimeLogTail || "No logs yet"}>
                <span className="env-progress-track-inline" aria-hidden="true">
                  <span className={props.runtimeJob?.status === "running" ? "env-progress-inline-indeterminate" : "env-progress-inline-done"} />
                </span>
                <span className="env-progress-label">
                  {props.runtimeJob?.action} · {props.runtimeJob?.status} {props.installingDep ? `· ${props.installingElapsed}s` : ""}
                </span>
              </div>
              <div className="env-log-tail" title={props.runtimeLogTail || "No logs yet"}>
                {props.runtimeLogTail || "Waiting for logs..."}
              </div>
              <pre className="env-install-log">{props.runtimeInstallLog || "No logs yet."}</pre>
            </div>
          ) : null}

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
              <Button variant="ghost" size="sm" className="gt-settings-action-btn" onClick={props.onDismiss}>
                Continue anyway
              </Button>
              <Button variant="secondary" size="sm" className="gt-settings-action-btn" onClick={props.onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
