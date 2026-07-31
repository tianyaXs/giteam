import { startTransition, useMemo, useRef, useState } from "react";
import { loadLocalJson, saveLocalJson } from "./localPreferences";
import {
  buildInstalledSkillInfoRows,
  INSTALLED_VIA_SKILLS_DESCRIPTION,
  normalizeInstalledAgentSkills,
  reconcilePendingSkillInstallGroups,
  type AgentInstalledSkillGroup,
  type AgentSkillInfo,
  type PendingSkillInstallGroup
} from "./agentSkillData";
import { quoteShellArg, skillSourceGroupFromSpec } from "./agentSkillMarketplace";
import { invoke } from "./platform";

const AGENT_SKILL_SOURCE_GROUPS_KEY = "giteam.agent.skill-source-groups.v1";
const GITEAM_BUILTIN_SKILL_PREFIX = "giteam-builtin:";

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
  });
}

function buildInstalledSkillRemovePaths(skills: AgentSkillInfo[]): string[] {
  return Array.from(new Set(
    skills
      .map((skill) => String(skill.path || "").trim())
      .filter(Boolean)
  ));
}

type UseAgentInstalledSkillsInput = {
  repoPath: string;
  skillsVisible: boolean;
  ensureRepoSelected: () => boolean;
  appendDebugLog: (text: string) => void;
  setMessage: (value: string) => void;
  setError: (value: string) => void;
  runCommandInTerminalModule: (command: string) => Promise<void>;
};

