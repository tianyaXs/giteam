/** Validate a service base URL while keeping credentials out of client settings. */
export function normalizeRemoteRepoServiceUrl(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith("/")) {
    if (value.startsWith("//")) throw new Error("服务地址必须是 http(s) URL 或同源路径。");
    return value.replace(/\/+$/, "") || "/";
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("请输入有效的 http 或 https 服务地址。");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("服务地址仅支持 http 或 https。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("服务地址不能包含用户名、密码、查询参数或片段。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function resolveRemoteRepoServiceBase(configuredUrl: string, environmentUrl: string): string {
  const configured = normalizeRemoteRepoServiceUrl(configuredUrl);
  if (configured) return configured;
  const environment = normalizeRemoteRepoServiceUrl(environmentUrl);
  return environment || "/remote-repo-service";
}
