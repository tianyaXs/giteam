import { invoke } from "./platform";

export type OpencodeSkillSearchResult = {
  spec: string;
  package: string;
  skill: string;
  installs: string;
  url: string;
  id?: string;
  source?: string;
  sourceType?: string;
  installSpec?: string | null;
  installUrl?: string | null;
  isDuplicate?: boolean;
  change?: number;
  installsYesterday?: number;
};

export type RecommendedSkill = {
  spec: string;
  title: string;
  source: string;
  installs: string;
  tone: string;
  description: string;
};

export type SkillsMarketplaceCategory = {
  group: string;
  slug: string;
  label: string;
  count: string;
};

export const OPENCODE_RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    spec: "anthropics/skills@frontend-design",
    title: "Frontend Design",
    source: "anthropics/skills",
    installs: "385K+",
    tone: "生产级界面",
    description: "让 OpenCode 先确定明确美学方向，再处理字体、色彩、动效和空间构图，避免通用 AI UI。"
  },
  {
    spec: "vercel-labs/agent-skills@web-design-guidelines",
    title: "Web Guidelines",
    source: "vercel-labs/agent-skills",
    installs: "305K+",
    tone: "Vercel 规范",
    description: "适合打磨 Web 界面的间距、层级、交互和可访问性，让组件更像成熟产品。"
  },
  {
    spec: "leonxlnx/taste-skill@design-taste-frontend",
    title: "Design Taste",
    source: "leonxlnx/taste-skill",
    installs: "47K+",
    tone: "高审美约束",
    description: "强约束反套路设计，偏 React/Next/Tailwind，高级视觉和动效规则更激进。"
  },
  { spec: "vercel-labs/skills@find-skills", title: "Find Skills", source: "vercel-labs/skills", installs: "1.4M", tone: "Discovery", description: "搜索和安装代理能力的基础 Skill。" },
  { spec: "vercel-labs/agent-skills@vercel-react-best-practices", title: "Vercel React Best Practices", source: "vercel-labs/agent-skills", installs: "386K+", tone: "React", description: "Vercel 官方 React 设计和实现规范。" },
  { spec: "microsoft/azure-skills@microsoft-foundry", title: "Microsoft Foundry", source: "microsoft/azure-skills", installs: "303K+", tone: "Azure", description: "Microsoft Foundry 与 Azure agent workflows。" },
  { spec: "remotion-dev/skills@remotion-best-practices", title: "Remotion Best Practices", source: "remotion-dev/skills", installs: "299K+", tone: "Video", description: "Remotion 项目结构、渲染和动画最佳实践。" },
  { spec: "microsoft/azure-skills@azure-messaging", title: "Azure Messaging", source: "microsoft/azure-skills", installs: "291K+", tone: "Messaging", description: "Azure 消息队列和事件驱动架构能力。" },
  { spec: "vercel-labs/agent-browser@agent-browser", title: "Agent Browser", source: "vercel-labs/agent-browser", installs: "257K+", tone: "Browser", description: "浏览器自动化和网页上下文工作流。" },
  { spec: "microsoft/azure-skills@azure-hosted-copilot-sdk", title: "Azure Hosted Copilot SDK", source: "microsoft/azure-skills", installs: "274K+", tone: "Azure", description: "Azure hosted Copilot SDK workflows。" },
  { spec: "vercel-labs/agent-skills@next-js-development", title: "Next.js Development", source: "vercel-labs/agent-skills", installs: "245K+", tone: "Next.js", description: "Next.js app router、部署和组件最佳实践。" },
  { spec: "browser-use/browser-use@browser-use", title: "Browser Use", source: "browser-use/browser-use", installs: "188K+", tone: "Browser", description: "基于视觉理解的浏览器自动化。" },
  { spec: "anthropics/skills@skill-creator", title: "Skill Creator", source: "anthropics/skills", installs: "164K+", tone: "Authoring", description: "创建、测试和发布新的 agent skills。" },
  { spec: "vercel-labs/agent-skills@typescript-best-practices", title: "TypeScript Best Practices", source: "vercel-labs/agent-skills", installs: "141K+", tone: "TypeScript", description: "TypeScript 项目结构、类型设计和质量实践。" },
  { spec: "vercel-labs/agent-skills@accessibility", title: "Accessibility", source: "vercel-labs/agent-skills", installs: "128K+", tone: "A11y", description: "Web 可访问性审查和实现规范。" },
  { spec: "supabase/supabase@supabase", title: "Supabase", source: "supabase/supabase", installs: "120K+", tone: "Database", description: "Supabase 数据库、认证和边缘函数工作流。" },
  { spec: "vercel-labs/agent-skills@testing", title: "Testing", source: "vercel-labs/agent-skills", installs: "118K+", tone: "Testing", description: "单元测试、组件测试和端到端测试实践。" },
  { spec: "vercel-labs/agent-skills@tailwind-css", title: "Tailwind CSS", source: "vercel-labs/agent-skills", installs: "103K+", tone: "CSS", description: "Tailwind 样式组织和设计系统实践。" },
  { spec: "expo/skills@react-native", title: "React Native", source: "expo/skills", installs: "94K+", tone: "Mobile", description: "React Native / Expo 架构和跨平台实践。" },
  { spec: "vercel-labs/agent-skills@playwright", title: "Playwright", source: "vercel-labs/agent-skills", installs: "86K+", tone: "E2E", description: "Playwright E2E 测试和稳定性策略。" },
  { spec: "obra/superpowers@systematic-debugging", title: "Systematic Debugging", source: "obra/superpowers", installs: "73K+", tone: "Debug", description: "假设驱动的调试循环。" },
  { spec: "obra/superpowers@brainstorming", title: "Brainstorming", source: "obra/superpowers", installs: "66K+", tone: "Thinking", description: "结构化创意和问题拆解。" },
  { spec: "vercel-labs/agent-skills@docker", title: "Docker", source: "vercel-labs/agent-skills", installs: "58K+", tone: "DevOps", description: "容器化、镜像构建和本地开发环境。" },
  { spec: "vercel-labs/agent-skills@code-review", title: "Code Review", source: "vercel-labs/agent-skills", installs: "52K+", tone: "Review", description: "代码审查、风险识别和回归检查。" }
];

