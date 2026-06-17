import type { RuntimeActionJobStatus, RuntimeDepName, RuntimeDependencyStatus, RuntimeRequirementsStatus } from "../../lib/appCache";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { ScrollArea } from "../ui/scroll-area";

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

function RuntimeLogBlock(props: {
  label: string;
  tail: string;
  log: string;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
      {props.onToggle ? (
        <Button
          variant="ghost"
          className="h-auto justify-start px-0 py-0 text-[14px] text-muted-foreground hover:bg-transparent"
          onClick={props.onToggle}
          title={props.expanded ? "Hide details" : "Show details"}
        >
          {props.label}
        </Button>
      ) : (
        <div className="text-[14px] text-muted-foreground">{props.label}</div>
      )}
      <div className="truncate font-mono text-[13px] text-muted-foreground" title={props.tail || "No logs yet"}>
        {props.tail || "Waiting for logs..."}
      </div>
      {props.expanded !== false ? (
        <pre className="max-h-48 overflow-auto rounded-md bg-background p-3 font-mono text-[13px] leading-5 text-muted-foreground">{props.log || "No logs yet."}</pre>
      ) : null}
    </div>
  );
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
  const status = props.checking ? "Checking..." : (props.dep.checked ? (props.dep.installed ? "Installed" : "Missing") : "Unknown");

  return (
    <Card className="rounded-lg shadow-none">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <strong className="text-base font-semibold text-foreground">{props.dep.name}</strong>
              <Badge variant={props.checking ? "secondary" : props.dep.installed ? "success" : "destructive"}>
                {status}
              </Badge>
            </div>
            {props.dep.version && !props.checking ? <div className="mt-1 text-[14px] leading-6 text-muted-foreground">{props.dep.version}</div> : null}
            {props.dep.path ? <div className="mt-1 truncate font-mono text-[13px] leading-5 text-muted-foreground">{props.dep.path}</div> : null}
            {!props.dep.installed ? <div className="mt-1 text-[14px] leading-6 text-muted-foreground">{props.dep.installHint}</div> : null}
          </div>
          <Button
            variant={props.dep.installed ? "ghost" : "secondary"}
            size="sm"
            disabled={disabled}
            onClick={() => props.onRunDependencyAction(depName, action)}
          >
            {busy
              ? props.runtimeJob?.action === "uninstall"
                ? `Uninstalling... ${props.installingElapsed}s`
                : `Installing... ${props.installingElapsed}s`
              : `${props.dep.installed ? "Uninstall" : "Install"} ${props.dep.name}`}
          </Button>
        </div>
        {props.runtimeJob && props.runtimeJob.name === props.dep.name ? (
          <RuntimeLogBlock
            label={`${props.runtimeJob.action} · ${props.runtimeJob.status}${busy ? ` · ${props.installingElapsed}s` : ""}`}
            tail={props.runtimeLogTail}
            log={props.runtimeInstallLog}
            expanded={props.expandedLogDep === depName}
            onToggle={() => props.onToggleLog(depName)}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RuntimeSetupDialog(props: RuntimeSetupDialogProps) {
  const deps = [props.runtimeStatus.git, props.runtimeStatus.entire, props.runtimeStatus.opencode, props.runtimeStatus.giteam]
    .filter((dep): dep is RuntimeDependencyStatus => Boolean(dep));
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
      <DialogContent className="w-[min(880px,calc(100vw-32px))]">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <DialogTitle className="text-2xl">Runtime Setup</DialogTitle>
            <DialogDescription className="text-[15px] leading-7">
              Manage git, Entire CLI, OpenCode plugin, and giteam runtime.
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            title="Refresh runtime check"
            aria-label="Refresh runtime check"
            disabled={props.runtimeChecking || Boolean(props.installingDep)}
            onClick={props.onRefresh}
          >
            ↻
          </Button>
        </DialogHeader>

        <ScrollArea className="max-h-[min(70vh,720px)] pr-3">
          <div className="flex flex-col gap-4">
            {props.autoInitAvailable ? (
              <Card className="rounded-lg shadow-none">
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <p className="m-0 text-[14px] leading-6 text-muted-foreground">macOS can automatically initialize the full runtime on first launch.</p>
                  <Button variant="contrast" size="sm" disabled={autoInitBusy} onClick={props.onRunAutoInit}>
                    {autoInitRunning ? `Auto initializing... ${props.installingElapsed}s` : "Auto initialize"}
                  </Button>
                </CardContent>
              </Card>
            ) : null}

            {showGlobalRuntimeJob ? (
              <Card className="rounded-lg shadow-none">
                <CardHeader>
                  <CardTitle>Runtime Job</CardTitle>
                  <CardDescription>
                    {props.runtimeJob?.action} · {props.runtimeJob?.status} {props.installingDep ? `· ${props.installingElapsed}s` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <RuntimeLogBlock tail={props.runtimeLogTail} log={props.runtimeInstallLog} label="Runtime log" />
                </CardContent>
              </Card>
            ) : null}

            <div className="flex flex-col gap-3">
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
          </div>
        </ScrollArea>

        <DialogFooter className="justify-between">
          <Button variant="ghost" size="sm" onClick={props.onDismiss}>
            Continue anyway
          </Button>
          <Button variant="secondary" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
