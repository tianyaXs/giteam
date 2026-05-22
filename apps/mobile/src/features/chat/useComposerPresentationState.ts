import { useMemo } from 'react';
import { toText } from '../../lib/text';
import type { ModelOption } from '../workspace/catalogUtils';

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
    const label = toText(selected?.label || model || 'Model');
    return label.replace(/^openai\//i, '').replace(/^kimi-for-coding\//i, '').slice(0, 18);
  }, [model, modelOptions]);

  const composerModeOptions = useMemo(() => modeOptions, [modeOptions]);

  return {
    composerModeOptions,
    inputModelLabel
  };
}
