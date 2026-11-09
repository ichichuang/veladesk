"use client";

import { useEffect } from "react";
import { useDragDropManager } from "@dnd-kit/react";

import { disableDndDropAnimation } from "../dnd-static-drop";

/**
 * Mounts inside the DragDropProvider and configures its manager once:
 * decorative drop animation off (official Feedback#dropAnimation = null),
 * so an arrange drop paints straight into its target geometry and stays
 * still. See dnd-static-drop.ts for the product rationale.
 */
export function StaticDropFeedback() {
  const manager = useDragDropManager();
  useEffect(() => {
    if (manager !== null) {
      disableDndDropAnimation(manager);
    }
  }, [manager]);
  return null;
}
