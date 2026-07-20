import { useEffect, useState } from "react";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import type { RemoteRepo } from "./types";

export type RemoteRepoFormValues = {
  repoId: string;
  name: string;
  remoteUrl: string;
  defaultRef: string;
  authMethod: "" | "ssh_agent" | "system_https";
};

const EMPTY_FORM: RemoteRepoFormValues = {
  repoId: "",
  name: "",
  remoteUrl: "",
  defaultRef: "main",
  authMethod: "",
};

function initialForm(repo: RemoteRepo | null): RemoteRepoFormValues {
  if (!repo) return EMPTY_FORM;
  return {
    repoId: repo.id,
    name: repo.displayName,
    // The service intentionally returns only a sanitized origin. Editing the URL is opt-in.
    remoteUrl: "",
    defaultRef: repo.branch,
    authMethod: "",
  };
}

export function RemoteRepoFormDialog({
  open,
  repo,
  busy,
  error,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  repo: RemoteRepo | null;
  busy: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: RemoteRepoFormValues) => void;
}) {
  const editing = Boolean(repo);
  const [form, setForm] = useState<RemoteRepoFormValues>(() => initialForm(repo));

  useEffect(() => {
    if (open) setForm(initialForm(repo));
  }, [open, repo]);

  const setField = <K extends keyof RemoteRepoFormValues>(key: K, value: RemoteRepoFormValues[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };
  const canSubmit = Boolean(form.name.trim() && form.defaultRef.trim() && (editing || (form.repoId.trim() && form.remoteUrl.trim())));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,34rem)] p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{editing ? "编辑远程仓库" : "引入远程仓库"}</DialogTitle>
          <DialogDescription>
            {editing ? "仅提交有变化的连接信息。修改来源或默认分支后，需要手动同步。" : "引入会在服务端登记连接并排队镜像克隆；不会创建 workspace 或 session。"}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 px-5 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit && !busy) onSubmit(form);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              Connection ID
              <Input value={form.repoId} disabled={editing || busy} placeholder="team-api" onChange={(event) => setField("repoId", event.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              展示名
              <Input value={form.name} disabled={busy} placeholder="team/api" onChange={(event) => setField("name", event.target.value)} />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            {editing ? "新的仓库地址（留空则保持不变）" : "仓库地址"}
            <Input
              type="text"
              value={form.remoteUrl}
              disabled={busy}
              placeholder={editing ? "当前来源已脱敏；仅在需要更换来源时填写" : "git@github.com:team/api.git"}
              onChange={(event) => setField("remoteUrl", event.target.value)}
            />
            <span className="text-xs font-normal text-muted-foreground">仅支持 SSH agent 或系统已有 HTTPS 凭据；不收集或保存 token。</span>
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-foreground">
              默认分支
              <Input value={form.defaultRef} disabled={busy} placeholder="main" onChange={(event) => setField("defaultRef", event.target.value)} />
            </label>
            <span className="grid gap-1.5 text-sm font-medium text-foreground">
              凭据来源
              <Select value={form.authMethod || "unchanged"} disabled={busy} onValueChange={(value) => setField("authMethod", value === "unchanged" ? "" : value as RemoteRepoFormValues["authMethod"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unchanged">{editing ? "保持不变" : "由 Git 自动选择"}</SelectItem>
                  <SelectItem value="ssh_agent">SSH agent</SelectItem>
                  <SelectItem value="system_https">系统 HTTPS 凭据</SelectItem>
                </SelectContent>
              </Select>
            </span>
          </div>

          {error ? <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <DialogFooter className="border-t border-border pt-4">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" variant="contrast" disabled={!canSubmit || busy}>{busy ? "处理中…" : editing ? "保存并返回" : "引入仓库"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RemoteRepoRemoveDialog({
  repo,
  busy,
  onOpenChange,
  onConfirm,
}: {
  repo: RemoteRepo | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={Boolean(repo)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,29rem)]">
        <DialogHeader>
          <DialogTitle>移除远程仓库连接？</DialogTitle>
          <DialogDescription>将移除服务端的连接配置“{repo?.displayName || repo?.id}”。不会删除远端仓库，也不会创建或修改 workspace/session。</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-5">
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>{busy ? "移除中…" : "移除连接"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
