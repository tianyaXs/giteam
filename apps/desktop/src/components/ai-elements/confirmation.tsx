"use client";

// Migrated from the AI SDK Elements Confirmation (Alert base) to the
// shadcn/ui Item + Button composition, per
// https://ui.shadcn.com/docs/ai-elements/aria/confirmation
// Every export keeps its name and props; only the rendering changed.

import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemTitle,
} from "@/components/ui/item";
import { cn } from "@/lib/utils";
import type { ToolUIPart } from "ai";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

type ToolUIPartApproval =
  | {
      id: string;
      approved?: never;
      reason?: never;
    }
  | {
      id: string;
      approved: boolean;
      reason?: string;
    }
  | {
      id: string;
      approved: true;
      reason?: string;
    }
  | {
      id: string;
      approved: false;
      reason?: string;
    };

interface ConfirmationContextValue {
  approval: ToolUIPartApproval;
  state: ToolUIPart["state"];
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(
  null
);

function useConfirmation() {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error("useConfirmation must be used within Confirmation");
  }
  return context;
}

export type ConfirmationProps = ComponentProps<typeof Item> & {
  approval?: ToolUIPartApproval;
  state: ToolUIPart["state"];
};

export const Confirmation = ({
  className,
  approval,
  state,
  ...props
}: ConfirmationProps) => {
  if (!approval || state === "input-streaming" || state === "input-available") {
    return null;
  }

  const confirmedApproval: ToolUIPartApproval = approval;
  const contextValue = useMemo(
    () => ({ approval: confirmedApproval, state }),
    [confirmedApproval, state]
  );

  return (
    <ConfirmationContext.Provider value={contextValue}>
      <Item
        variant="outline"
        size="sm"
        className={cn("flex-col gap-2", className)}
        {...props}
      />
    </ConfirmationContext.Provider>
  );
};

export type ConfirmationTitleProps = ComponentProps<typeof ItemTitle>;

export const ConfirmationTitle = ({
  className,
  ...props
}: ConfirmationTitleProps) => (
  <ItemContent className={cn("inline", className)}>
    <ItemTitle {...props} />
  </ItemContent>
);

export interface ConfirmationRequestProps {
  children?: ReactNode;
}

export const ConfirmationRequest = ({ children }: ConfirmationRequestProps) => {
  const { state } = useConfirmation();

  // Only show when approval is requested
  if (state !== "approval-requested") {
    return null;
  }

  return children;
};

export interface ConfirmationAcceptedProps {
  children?: ReactNode;
}

export const ConfirmationAccepted = ({
  children,
}: ConfirmationAcceptedProps) => {
  const { approval, state } = useConfirmation();

  // Only show when approved and in response states
  if (
    !approval?.approved ||
    (state !== "approval-responded" &&
      state !== "output-denied" &&
      state !== "output-available")
  ) {
    return null;
  }

  return children;
};

export interface ConfirmationRejectedProps {
  children?: ReactNode;
}

export const ConfirmationRejected = ({
  children,
}: ConfirmationRejectedProps) => {
  const { approval, state } = useConfirmation();

  // Only show when rejected and in response states
  if (
    approval?.approved !== false ||
    (state !== "approval-responded" &&
      state !== "output-denied" &&
      state !== "output-available")
  ) {
    return null;
  }

  return children;
};

export type ConfirmationActionsProps = ComponentProps<typeof ItemActions>;

export const ConfirmationActions = ({
  className,
  ...props
}: ConfirmationActionsProps) => {
  const { state } = useConfirmation();

  // Only show when approval is requested
  if (state !== "approval-requested") {
    return null;
  }

  return <ItemActions className={cn("self-end", className)} {...props} />;
};

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = (props: ConfirmationActionProps) => (
  <Button size="sm" type="button" {...props} />
);
