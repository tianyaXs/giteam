"use client";
import { useEffect, useRef } from "react";
import { mountAsciiSharks, type AsciiSharksOptions } from "./AsciiSharksEngine.js";
import type { MotionController } from "./motion-runtime";

export function AsciiSharks({
  options,
  className
}: {
  options?: AsciiSharksOptions;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<Omit<MotionController, "update"> & {
    update(options: AsciiSharksOptions): void;
  } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = mountAsciiSharks(host.current, options);
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

  return <div ref={host} className={className} data-motion-component="ascii-sharks" />;
}

export type { AsciiSharksOptions };