export const SKILLSMP_CATEGORIES: SkillsMarketplaceCategory[] = [
  { group: "Development", slug: "frontend", label: "Frontend", count: "26K" },
  { group: "Development", slug: "backend", label: "Backend", count: "27K" },
  { group: "Development", slug: "full-stack", label: "Full Stack", count: "11K" },
  { group: "Development", slug: "mobile", label: "Mobile", count: "14K" },
  { group: "Development", slug: "architecture-patterns", label: "Architecture", count: "46K" },
  { group: "Testing", slug: "testing", label: "Testing", count: "40K" },
  { group: "Testing", slug: "code-quality", label: "Code Quality", count: "56K" },
  { group: "Testing", slug: "security", label: "Security", count: "33K" },
  { group: "Tools", slug: "debugging", label: "Debugging", count: "134K" },
  { group: "Tools", slug: "automation-tools", label: "Automation", count: "20K" },
  { group: "Tools", slug: "productivity-tools", label: "Productivity", count: "64K" },
  { group: "Tools", slug: "cli-tools", label: "CLI Tools", count: "7K" },
  { group: "Data AI", slug: "llm-ai", label: "LLM / AI", count: "68K" },
  { group: "Data AI", slug: "machine-learning", label: "Machine Learning", count: "22K" },
  { group: "Data AI", slug: "data-analysis", label: "Data Analysis", count: "9K" },
  { group: "DevOps", slug: "git-workflows", label: "Git Workflows", count: "55K" },
  { group: "DevOps", slug: "cicd", label: "CI/CD", count: "26K" },
  { group: "DevOps", slug: "cloud", label: "Cloud", count: "11K" },
  { group: "Docs", slug: "technical-docs", label: "Technical Docs", count: "30K" },
  { group: "Docs", slug: "knowledge-base", label: "Knowledge Base", count: "33K" },
  { group: "Business", slug: "sales-marketing", label: "Sales Marketing", count: "120K" },
  { group: "Business", slug: "project-management", label: "Project Mgmt", count: "47K" },
  { group: "Content", slug: "design", label: "Design", count: "9K" },
  { group: "Content", slug: "content-creation", label: "Content", count: "19K" }
];

