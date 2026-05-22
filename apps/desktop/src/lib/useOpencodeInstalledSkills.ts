import { startTransition, useMemo, useRef, useState } from "react";
import { loadLocalJson, saveLocalJson } from "./localPreferences";
import {
  buildInstalledSkillInfoRows,
  INSTALLED_VIA_SKILLS_DESCRIPTION,
  normalizeInstalledOpencodeSkills,
  reconcilePendingSkillInstallGroups,
  type OpencodeInstalledSkillGroup,
  type OpencodeSkillInfo,
  type PendingSkillInstallGroup
} from "./opencodeSkillData";
import { quoteShellArg, skillSourceGroupFromSpec } from "./opencodeSkillMarketplace";
import { invoke } from "./platform";

const OPENCODE_SKILL_SOURCE_GROUPS_KEY = "giteam.opencode.skill-source-groups.v1";

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function buildInstalledSkillRemovePaths(skills: OpencodeSkillInfo[]): string[] {
  return Array.from(new Set(
    skills
      .map((skill) => String(skill.path || "").trim())
      .filter(Boolean)
  ));
}

type UseOpencodeInstalledSkillsInput = {
  repoPath: string;
  skillsVisible: boolean;
  ensureRepoSelected: () => boolean;
  appendDebugLog: (text: string) => void;
  setMessage: (value: string) => void;
  setError: (value: string) => void;
  runCommandInTerminalModule: (command: string) => Promise<void>;
};

