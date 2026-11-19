import type { MotionOptions, MotionController } from "./motion-runtime";

export type GlassFolderArt = "aurora" | "ember" | "dusk" | "glacier" | "verdant";

export type GlassFolderFile = {
  /** Stable id for app wiring (e.g. session id). */
  id?: string;
  name: string;
  meta?: string;
  art?: GlassFolderArt;
};

export type GlassFolderOptions = MotionOptions & {
  /** Folder front label. */
  label?: string;
  tone?: "light" | "dark";
  art?: GlassFolderArt;
  seed?: number;
  action?: "add" | "more";
  /** Sheets inside the folder; defaults to the demo sample set. */
  files?: GlassFolderFile[];
  /** Hide the demo feedback line under the card. */
  hideFeedback?: boolean;
  onActivate?: () => void;
  onSelectFile?: (file: GlassFolderFile) => void;
  onAddFile?: () => void;
  /** Danger menu: close / remove this project from the workspace list. */
  onRemove?: () => void;
};

export function mountGlassFolder(
  target: HTMLElement,
  options?: GlassFolderOptions
): Omit<MotionController, "update"> & {
  update(options: GlassFolderOptions): void;
};
