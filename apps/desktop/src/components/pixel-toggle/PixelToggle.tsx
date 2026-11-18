"use client";
import { useEffect, useRef } from "react";
import { mountPixelToggle, type PixelToggleOptions } from "./PixelToggleEngine.js";
import type { MotionController } from "./motion-runtime";

export function PixelToggle({
  options,
  className
}: {
  options?: PixelToggleOptions;
  className?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<Omit<MotionController, "update"> & {
    update(options: PixelToggleOptions): void;
  } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const instance = mountPixelToggle(host.current, options);
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

  return <div ref={host} className={className} data-motion-component="pixel-toggle" />;
}

export type { PixelToggleOptions };