export function formatSkillInstalls(value: unknown): string {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export function parseSkillInstallCount(value: unknown): number {
  const raw = String(value || "").trim().toUpperCase().replace(/\+/g, "").replace(/,/g, "");
  const match = raw.match(/([\d.]+)\s*([KM])?/);
  if (!match) return 0;
  const base = Number(match[1] || 0);
  if (!Number.isFinite(base)) return 0;
  if (match[2] === "M") return base * 1_000_000;
  if (match[2] === "K") return base * 1_000;
  return base;
}

export function isTrustedSkillSource(source: unknown): boolean {
  const normalized = String(source || "").toLowerCase();
  return ["vercel-labs", "anthropics", "microsoft", "expo", "supabase", "remotion-dev"]
    .some((prefix) => normalized.startsWith(prefix));
}

export function skillQualityLabel(
  skill: Pick<OpencodeSkillSearchResult, "source" | "package" | "installs">
): "trusted" | "popular" | "review" {
  if (isTrustedSkillSource(skill.source || skill.package)) return "trusted";
  if (parseSkillInstallCount(skill.installs) >= 1000) return "popular";
  return "review";
}

export function expandSkillSearchQueries(query: string): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const terms = new Set<string>([normalizedQuery]);
  const aliases: Array<[RegExp, string[]]> = [
    [/\breact\b/, ["react best practices", "react performance", "nextjs react"]],
    [/\bfrontend|ui|design\b/, ["frontend design", "web design", "design system", "accessibility"]],
    [/\btest|testing|jest|playwright\b/, ["testing", "unit testing", "e2e testing", "playwright"]],
    [/\bdeploy|deployment|ci\b/, ["deployment", "ci cd", "docker deploy"]],
    [/\bdocs|documentation|readme\b/, ["documentation", "readme", "api docs"]],
    [/\breview|lint|refactor\b/, ["code review", "lint", "refactor", "best practices"]],
    [/\bmobile|native\b/, ["react native", "expo", "mobile testing"]]
  ];
  for (const [pattern, values] of aliases) {
    if (pattern.test(normalizedQuery)) values.forEach((value) => terms.add(value));
  }
  return Array.from(terms).filter(Boolean).slice(0, 3);
}

export function opencodeSkillApiToResult(item: any): OpencodeSkillSearchResult | null {
  const id = String(item?.id || "").trim();
  const source = String(item?.source || (id ? id.split("/").slice(0, -1).join("/") : "")).trim();
  const slug = String(item?.slug || (id ? id.split("/").pop() : "")).trim();
  const name = String(item?.name || slug || id).trim();
  if (!source || !slug || !name) return null;
  return {
    id: id || `${source}/${slug}`,
    spec: `${source}@${slug}`,
    package: source,
    skill: name,
    installs: formatSkillInstalls(item?.installs),
    url: String(item?.url || ""),
    source,
    sourceType: String(item?.sourceType || ""),
    installUrl: item?.installUrl ? String(item.installUrl) : null,
    isDuplicate: Boolean(item?.isDuplicate),
    change: typeof item?.change === "number" ? item.change : undefined,
    installsYesterday: typeof item?.installsYesterday === "number" ? item.installsYesterday : undefined
  };
}

