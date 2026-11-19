import { useEffect, useRef } from "react";
import {
  mountDeepAgentComposer,
  type DeepAgentComposerOptions
} from "./DeepAgentComposerEngine.js";

type MountedComposer = ReturnType<typeof mountDeepAgentComposer>;

export function DeepAgentComposer({
  options,
  className
}: {
  options?: DeepAgentComposerOptions;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<MountedComposer | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = mountDeepAgentComposer(host.current, options);
    controller.current = instance;
    return () => {
      instance.destroy();
      controller.current = null;
    };
    // Options are updated below without remounting the state machine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controller.current?.update(options ?? {});
  }, [options]);

  return <div ref={host} className={className} data-motion-component="deep-agent-composer" />;
}

export type { DeepAgentComposerOptions };
