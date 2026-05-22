import { createPortal } from "react-dom";
import type { McpServerMarketData } from "../../lib/mcpMarket";
import { CloseIcon, PlusIcon, RefreshIcon } from "../icons";
import { McpMarketplace } from "../mcp/McpMarketplace";

export type OpencodeMcpPanelRow = {
  name: string;
  sourceLabel: string;
  typeLabel: string;
  toolsCount: number;
};

export type OpencodeMcpParamSpec = {
  key: string;
  required: boolean;
  description: string;
  example: string;
};

type InstalledMcpGridProps = {
  rows: OpencodeMcpPanelRow[];
  loading: boolean;
  error: string;
  onReferenceMcp: (name: string) => void;
};

export function OpencodeInstalledMcpGrid(props: InstalledMcpGridProps) {
  const { rows, loading, error, onReferenceMcp } = props;

  return (
    <div className="gt-installed-mcp-grid">
      {error ? <div className="gt-module-empty danger">{error}</div> : null}
      {loading ? <div className="gt-module-empty">正在加载 MCP...</div> : null}
      {!loading && rows.length === 0 ? <div className="gt-module-empty">暂无 MCP server。从下方市场安装后会显示在这里。</div> : null}
      {rows.map((row) => (
        <button
          key={row.name}
          type="button"
          className="gt-mcp-installed-chip gt-mcp-installed-chip-use"
          onClick={() => onReferenceMcp(row.name)}
          title={`添加 MCP 引用：use the ${row.name} mcp server`}
        >
          <div className="gt-mcp-installed-main">
            <strong>{row.name}</strong>
            <small>{row.sourceLabel} · {row.typeLabel} · {row.toolsCount} tools</small>
          </div>
        </button>
      ))}
    </div>
  );
}

type SettingsMcpGridProps = {
  rows: OpencodeMcpPanelRow[];
  error: string;
  busyName: string;
  onEditMcp: (name: string) => void;
  onRemoveMcp: (name: string) => void | Promise<void>;
};

export function OpencodeSettingsMcpGrid(props: SettingsMcpGridProps) {
  const { rows, error, busyName, onEditMcp, onRemoveMcp } = props;

  return (
    <div className="settings-skills-manager">
      {error ? <div className="gt-module-empty danger">{error}</div> : null}
      <div className="settings-skills-grid">
        {rows.length === 0 ? <div className="gt-module-empty">暂无已安装 MCP Server。</div> : rows.map((row) => (
          <article key={row.name} className="settings-skill-card">
            <button type="button" className="settings-skill-card-main gt-settings-mcp-card-main" onClick={() => onEditMcp(row.name)}>
              <div className="settings-skill-card-title">
                <strong>{row.name}</strong>
                <span>{row.typeLabel}</span>
              </div>
              <p>{row.sourceLabel} · {row.toolsCount} tools · use {row.name}</p>
            </button>
            <details className="settings-skill-menu">
              <summary aria-label={`${row.name} actions`} title="Actions"><span aria-hidden="true">...</span></summary>
              <div className="settings-skill-menu-panel">
                <button className="settings-mcp-action" type="button" onClick={() => onEditMcp(row.name)}>配置参数</button>
                <button className="settings-skill-remove" type="button" disabled={!!busyName} onClick={() => void onRemoveMcp(row.name)}>
                  {busyName.endsWith(":remove") ? "删除中" : "删除"}
                </button>
              </div>
            </details>
          </article>
        ))}
      </div>
    </div>
  );
}

type CustomMcpDialogProps = {
  name: string;
  json: string;
  paramValues: Record<string, string>;
  busyName: string;
  paramSpecs: OpencodeMcpParamSpec[];
  normalizeConfig: (input: string, fallbackName: string) => { name: string; config: Record<string, unknown> };
  onClose: () => void;
  onNameChange: (value: string) => void;
  onJsonChange: (value: string) => void;
  onParamChange: (key: string, value: string) => void;
  onAdd: () => void | Promise<void>;
};

