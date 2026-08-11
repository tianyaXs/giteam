import { useMemo } from 'react';
import { toText } from '../../lib/text';
import type { ModelOption } from '../workspace/catalogUtils';

/** 输入栏短标签：保留可读模型名，不要按 `-` 拆出最后一段（否则 kimi-xxx-luna 会变成 luna）。 */
export function composerModelDisplayLabel(label: string, id?: string): string {
  const raw = toText(label).trim() || toText(id).trim();
  if (!raw) return '模型';
  // 去掉 provider/ 前缀
  let s = raw.includes('/') ? raw.slice(raw.lastIndexOf('/') + 1) : raw;
  s = s.replace(/^openai\+/i, '').trim();
  if (s.length > 18) s = `${s.slice(0, 16)}…`;
  return s || '模型';
}

export function useComposerPresentationState<TMode extends string>(params: {
  model: string;
  modelOptions: ModelOption[];
  modeOptions: Array<{ key: TMode; label: string }>;
}) {
  const {
    model,
    modelOptions,
    modeOptions
  } = params;

  const inputModelLabel = useMemo(() => {
    const selected = modelOptions.find((option) => option.id === model);
    return composerModelDisplayLabel(selected?.label || '', model);
  }, [model, modelOptions]);

  const composerModeOptions = useMemo(() => modeOptions, [modeOptions]);

  return {
    composerModeOptions,
    inputModelLabel
  };
}
