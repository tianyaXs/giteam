/** Pi session.rs COMPACTION_SUMMARY_* — 模型上下文用，UI 不应展示全文。 */
const COMPACTION_SUMMARY_BLOCK_RE =
  /\n*The conversation history before this point was compacted into the following summary:\n\n<summary>\n[\s\S]*?\n<\/summary>\n*/g;

/** Pi session.rs BRANCH_SUMMARY_* */
const BRANCH_SUMMARY_BLOCK_RE =
  /\n*The following is a summary of a branch that this conversation came back from:\n\n<summary>\n[\s\S]*?<\/summary>\n*/g;

function collapseWhitespace(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export function isCompactionSummaryUserText(content: string): boolean {
  const trimmed = String(content || '').trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('The conversation history before this point was compacted into the following summary:')
    || (trimmed.includes('compacted into the following summary') && trimmed.includes('<summary>'))
  );
}

export function stripInjectedSessionSummaryBlocks(content: string): string {
  let value = String(content || '');
  value = value.replace(COMPACTION_SUMMARY_BLOCK_RE, '\n');
  value = value.replace(BRANCH_SUMMARY_BLOCK_RE, '\n');
  return collapseWhitespace(value);
}
