import * as React from "react";
import { ChevronRightIcon, FileIcon, FolderIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * File Tree — adapted from the shadcn/ui ai-elements "file-tree" pattern
 * (https://ui.shadcn.com/docs/ai-elements/aria/file-tree). The aria style
 * composes Base UI Collapsible with Button slot="trigger"; ours uses the
 * Radix Collapsible (CollapsibleTrigger asChild). Classes follow the
 * official recipe: ghost/sm buttons, w-full justify-start, ml-4 indent.
 *
 * A folder is a Collapsible. A file is a Button. Actions render NEXT to a
 * file's button, never inside it.
 */
import { Button } from "@/components/ui/button";
import {
  Collapsible as CollapsibleRoot,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

export type FileTreeNode =
  | { type: "folder"; name: string; path: string; children: FileTreeNode[] }
  | { type: "file"; name: string; path: string };

/** Build a folder tree from a list of file paths (sorted, folders first). */
export function buildFileTree(paths: string[]): FileTreeNode[] {
  const root: FileTreeNode[] = [];
  for (const path of [...paths].sort()) {
    const segments = path.split("/");
    let level = root;
    let prefix = "";
    segments.forEach((segment, index) => {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      if (isFile) {
        level.push({ type: "file", name: segment, path });
        return;
      }
      let folder = level.find(
        (node): node is Extract<FileTreeNode, { type: "folder" }> =>
          node.type === "folder" && node.name === segment
      );
      if (!folder) {
        folder = { type: "folder", name: segment, path: prefix, children: [] };
        level.push(folder);
      }
      level = folder.children;
    });
  }
  return root;
}

interface FileTreeContextValue {
  selectedPath?: string;
  onSelect?: (path: string) => void;
  isExpanded: (path: string) => boolean;
  toggleExpanded: (path: string) => void;
}

const FileTreeContext = React.createContext<FileTreeContextValue | null>(null);

const useFileTree = () => {
  const context = React.useContext(FileTreeContext);
  if (!context) {
    throw new Error("File Tree components must be used within FileTree");
  }
  return context;
};

export type FileTreeProps = React.ComponentProps<"div"> & {
  selectedPath?: string;
  onSelect?: (path: string) => void;
  /** Expand every folder by default (still toggleable per folder). */
  defaultExpanded?: boolean;
};

export function FileTree({
  selectedPath,
  onSelect,
  defaultExpanded = true,
  className,
  ...props
}: FileTreeProps) {
  const toggledRef = React.useRef(new Set<string>());
  const contextValue = React.useMemo<FileTreeContextValue>(
    () => ({
      selectedPath,
      onSelect,
      isExpanded: (path) =>
        defaultExpanded ? !toggledRef.current.has(path) : toggledRef.current.has(path),
      toggleExpanded: (path) => {
        if (toggledRef.current.has(path)) {
          toggledRef.current.delete(path);
        } else {
          toggledRef.current.add(path);
        }
      },
    }),
    [selectedPath, onSelect, defaultExpanded]
  );

  return (
    <FileTreeContext.Provider value={contextValue}>
      <div
        data-slot="file-tree"
        className={cn("flex flex-col text-sm", className)}
        {...props}
      />
    </FileTreeContext.Provider>
  );
}

export function FileTreeIcon({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-tree-icon"
      aria-hidden="true"
      className={cn(
        "flex size-4 shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-4",
        className
      )}
      {...props}
    />
  );
}

export function FileTreeName({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="file-tree-name"
      className={cn("min-w-0 truncate", className)}
      {...props}
    />
  );
}

export function FileTreeActions({
  className,
  ...props
}: React.ComponentProps<"span">) {
  // Renders next to a file's button (never inside it).
  return (
    <span
      data-slot="file-tree-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1.5", className)}
      {...props}
    />
  );
}

export type FileTreeFolderProps = React.ComponentProps<"div"> & {
  path: string;
  name: string;
};

export function FileTreeFolder({
  path,
  name,
  className,
  children,
  ...props
}: FileTreeFolderProps) {
  const tree = useFileTree();
  const expanded = tree.isExpanded(path);
  return (
    <CollapsibleRoot
      open={expanded}
      onOpenChange={() => tree.toggleExpanded(path)}
      className={cn("group/folder", className)}
      {...props}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start"
        >
          <ChevronRightIcon className="transition-transform group-data-[state=open]/folder:rotate-90" />
          <FolderIcon />
          <FileTreeName>{name}</FileTreeName>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 flex flex-col border-l border-border/60 pl-1">
          {children}
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}

export type FileTreeFileProps = React.ComponentProps<"div"> & {
  path: string;
  name?: string;
  actions?: React.ReactNode;
};

export function FileTreeFile({
  path,
  name,
  actions,
  className,
  ...props
}: FileTreeFileProps) {
  const tree = useFileTree();
  const selected = tree.selectedPath === path;
  return (
    <div
      data-slot="file-tree-file"
      data-selected={selected || undefined}
      className={cn(
        "group/file-row flex w-full items-center gap-1 rounded-md pr-1",
        selected && "bg-accent",
        className
      )}
      {...props}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="min-w-0 flex-1 justify-start"
        onClick={() => tree.onSelect?.(path)}
      >
        <FileIcon />
        <FileTreeName>{name ?? path.split("/").pop()}</FileTreeName>
      </Button>
      {actions ? <FileTreeActions>{actions}</FileTreeActions> : null}
    </div>
  );
}