export function useOpencodeInstalledSkills(input: UseOpencodeInstalledSkillsInput) {
  const {
    repoPath,
    skillsVisible,
    ensureRepoSelected,
    appendDebugLog,
    setMessage,
    setError,
    runCommandInTerminalModule
  } = input;

  const repoPathRef = useRef(repoPath);
  const ensureRepoSelectedRef = useRef(ensureRepoSelected);
  const appendDebugLogRef = useRef(appendDebugLog);
  const setMessageRef = useRef(setMessage);
  const setErrorRef = useRef(setError);
  const runCommandInTerminalModuleRef = useRef(runCommandInTerminalModule);
  repoPathRef.current = repoPath;
  ensureRepoSelectedRef.current = ensureRepoSelected;
  appendDebugLogRef.current = appendDebugLog;
  setMessageRef.current = setMessage;
  setErrorRef.current = setError;
  runCommandInTerminalModuleRef.current = runCommandInTerminalModule;

  const [opencodeSkills, setOpencodeSkills] = useState<OpencodeSkillInfo[]>([]);
  const [opencodeSkillsLoading, setOpencodeSkillsLoading] = useState(false);
  const [opencodeSkillsLoadedOnce, setOpencodeSkillsLoadedOnce] = useState(false);
  const [opencodeSkillsError, setOpencodeSkillsError] = useState("");
  const [opencodeSkillInstallSpec, setOpencodeSkillInstallSpec] = useState("");
  const [opencodeSkillInstallScope, setOpencodeSkillInstallScope] = useState<"project" | "global">("project");
  const [opencodeSkillInstallingSpec, setOpencodeSkillInstallingSpec] = useState("");
  const [opencodeSkillInstallNotice, setOpencodeSkillInstallNotice] = useState("");
  const [opencodeSkillInstallLog, setOpencodeSkillInstallLog] = useState("");
  const [opencodeSkillListFilter, setOpencodeSkillListFilter] = useState<"all" | "global" | "project" | "source">("all");
  const [opencodeSkillListQuery, setOpencodeSkillListQuery] = useState("");
  const [opencodeSkillSourceInput, setOpencodeSkillSourceInput] = useState("");
  const [opencodeSkillSourceKind, setOpencodeSkillSourceKind] = useState<"url" | "path">("url");
  const [opencodeSkillBusy, setOpencodeSkillBusy] = useState(false);
  const [opencodeSkillRemovingKey, setOpencodeSkillRemovingKey] = useState("");

  const skillsByRepoRef = useRef<Record<string, OpencodeSkillInfo[]>>({});
  const skillSourceGroupsRef = useRef<Record<string, string>>(loadLocalJson<Record<string, string>>(OPENCODE_SKILL_SOURCE_GROUPS_KEY, {}));
  const pendingSkillInstallGroupsRef = useRef<Record<string, PendingSkillInstallGroup[]>>({});

  const filteredOpencodeSkills = useMemo(() => {
    if (!skillsVisible) return [];
    const query = opencodeSkillListQuery.trim().toLowerCase();
    return opencodeSkills.filter((skill) => {
      const scope = skill.scope || "source";
      if (opencodeSkillListFilter !== "all" && scope !== opencodeSkillListFilter) return false;
      if (!query) return true;
      return [skill.name, skill.description, skill.path, skill.location]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [skillsVisible, opencodeSkills, opencodeSkillListFilter, opencodeSkillListQuery]);

  const groupedOpencodeSkills = useMemo<OpencodeInstalledSkillGroup[]>(() => {
    if (!skillsVisible) return [];
    const groups = new Map<string, OpencodeSkillInfo[]>();
    filteredOpencodeSkills.forEach((skill) => {
      const key = (skill.sourceGroup || skill.name).trim() || "Unnamed Skill";
      const bucket = groups.get(key) || [];
      bucket.push(skill);
      groups.set(key, bucket);
    });
    return Array.from(groups.entries())
      .map(([name, items]) => {
        const sortedItems = [...items].sort((a, b) => {
          const scopeOrder = (scope?: string) => scope === "project" ? 0 : scope === "global" ? 1 : 2;
          return scopeOrder(a.scope) - scopeOrder(b.scope)
            || String(a.path || a.location || "").localeCompare(String(b.path || b.location || ""));
        });
        const removableItems = sortedItems.filter((item) => {
          const scope = item.scope || "source";
          return scope === "project" || scope === "global";
        });
        return {
          name,
          items: sortedItems,
          removableItems,
          description: sortedItems.length > 1
            ? `${sortedItems.length} 个子 Skills`
            : (sortedItems[0]?.description || sortedItems[0]?.path || sortedItems[0]?.location || INSTALLED_VIA_SKILLS_DESCRIPTION)
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [skillsVisible, filteredOpencodeSkills]);

  function restoreCachedSkillsForRepo(targetRepoPath: string, options: { resetFilter?: boolean } = {}) {
    const cached = skillsByRepoRef.current[targetRepoPath] || null;
    startTransition(() => {
      if (cached) setOpencodeSkills(cached);
      setOpencodeSkillsLoadedOnce(Boolean(cached));
      setOpencodeSkillsLoading(!cached);
      setOpencodeSkillsError("");
      if (options.resetFilter) setOpencodeSkillListQuery("");
      setOpencodeSkillRemovingKey("");
    });
    return cached;
  }

  function pruneRemovedSkillSourceGroups(removedPaths: string[]) {
    if (removedPaths.length === 0) return;
    const nextMap = { ...skillSourceGroupsRef.current };
    let changed = false;
    removedPaths.forEach((path) => {
      if (!(path in nextMap)) return;
      delete nextMap[path];
      changed = true;
    });
    if (!changed) return;
    skillSourceGroupsRef.current = nextMap;
    saveLocalJson(OPENCODE_SKILL_SOURCE_GROUPS_KEY, nextMap);
  }

  async function refreshOpencodeSkills() {
    const requestRepoPath = repoPathRef.current.trim();
    if (!requestRepoPath) return;
    startTransition(() => {
      setOpencodeSkillsLoading(true);
      setOpencodeSkillsError("");
    });
    await waitForPaint();
    try {
      const installedRaw = await invoke<unknown>("list_installed_opencode_skills", { repoPath: requestRepoPath }).catch(() => []);
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      const installedRows = normalizeInstalledOpencodeSkills(installedRaw);
      const pending = pendingSkillInstallGroupsRef.current[requestRepoPath] || [];
      if (pending.length > 0) {
        const reconciled = reconcilePendingSkillInstallGroups({
          installedRows,
          pending,
          sourceGroupMap: skillSourceGroupsRef.current
        });
        pendingSkillInstallGroupsRef.current[requestRepoPath] = reconciled.pending;
        if (reconciled.changed) {
          skillSourceGroupsRef.current = reconciled.sourceGroupMap;
          saveLocalJson(OPENCODE_SKILL_SOURCE_GROUPS_KEY, reconciled.sourceGroupMap);
        }
      }
      const sourceGroupMap = skillSourceGroupsRef.current;
      const sourceGroupEntries = installedRows
        .map((installed) => ({
          path: installed.path,
          scope: installed.scope,
          sourceGroup: installed.sourceGroup || sourceGroupMap[installed.path] || ""
        }))
        .filter((entry) => entry.path && entry.sourceGroup);
      if (sourceGroupEntries.length > 0) {
        void invoke("save_opencode_skill_source_groups", { repoPath: requestRepoPath, entries: sourceGroupEntries }).catch(() => null);
      }
      const rows = buildInstalledSkillInfoRows(installedRows, sourceGroupMap);
      skillsByRepoRef.current[requestRepoPath] = rows;
      startTransition(() => {
        setOpencodeSkills(rows.sort((a, b) => (a.scope || "").localeCompare(b.scope || "") || a.name.localeCompare(b.name)));
      });
    } catch (error) {
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      const message = String(error);
      startTransition(() => setOpencodeSkillsError(message));
      appendDebugLogRef.current(`skill.list.error ${message}`);
    } finally {
      if (repoPathRef.current.trim() === requestRepoPath) {
        startTransition(() => {
          setOpencodeSkillsLoadedOnce(true);
          setOpencodeSkillsLoading(false);
        });
      }
    }
  }

  async function installOpencodeSkillFromRegistry(
    specArg = opencodeSkillInstallSpec,
    scopeArg: "project" | "global" = opencodeSkillInstallScope
  ) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    const primarySpec = specArg.trim();
    if (!primarySpec) {
      setErrorRef.current("请输入 skills.sh 条目，例如 vercel-labs/skills/find-skills");
      return;
    }
    const groupName = skillSourceGroupFromSpec(primarySpec);
    const beforePaths = opencodeSkills
      .filter((skill) => (skill.scope || "project") === scopeArg)
      .map((skill) => String(skill.path || ""))
      .filter(Boolean);
    pendingSkillInstallGroupsRef.current[requestRepoPath] = [
      ...(pendingSkillInstallGroupsRef.current[requestRepoPath] || []),
      { groupName: groupName || primarySpec, scope: scopeArg, beforePaths }
    ];
    const globalFlag = scopeArg === "global" ? " -g" : "";
    const command = `SKILLS_CLONE_TIMEOUT_MS=600000 npx -y skills add ${quoteShellArg(primarySpec)} --agent opencode -y${globalFlag}`;
    setOpencodeSkillBusy(false);
    setOpencodeSkillInstallingSpec("");
    setOpencodeSkillInstallNotice("");
    setOpencodeSkillInstallLog("");
    setOpencodeSkillsError("");
    setOpencodeSkillInstallSpec("");
    appendDebugLogRef.current(`skill.install.terminal ${primarySpec} scope=${scopeArg}`);
    setMessageRef.current(`已切到终端执行 Skill 安装: ${primarySpec}`);
    await runCommandInTerminalModuleRef.current(command);
    [6000, 15000, 30000].forEach((delay) => {
      window.setTimeout(() => void refreshOpencodeSkills(), delay);
    });
  }

  async function removeOpencodeSkill(skill: OpencodeSkillInfo) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    const scope = skill.scope || "source";
    const key = `${scope}:${skill.name}:${skill.path || skill.location || ""}`;
    const removablePaths = buildInstalledSkillRemovePaths([skill]);
    if (removablePaths.length === 0) {
      setOpencodeSkillsError("缺少可删除的技能路径。");
      return;
    }
    setOpencodeSkillRemovingKey(key);
    setOpencodeSkillsError("");
    try {
      const result = await invoke<any>("remove_installed_opencode_skills_by_path", { repoPath: requestRepoPath, paths: removablePaths });
      pruneRemovedSkillSourceGroups(Array.isArray(result?.removed) ? result.removed.map((item: unknown) => String(item || "")) : removablePaths);
      await refreshOpencodeSkills();
      setMessageRef.current(`Skill removed: ${skill.name}`);
    } catch (error) {
      const message = String(error);
      setOpencodeSkillsError(message);
      setErrorRef.current(message);
    } finally {
      setOpencodeSkillRemovingKey("");
    }
  }

  async function removeOpencodeSkillGroup(group: OpencodeInstalledSkillGroup) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    if (group.removableItems.length === 0) {
      setOpencodeSkillsError("该目录下没有可删除的已安装项。");
      return;
    }
    setOpencodeSkillsError("");
    try {
      const removeKeys = group.removableItems.map((skill) => `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`);
      const removablePaths = buildInstalledSkillRemovePaths(group.removableItems);
      if (removablePaths.length === 0) throw new Error("该目录下没有可删除的技能路径。");
      setOpencodeSkillRemovingKey(removeKeys[0] || "");
      const result = await invoke<any>("remove_installed_opencode_skills_by_path", { repoPath: requestRepoPath, paths: removablePaths });
      pruneRemovedSkillSourceGroups(Array.isArray(result?.removed) ? result.removed.map((item: unknown) => String(item || "")) : removablePaths);
      await refreshOpencodeSkills();
      setMessageRef.current(`Skill group removed: ${group.name}`);
    } catch (error) {
      const message = String(error);
      setOpencodeSkillsError(message);
      setErrorRef.current(message);
    } finally {
      setOpencodeSkillRemovingKey("");
    }
  }

  async function addOpencodeSkillSource() {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    const source = opencodeSkillSourceInput.trim();
    if (!source) return;
    setOpencodeSkillBusy(true);
    setOpencodeSkillsError("");
    try {
      const cfg = await invoke<any>("get_opencode_server_global_config", { repoPath: requestRepoPath });
      const currentSkills = (cfg?.skills && typeof cfg.skills === "object") ? cfg.skills : {};
      const key = opencodeSkillSourceKind === "url" ? "urls" : "paths";
      const prev = Array.isArray(currentSkills[key]) ? currentSkills[key].map((value: unknown) => String(value || "")).filter(Boolean) : [];
      const next = Array.from(new Set([...prev, source]));
      await invoke("patch_opencode_server_config", {
        repoPath: requestRepoPath,
        patch: { skills: { ...currentSkills, [key]: next } }
      });
      setOpencodeSkillSourceInput("");
      await refreshOpencodeSkills();
      setMessageRef.current(`Skill source added: ${source}`);
    } catch (error) {
      const message = String(error);
      setOpencodeSkillsError(message);
      setErrorRef.current(message);
    } finally {
      setOpencodeSkillBusy(false);
    }
  }

  return {
    opencodeSkills,
    opencodeSkillsLoading,
    opencodeSkillsLoadedOnce,
    opencodeSkillsError,
    opencodeSkillInstallSpec,
    setOpencodeSkillInstallSpec,
    opencodeSkillInstallScope,
    setOpencodeSkillInstallScope,
    opencodeSkillInstallingSpec,
    opencodeSkillInstallNotice,
    opencodeSkillInstallLog,
    opencodeSkillListFilter,
    setOpencodeSkillListFilter,
    opencodeSkillListQuery,
    setOpencodeSkillListQuery,
    opencodeSkillSourceInput,
    setOpencodeSkillSourceInput,
    opencodeSkillSourceKind,
    setOpencodeSkillSourceKind,
    opencodeSkillBusy,
    opencodeSkillRemovingKey,
    groupedOpencodeSkills,
    filteredOpencodeSkills,
    skillsByRepoRef,
    setOpencodeSkills,
    setOpencodeSkillsLoadedOnce,
    setOpencodeSkillsLoading,
    setOpencodeSkillsError,
    setOpencodeSkillRemovingKey,
    restoreCachedSkillsForRepo,
    refreshOpencodeSkills,
    installOpencodeSkillFromRegistry,
    removeOpencodeSkill,
    removeOpencodeSkillGroup,
    addOpencodeSkillSource
  };
}