export function useAgentInstalledSkills(input: UseAgentInstalledSkillsInput) {
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

  const [agentSkills, setAgentSkills] = useState<AgentSkillInfo[]>([]);
  const [agentSkillsLoading, setAgentSkillsLoading] = useState(false);
  const [agentSkillsLoadedOnce, setAgentSkillsLoadedOnce] = useState(false);
  const [agentSkillsError, setAgentSkillsError] = useState("");
  const [agentSkillInstallSpec, setAgentSkillInstallSpec] = useState("");
  const [agentSkillInstallScope, setAgentSkillInstallScope] = useState<"project" | "global">("project");
  const [agentSkillInstallingSpec, setAgentSkillInstallingSpec] = useState("");
  const [agentSkillInstallNotice, setAgentSkillInstallNotice] = useState("");
  const [agentSkillInstallLog, setAgentSkillInstallLog] = useState("");
  const [agentSkillListFilter, setAgentSkillListFilter] = useState<"all" | "global" | "project" | "source">("all");
  const [agentSkillListQuery, setAgentSkillListQuery] = useState("");
  const [agentSkillSourceInput, setAgentSkillSourceInput] = useState("");
  const [agentSkillSourceKind, setAgentSkillSourceKind] = useState<"url" | "path">("url");
  const [agentSkillBusy, setAgentSkillBusy] = useState(false);
  const [agentSkillRemovingKey, setAgentSkillRemovingKey] = useState("");

  const skillsByRepoRef = useRef<Record<string, AgentSkillInfo[]>>({});
  const skillSourceGroupsRef = useRef<Record<string, string>>(loadLocalJson<Record<string, string>>(AGENT_SKILL_SOURCE_GROUPS_KEY, {}));
  const pendingSkillInstallGroupsRef = useRef<Record<string, PendingSkillInstallGroup[]>>({});

  const filteredAgentSkills = useMemo(() => {
    const query = agentSkillListQuery.trim().toLowerCase();
    return agentSkills.filter((skill) => {
      const scope = skill.scope || "source";
      if (agentSkillListFilter !== "all" && scope !== agentSkillListFilter) return false;
      if (!query) return true;
      return [skill.name, skill.description, skill.path, skill.location]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [agentSkills, agentSkillListFilter, agentSkillListQuery]);

  const groupedAgentSkills = useMemo<AgentInstalledSkillGroup[]>(() => {
    const groups = new Map<string, AgentSkillInfo[]>();
    filteredAgentSkills.forEach((skill) => {
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
  }, [filteredAgentSkills]);

  function restoreCachedSkillsForRepo(targetRepoPath: string, options: { resetFilter?: boolean } = {}) {
    const cached = skillsByRepoRef.current[targetRepoPath] || null;
    startTransition(() => {
      if (cached) setAgentSkills(cached);
      setAgentSkillsLoadedOnce(Boolean(cached));
      setAgentSkillsLoading(!cached);
      setAgentSkillsError("");
      if (options.resetFilter) setAgentSkillListQuery("");
      setAgentSkillRemovingKey("");
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
    saveLocalJson(AGENT_SKILL_SOURCE_GROUPS_KEY, nextMap);
  }

  async function refreshAgentSkills() {
    const requestRepoPath = repoPathRef.current.trim();
    if (!requestRepoPath) return;
    startTransition(() => {
      setAgentSkillsLoading(true);
      setAgentSkillsError("");
    });
    await waitForPaint();
    try {
      const installedRaw = await invoke<unknown>("list_installed_agent_skills", { repoPath: requestRepoPath }).catch(() => []);
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      const installedRows = normalizeInstalledAgentSkills(installedRaw);
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
          saveLocalJson(AGENT_SKILL_SOURCE_GROUPS_KEY, reconciled.sourceGroupMap);
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
        void invoke("save_agent_skill_source_groups", { repoPath: requestRepoPath, entries: sourceGroupEntries }).catch(() => null);
      }
      // PR7：pi 目录下的 MCP manifest 同步归 PR8，此处不再触发 opencode.jsonc 写入。
      const rows = buildInstalledSkillInfoRows(installedRows, sourceGroupMap);
      skillsByRepoRef.current[requestRepoPath] = rows;
      startTransition(() => {
        setAgentSkills(rows.sort((a, b) => (a.scope || "").localeCompare(b.scope || "") || a.name.localeCompare(b.name)));
      });
    } catch (error) {
      if (repoPathRef.current.trim() !== requestRepoPath) return;
      const message = String(error);
      startTransition(() => setAgentSkillsError(message));
      appendDebugLogRef.current(`skill.list.error ${message}`);
    } finally {
      if (repoPathRef.current.trim() === requestRepoPath) {
        startTransition(() => {
          setAgentSkillsLoadedOnce(true);
          setAgentSkillsLoading(false);
        });
      }
    }
  }

  async function installAgentSkillFromRegistry(
    specArg = agentSkillInstallSpec,
    scopeArg: "project" | "global" = agentSkillInstallScope
  ) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    const primarySpec = specArg.trim();
    if (!primarySpec) {
      setErrorRef.current("请输入 skills.sh 条目，例如 vercel-labs/skills/find-skills");
      return;
    }
    const groupName = skillSourceGroupFromSpec(primarySpec);
    const beforePaths = agentSkills
      .filter((skill) => (skill.scope || "project") === scopeArg)
      .map((skill) => String(skill.path || ""))
      .filter(Boolean);
    if (primarySpec.startsWith(GITEAM_BUILTIN_SKILL_PREFIX)) {
      const skillId = primarySpec.slice(GITEAM_BUILTIN_SKILL_PREFIX.length).trim();
      if (!skillId) {
        setErrorRef.current("内置 Skill 缺少标识。");
        return;
      }
      setAgentSkillBusy(true);
      setAgentSkillInstallingSpec(primarySpec);
      setAgentSkillInstallNotice("");
      setAgentSkillInstallLog(`Installing built-in skill: ${skillId}`);
      setAgentSkillsError("");
      setAgentSkillInstallSpec("");
      try {
        const result: any = await invoke("install_builtin_agent_skill", {
          repoPath: requestRepoPath,
          skillId,
          global: scopeArg === "global"
        });
        const installedPath = String(result?.path || "");
        if (installedPath) {
          skillSourceGroupsRef.current = {
            ...skillSourceGroupsRef.current,
            [installedPath]: groupName || skillId
          };
          saveLocalJson(AGENT_SKILL_SOURCE_GROUPS_KEY, skillSourceGroupsRef.current);
          void invoke("save_agent_skill_source_groups", {
            repoPath: requestRepoPath,
            entries: [{ path: installedPath, scope: scopeArg, sourceGroup: groupName || skillId }]
          }).catch(() => null);
        }
        await refreshAgentSkills();
        setAgentSkillInstallLog(`Installed built-in skill: ${skillId}`);
        setMessageRef.current(`Skill installed: ${skillId}`);
      } catch (error) {
        const message = String(error);
        setAgentSkillsError(message);
        setErrorRef.current(message);
        setAgentSkillInstallLog(message);
      } finally {
        setAgentSkillBusy(false);
        setAgentSkillInstallingSpec("");
      }
      return;
    }
    pendingSkillInstallGroupsRef.current[requestRepoPath] = [
      ...(pendingSkillInstallGroupsRef.current[requestRepoPath] || []),
      { groupName: groupName || primarySpec, scope: scopeArg, beforePaths }
    ];
    const globalFlag = scopeArg === "global" ? " -g" : "";
    const command = `SKILLS_CLONE_TIMEOUT_MS=600000 npx -y skills add ${quoteShellArg(primarySpec)} --agent pi -y${globalFlag}`;
    setAgentSkillBusy(false);
    setAgentSkillInstallingSpec("");
    setAgentSkillInstallNotice("");
    setAgentSkillInstallLog("");
    setAgentSkillsError("");
    setAgentSkillInstallSpec("");
    appendDebugLogRef.current(`skill.install.terminal ${primarySpec} scope=${scopeArg} agent=pi`);
    setMessageRef.current(`已切到终端执行 Skill 安装: ${primarySpec}（写入 .pi/skills，安装完成后可被 pi 运行时加载）`);
    await runCommandInTerminalModuleRef.current(command);
    [6000, 15000, 30000].forEach((delay) => {
      window.setTimeout(() => void refreshAgentSkills(), delay);
    });
  }

  async function removeAgentSkill(skill: AgentSkillInfo) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    const scope = skill.scope || "source";
    const key = `${scope}:${skill.name}:${skill.path || skill.location || ""}`;
    const removablePaths = buildInstalledSkillRemovePaths([skill]);
    if (removablePaths.length === 0) {
      setAgentSkillsError("缺少可删除的技能路径。");
      return;
    }
    setAgentSkillRemovingKey(key);
    setAgentSkillsError("");
    try {
      const result = await invoke<any>("remove_installed_agent_skills_by_path", { repoPath: requestRepoPath, paths: removablePaths });
      pruneRemovedSkillSourceGroups(Array.isArray(result?.removed) ? result.removed.map((item: unknown) => String(item || "")) : removablePaths);
      await refreshAgentSkills();
      setMessageRef.current(`Skill removed: ${skill.name}`);
    } catch (error) {
      const message = String(error);
      setAgentSkillsError(message);
      setErrorRef.current(message);
    } finally {
      setAgentSkillRemovingKey("");
    }
  }

  async function removeAgentSkillGroup(group: AgentInstalledSkillGroup) {
    if (!ensureRepoSelectedRef.current()) return;
    const requestRepoPath = repoPathRef.current.trim();
    if (group.removableItems.length === 0) {
      setAgentSkillsError("该目录下没有可删除的已安装项。");
      return;
    }
    setAgentSkillsError("");
    try {
      const removeKeys = group.removableItems.map((skill) => `${skill.scope || "source"}:${skill.name}:${skill.path || skill.location || ""}`);
      const removablePaths = buildInstalledSkillRemovePaths(group.removableItems);
      if (removablePaths.length === 0) throw new Error("该目录下没有可删除的技能路径。");
      setAgentSkillRemovingKey(removeKeys[0] || "");
      const result = await invoke<any>("remove_installed_agent_skills_by_path", { repoPath: requestRepoPath, paths: removablePaths });
      pruneRemovedSkillSourceGroups(Array.isArray(result?.removed) ? result.removed.map((item: unknown) => String(item || "")) : removablePaths);
      await refreshAgentSkills();
      setMessageRef.current(`Skill group removed: ${group.name}`);
    } catch (error) {
      const message = String(error);
      setAgentSkillsError(message);
      setErrorRef.current(message);
    } finally {
      setAgentSkillRemovingKey("");
    }
  }

  async function addAgentSkillSource() {
    // pi 没有 opencode 式的 skills.urls/paths 配置；来源直接按第三方 skill 安装进 .pi/skills。
    const source = agentSkillSourceInput.trim();
    if (!source) return;
    setAgentSkillSourceInput("");
    await installAgentSkillFromRegistry(source, agentSkillInstallScope);
  }

  return {
    agentSkills,
    agentSkillsLoading,
    agentSkillsLoadedOnce,
    agentSkillsError,
    agentSkillInstallSpec,
    setAgentSkillInstallSpec,
    agentSkillInstallScope,
    setAgentSkillInstallScope,
    agentSkillInstallingSpec,
    agentSkillInstallNotice,
    agentSkillInstallLog,
    agentSkillListFilter,
    setAgentSkillListFilter,
    agentSkillListQuery,
    setAgentSkillListQuery,
    agentSkillSourceInput,
    setAgentSkillSourceInput,
    agentSkillSourceKind,
    setAgentSkillSourceKind,
    agentSkillBusy,
    agentSkillRemovingKey,
    groupedAgentSkills,
    filteredAgentSkills,
    skillsByRepoRef,
    setAgentSkills,
    setAgentSkillsLoadedOnce,
    setAgentSkillsLoading,
    setAgentSkillsError,
    setAgentSkillRemovingKey,
    restoreCachedSkillsForRepo,
    refreshAgentSkills,
    installAgentSkillFromRegistry,
    removeAgentSkill,
    removeAgentSkillGroup,
    addAgentSkillSource
  };
}
