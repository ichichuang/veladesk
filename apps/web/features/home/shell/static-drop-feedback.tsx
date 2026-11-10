"use client";

import { useEffect } from "react";
import { useDragDropManager } from "@dnd-kit/react";

import { installDndDropSettle } from "../dnd-static-drop";

/**
 * Mounts inside the DragDropProvider and configures its manager once: the
 * drop settle (Helm r3) replaces dnd-kit's decorative drop animation, so a
 * released tile continues FROM ITS RELEASE POSITION into its committed
 * geometry. See dnd-static-drop.ts for the mechanism and product rationale.
 */
export function StaticDropFeedback() {
  const manager = useDragDropManager();
  useEffect(() => {
    if (manager !== null) {
      installDndDropSettle(manager);
    }
  }, [manager]);
  return null;
}