export function skillsmpSkillToResult(item: any): OpencodeSkillSearchResult | null {
  const name = String(item?.name || "").trim();
  const githubUrl = String(item?.githubUrl || "").trim();
  const skillUrl = String(item?.skillUrl || "").trim();
  const author = String(item?.author || "").trim();
  if (!name) return null;
  const source = (() => {
    try {
      const url = new URL(githubUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : author;
    } catch {
      return author;
    }
  })();
  return {
    id: String(item?.id || `${source}/${name}`),
    spec: source ? `${source}@${name}` : name,
    package: source || author,
    skill: name,
    installs: formatSkillInstalls(item?.stars || 0),
    url: skillUrl,
    source: source || author,
    sourceType: "skillsmp",
    installSpec: source || null,
    installUrl: githubUrl || null
  };
}

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function getSkillsMarketplaceSeedQuery(categorySlug: string): string {
  const slug = categorySlug.trim().toLowerCase();
  if (!slug) return "agent";
  const seedBySlug: Record<string, string> = {
    frontend: "frontend",
    backend: "backend",
    "full-stack": "full stack",
    mobile: "mobile",
    "architecture-patterns": "architecture",
    testing: "testing",
    "code-quality": "code quality",
    security: "security",
    debugging: "debugging",
    "automation-tools": "automation",
    "productivity-tools": "productivity",
    "cli-tools": "cli",
    "llm-ai": "ai",
    "machine-learning": "machine learning",
    "data-analysis": "data analysis",
    "git-workflows": "git",
    cicd: "ci cd",
    cloud: "cloud",
    "technical-docs": "documentation",
    "knowledge-base": "knowledge base",
    "sales-marketing": "marketing",
    "project-management": "project management",
    design: "design",
    "content-creation": "content"
  };
  return seedBySlug[slug] || slug.replace(/-/g, " ");
}

export function getSkillAvatarLabel(skillName: string): string {
  const parts = skillName
    .trim()
    .split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/)
    .filter(Boolean);
  if (parts.length === 0) return "SK";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || "S"}${parts[1][0] || "K"}`.toUpperCase();
}

export function isInstalledOpencodeSkill(item: { path?: string; agents?: string[] }): boolean {
  const normalizedPath = String(item.path || "").replace(/\\/g, "/");
  const isInstalledDir = normalizedPath.includes("/.agents/skills/") || normalizedPath.includes("/.opencode/skills/");
  const agents = Array.isArray(item.agents) ? item.agents : [];
  const targetsOpencode = agents.length === 0 || agents.some((agent) => agent.toLowerCase() === "opencode");
  return isInstalledDir && targetsOpencode;
}

export function skillSourceGroupFromSpec(spec: string): string {
  const trimmed = spec.trim();
  if (!trimmed) return "";
  const [pkg] = trimmed.split("@");
  return (pkg || trimmed).trim();
}

export async function fetchSkillsmpJson(endpoint: string, apiKey = "", timeoutMs = 12000): Promise<any> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const resp = await fetch(`https://skillsmp.com${endpoint}`, { headers, signal: controller.signal });
    if (!resp.ok) throw new Error(`SkillsMP HTTP ${resp.status}`);
    const json = await resp.json();
    if (json?.success === false) throw new Error(json?.error?.message || "SkillsMP request failed");
    return json;
  } finally {
    window.clearTimeout(timer);
  }
}

export function buildSkillsmpSearchEndpoint(input: {
  query: string;
  page?: number;
  limit?: number;
  sortBy?: "stars" | "recent";
  category?: string;
  occupation?: string;
}): string {
  const params = new URLSearchParams({
    q: input.query,
    page: String(input.page || 1),
    limit: String(input.limit || 100),
    sortBy: input.sortBy || "stars"
  });
  if (input.category?.trim()) params.set("category", input.category.trim());
  if (input.occupation?.trim()) params.set("occupation", input.occupation.trim());
  return `/api/v1/skills/search?${params.toString()}`;
}

export async function fetchSkillsmpSearchViaBackend(input: {
  repoPath: string;
  query: string;
  page?: number;
  limit?: number;
  sortBy?: "stars" | "recent";
  category?: string;
  occupation?: string;
  apiKey?: string;
}): Promise<unknown> {
  return invoke<unknown>("fetch_skillsmp_skill_search", input);
}

export async function fetchSkillsmpAiViaBackend(input: {
  repoPath: string;
  query: string;
  apiKey?: string;
}): Promise<unknown> {
  return invoke<unknown>("fetch_skillsmp_ai_search", input);
}
