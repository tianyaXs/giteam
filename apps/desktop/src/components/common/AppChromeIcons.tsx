import gitTreeIconUrl from "../../../gittree.png";

export type RightPaneTab = "worktree" | "changes" | "terminal" | "skills" | "mcp";

export function PanelToggleIcon(props: { side: "left" | "right"; collapsed: boolean }) {
  const dividerX = props.side === "left" ? 9 : 15;
  const hiddenPanelX = props.side === "left" ? 4 : 12;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d={`M${dividerX} 6.5V17.5`} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      {props.collapsed ? <rect x={hiddenPanelX} y="6.5" width="5" height="11" rx="1.5" fill="currentColor" opacity="0.16" /> : null}
    </svg>
  );
}

export function SendIcon(props: { busy: boolean }) {
  return props.busy ? (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="5.5" width="13" height="13" rx="3" fill="currentColor" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5V16.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /><path d="M7 10L12 4.5L17 10" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  );
}

export function RightPaneTabIcon(props: { tab: RightPaneTab; active: boolean }) {
  const stroke = props.active ? "currentColor" : "currentColor";
  if (props.tab === "worktree") {
    return <img className="gt-right-tab-img" src={gitTreeIconUrl} alt="" aria-hidden="true" />;
  }
  if (props.tab === "changes") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7H19" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" /><path d="M8 12H19" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" /><path d="M8 17H19" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinecap="round" /><circle cx="5" cy="7" r="1.2" fill="currentColor" /><circle cx="5" cy="12" r="1.2" fill="currentColor" /><circle cx="5" cy="17" r="1.2" fill="currentColor" /></svg>;
  }
  if (props.tab === "terminal") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5H19.5V18.5H4.5V5.5Z" fill="none" stroke={stroke} strokeWidth="1.6" /><path d="M8 10L10.6 12L8 14" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M13 14H16" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" /></svg>;
  }
  if (props.tab === "skills") {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2.8L5.8 13H11L9.8 21.2L18.2 10H13L13 2.8Z" fill="none" stroke={stroke} strokeWidth="1.7" strokeLinejoin="round" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 8V5.5C8.5 4.7 9.2 4 10 4S11.5 4.7 11.5 5.5V8" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" /><path d="M12.5 8V5.5C12.5 4.7 13.2 4 14 4S15.5 4.7 15.5 5.5V8" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" /><path d="M7 8H17V12.5C17 15.3 14.8 17.5 12 17.5S7 15.3 7 12.5V8Z" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" /><path d="M12 17.5V21" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" /></svg>;
}
