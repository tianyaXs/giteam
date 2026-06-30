import { formatPatch, parsePatch, structuredPatch } from 'diff';

export type MobileDiffRow = {
  id: string;
  kind: 'hunk' | 'context' | 'add' | 'delete' | 'note';
  marker: string;
  text: string;
  leftNumber?: number;
  rightNumber?: number;
};

type MobileDiffSource = {
  path: string;
  patch?: string;
  before?: string;
  after?: string;
};

function normalizeCellText(input: string) {
  return input.length > 0 ? input : ' ';
}

function buildPatchText(source: MobileDiffSource) {
  const patch = typeof source.patch === 'string' ? source.patch.trim() : '';
  if (patch) return patch;
  const before = typeof source.before === 'string' ? source.before : '';
  const after = typeof source.after === 'string' ? source.after : '';
  if (!before && !after) return '';
  return formatPatch(structuredPatch(source.path || 'file', source.path || 'file', before, after, '', '', { context: 3 }));
}

function fallbackRows(patch: string) {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith('diff --git') && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++'))
    .map((line, index) => {
      if (line.startsWith('@@')) {
        return { id: `fallback:${index}`, kind: 'hunk' as const, marker: '@@', text: normalizeCellText(line) };
      }
      if (line.startsWith('\\')) {
        return { id: `fallback:${index}`, kind: 'note' as const, marker: '', text: normalizeCellText(line) };
      }
      if (line.startsWith('+')) {
        return { id: `fallback:${index}`, kind: 'add' as const, marker: '+', text: normalizeCellText(line.slice(1)) };
      }
      if (line.startsWith('-')) {
        return { id: `fallback:${index}`, kind: 'delete' as const, marker: '-', text: normalizeCellText(line.slice(1)) };
      }
      return {
        id: `fallback:${index}`,
        kind: 'context' as const,
        marker: ' ',
        text: normalizeCellText(line.startsWith(' ') ? line.slice(1) : line),
      };
    });
}

export function buildMobileDiffRows(source: MobileDiffSource): MobileDiffRow[] {
  const patch = buildPatchText(source);
  if (!patch) return [];
  try {
    const files = parsePatch(patch);
    if (files.length <= 0) return fallbackRows(patch);
    const rows: MobileDiffRow[] = [];
    let rowIndex = 0;
    for (const file of files) {
      for (const hunk of file.hunks) {
        const hunkHeader = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
        rows.push({
          id: `row:${rowIndex++}`,
          kind: 'hunk',
          marker: '@@',
          text: hunkHeader,
        });
        let leftNumber = hunk.oldStart;
        let rightNumber = hunk.newStart;
        for (const line of hunk.lines) {
          if (line.startsWith('@@')) continue;
          if (line.startsWith('\\')) {
            rows.push({
              id: `row:${rowIndex++}`,
              kind: 'note',
              marker: '',
              text: normalizeCellText(line),
            });
            continue;
          }
          if (line.startsWith('+')) {
            rows.push({
              id: `row:${rowIndex++}`,
              kind: 'add',
              marker: '+',
              text: normalizeCellText(line.slice(1)),
              rightNumber,
            });
            rightNumber += 1;
            continue;
          }
          if (line.startsWith('-')) {
            rows.push({
              id: `row:${rowIndex++}`,
              kind: 'delete',
              marker: '-',
              text: normalizeCellText(line.slice(1)),
              leftNumber,
            });
            leftNumber += 1;
            continue;
          }
          rows.push({
            id: `row:${rowIndex++}`,
            kind: 'context',
            marker: ' ',
            text: normalizeCellText(line.startsWith(' ') ? line.slice(1) : line),
            leftNumber,
            rightNumber,
          });
          leftNumber += 1;
          rightNumber += 1;
        }
      }
    }
    return rows.length > 0 ? rows : fallbackRows(patch);
  } catch {
    return fallbackRows(patch);
  }
}
