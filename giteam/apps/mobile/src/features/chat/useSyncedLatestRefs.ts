import { useEffect } from 'react';

export function useSyncedLatestRefs(params: {
  refs: Array<{
    ref: React.MutableRefObject<any>;
    value: any;
  }>;
}) {
  const { refs } = params;

  useEffect(() => {
    for (const item of refs) {
      item.ref.current = item.value;
    }
  }, refs.map((item) => item.value));
}