export function OpencodeCustomMcpDialog(props: CustomMcpDialogProps) {
  const {
    name,
    json,
    paramValues,
    busyName,
    paramSpecs,
    normalizeConfig,
    onClose,
    onNameChange,
    onJsonChange,
    onParamChange,
    onAdd
  } = props;

  const customMcpJsonPlaceholder = `{
  "type": "remote",
  "url": "https://mcp.example.com/mcp",
  "enabled": true
}`;
  const previewText = (() => {
    if (!json.trim()) return "粘贴 JSON 后会在这里预览 MCP 类型和连接信息";
    try {
      const { name: previewName, config } = normalizeConfig(json, name);
      if (config.type === "local") return `${previewName} · local · command: ${Array.isArray(config.command) ? config.command.join(" ") : "缺少 command[]"}`;
      if (config.type === "remote") return `${previewName} · remote · url: ${String(config.url || "缺少 url")}`;
      return `${previewName} · ${String(config.type)}`;
    } catch (error) {
      return `JSON 无效：${String(error instanceof Error ? error.message : error)}`;
    }
  })();

  return (
    <div className="gt-mcp-custom-add-popover" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="gt-mcp-custom-add-card" onClick={(event) => event.stopPropagation()}>
        <header className="gt-mcp-custom-add-head">
          <div>
            <span className="gt-module-kicker">custom mcp</span>
            <strong>自定义添加 MCP Server</strong>
            <small>支持 OpenCode MCP 配置、mcpServers 包装、直接 server map 或 marketplace JSON。</small>
          </div>
          <button type="button" className="gt-icon-chip" onClick={onClose} aria-label="关闭自定义添加"><CloseIcon /></button>
        </header>
        <div className="gt-mcp-custom-add-body">
          <div className="gt-mcp-custom-add-editor">
            <div className="gt-mcp-custom-add-strip">
              <span>JSON 会自动识别 name、command/url、env/headers 和必填参数</span>
            </div>
            <label>
              <span>名称</span>
              <input className="path-input" placeholder="名称，例如 context7" value={name} onChange={(event) => onNameChange(event.target.value)} />
            </label>
            <label className="gt-mcp-custom-json-label">
              <span>JSON 配置</span>
              <textarea className="path-input gt-module-textarea gt-mcp-json-input" value={json} placeholder={customMcpJsonPlaceholder} onChange={(event) => onJsonChange(event.target.value)} />
            </label>
          </div>
          <aside className="gt-mcp-custom-add-side">
            <div className="gt-mcp-json-preview">
              <strong>预览</strong>
              <code>{previewText}</code>
            </div>
            {paramSpecs.length > 0 ? (
              <div className="gt-mcp-custom-param-fields">
                <strong>连接参数</strong>
                {paramSpecs.map((spec) => (
                  <label key={spec.key}>
                    <span>{spec.key}{spec.required ? " *" : ""}</span>
                    {spec.description ? <small>{spec.description}</small> : null}
                    <input
                      className="path-input"
                      value={paramValues[spec.key] || ""}
                      placeholder={spec.example || spec.key}
                      onChange={(event) => onParamChange(spec.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            ) : (
              <div className="gt-mcp-custom-add-hint">没有检测到必填参数。添加后会写入当前项目的 OpenCode 配置。</div>
            )}
          </aside>
        </div>
        <footer className="gt-mcp-custom-add-actions">
          <button type="button" className="chip" onClick={onClose}>取消</button>
          <button type="button" className="chip primary" onClick={() => void onAdd()} disabled={!!busyName || !json.trim()}>{busyName ? "添加中..." : "添加 MCP"}</button>
        </footer>
      </section>
    </div>
  );
}

type EditMcpDialogProps = {
  name: string;
  status: Record<string, unknown> | undefined;
  specs: OpencodeMcpParamSpec[];
  tools: Array<{ name?: string; description?: string }>;
  paramValues: Record<string, string>;
  busyName: string;
  onClose: () => void;
  onParamChange: (key: string, value: string) => void;
  onRemove: () => void | Promise<void>;
  onSave: () => void | Promise<void>;
};

export function OpencodeEditMcpDialog(props: EditMcpDialogProps) {
  const { name, status, specs, tools, paramValues, busyName, onClose, onParamChange, onRemove, onSave } = props;
  const state: any = status || {};
  const paramKind = state.type === "remote" ? "Headers" : "Environment";

  return (
    <div className="gt-mcp-config-popover" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="gt-mcp-config-card" onClick={(event) => event.stopPropagation()}>
        <div className="gt-mcp-config-head"><div><span className="gt-module-kicker">update mcp params</span><strong>{name}</strong></div></div>
        <p>更新该 MCP 的 {paramKind} 参数。保存后会写回当前项目的 OpenCode 配置。</p>
        {specs.length === 0 ? <div className="gt-module-empty">这个 MCP 当前没有可编辑参数。</div> : (
          <div className="gt-mcp-config-fields">
            {specs.map((spec) => (
              <label key={spec.key}>
                <span>{spec.key}{spec.required ? " *" : ""}</span>
                {spec.description ? <small>{spec.description}</small> : null}
                <input
                  className="path-input"
                  value={paramValues[spec.key] || ""}
                  placeholder={spec.example || spec.key}
                  onChange={(event) => onParamChange(spec.key, event.target.value)}
                />
              </label>
            ))}
          </div>
        )}
        <div className="gt-mcp-config-tools">
          <div className="gt-mcp-config-tools-head"><strong>工具列表</strong><span>{tools.length} tools</span></div>
          {tools.length === 0 ? (
            <div className="gt-module-empty">暂无工具清单。</div>
          ) : (
            <div className="gt-mcp-config-tool-grid">
              {tools.map((tool) => <div key={tool.name} className="gt-mcp-config-tool-cell"><code>{tool.name}</code><p>{tool.description || "No description"}</p></div>)}
            </div>
          )}
        </div>
        <div className="gt-mcp-config-actions">
          <button type="button" className="chip danger" onClick={() => void onRemove()} disabled={!!busyName}>{busyName.endsWith(":remove") ? "删除中..." : "删除"}</button>
          <button type="button" className="chip primary" onClick={() => void onSave()} disabled={!!busyName || specs.length === 0}>{busyName.endsWith(":update") ? "保存中..." : "保存参数"}</button>
        </div>
      </div>
    </div>
  );
}

type McpMarketPanelProps = {
  rows: OpencodeMcpPanelRow[];
  loading: boolean;
  error: string;
  installedOpen: boolean;
  servers: McpServerMarketData;
  configuredMcpNames: string[];
  onInstalledOpenChange: (open: boolean) => void;
  onShowCustomAdd: () => void;
  onRefresh: () => void | Promise<void>;
  onReferenceMcp: (name: string) => void;
  onAddMcpFromMarket: (name: string, config: Record<string, unknown>) => void | Promise<void>;
};

export function OpencodeMcpMarketPanel(props: McpMarketPanelProps) {
  const {
    rows,
    loading,
    error,
    installedOpen,
    servers,
    configuredMcpNames,
    onInstalledOpenChange,
    onShowCustomAdd,
    onRefresh,
    onReferenceMcp,
    onAddMcpFromMarket
  } = props;

  return (
    <div className="gt-skill-market-shell gt-mcp-market-shell">
      <details className="gt-installed-skills-collapsible gt-installed-mcp-collapsible" open={installedOpen} onToggle={(event) => onInstalledOpenChange(event.currentTarget.open)}>
        <summary>
          <span>已安装 MCP Servers</span>
          <small>{rows.length}</small>
          <button type="button" className="gt-icon-chip" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onShowCustomAdd(); }} title="自定义添加 MCP Server"><PlusIcon /></button>
          <button type="button" className="gt-icon-chip" onClick={(event) => { event.preventDefault(); void onRefresh(); }} title="刷新" disabled={loading}><RefreshIcon /></button>
        </summary>
        <OpencodeInstalledMcpGrid
          rows={rows}
          loading={loading}
          error={error}
          onReferenceMcp={onReferenceMcp}
        />
      </details>
      <McpMarketplace
        servers={servers}
        configuredMcps={configuredMcpNames}
        onAddMcp={onAddMcpFromMarket}
      />
    </div>
  );
}

type McpDialogsProps = {
  showCustomAdd: boolean;
  customName: string;
  customJson: string;
  customParamValues: Record<string, string>;
  busyName: string;
  customParamSpecs: OpencodeMcpParamSpec[];
  normalizeConfig: (input: string, fallbackName: string) => { name: string; config: Record<string, unknown> };
  onCloseCustomAdd: () => void;
  onCustomNameChange: (value: string) => void;
  onCustomJsonChange: (value: string) => void;
  onCustomParamChange: (key: string, value: string) => void;
  onAddCustomMcp: () => void | Promise<void>;
  editingName: string;
  editingStatus: Record<string, unknown> | undefined;
  editingSpecs: OpencodeMcpParamSpec[];
  editingTools: Array<{ name?: string; description?: string }>;
  editingParamValues: Record<string, string>;
  onCloseEditing: () => void;
  onEditingParamChange: (key: string, value: string) => void;
  onRemoveEditingMcp: () => void | Promise<void>;
  onSaveEditingMcp: () => void | Promise<void>;
};

export function OpencodeMcpDialogs(props: McpDialogsProps) {
  const {
    showCustomAdd,
    customName,
    customJson,
    customParamValues,
    busyName,
    customParamSpecs,
    normalizeConfig,
    onCloseCustomAdd,
    onCustomNameChange,
    onCustomJsonChange,
    onCustomParamChange,
    onAddCustomMcp,
    editingName,
    editingStatus,
    editingSpecs,
    editingTools,
    editingParamValues,
    onCloseEditing,
    onEditingParamChange,
    onRemoveEditingMcp,
    onSaveEditingMcp
  } = props;

  if (typeof document === "undefined") return null;

  return (
    <>
      {showCustomAdd ? createPortal(
        <OpencodeCustomMcpDialog
          name={customName}
          json={customJson}
          paramValues={customParamValues}
          busyName={busyName}
          paramSpecs={customParamSpecs}
          normalizeConfig={normalizeConfig}
          onClose={onCloseCustomAdd}
          onNameChange={onCustomNameChange}
          onJsonChange={onCustomJsonChange}
          onParamChange={onCustomParamChange}
          onAdd={onAddCustomMcp}
        />,
        document.body
      ) : null}

      {editingName ? createPortal(
        <OpencodeEditMcpDialog
          name={editingName}
          status={editingStatus}
          specs={editingSpecs}
          tools={editingTools}
          paramValues={editingParamValues}
          busyName={busyName}
          onClose={onCloseEditing}
          onParamChange={onEditingParamChange}
          onRemove={onRemoveEditingMcp}
          onSave={onSaveEditingMcp}
        />,
        document.body
      ) : null}
    </>
  );
}
