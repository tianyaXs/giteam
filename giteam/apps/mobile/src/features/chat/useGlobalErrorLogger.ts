import { useEffect, useRef } from 'react';
import { toText } from '../../lib/text';

export function useGlobalErrorLogger(params: {
  pushConnLog: (message: string, level?: 'info' | 'error') => void;
}) {
  const { pushConnLog } = params;
  const pushConnLogRef = useRef(pushConnLog);

  useEffect(() => {
    pushConnLogRef.current = pushConnLog;
  }, [pushConnLog]);

  useEffect(() => {
    const g: any = globalThis as any;
    const ErrorUtilsAny = g?.ErrorUtils as any;
    if (!ErrorUtilsAny?.setGlobalHandler) return;
    const prev = ErrorUtilsAny.getGlobalHandler ? ErrorUtilsAny.getGlobalHandler() : null;
    ErrorUtilsAny.setGlobalHandler((err: any, isFatal?: boolean) => {
      try {
        const fatalText = isFatal ? 'FATAL' : 'NON-FATAL';
        pushConnLogRef.current(`[discover] 全局异常捕获(${fatalText})：${toText(err?.message || err)}`, 'error');
      } catch {
        // keep the previous global handler path alive even if logging fails
      }
      if (typeof prev === 'function') prev(err, isFatal);
    });
    return () => {
      // 还原 handler，避免热重载/多次挂载重复包装。
      if (typeof prev === 'function') ErrorUtilsAny.setGlobalHandler(prev);
    };
  }, []);
}
