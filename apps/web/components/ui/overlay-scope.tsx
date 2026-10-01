"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { UNSAFE_PortalProvider } from "react-aria";

/**
 * Overlay portal ownership (task 018, extended 021-R1).
 *
 * Every overlay portal mounts into ONE themed portal root rendered by the
 * desktop shell as a sibling of `.vela-desktop`. The shell mirrors the
 * resolved workspace theme (`data-vd-color-mode` + the `--vd-*` variables)
 * onto that root, so portalled surfaces stay themed without a second
 * provider and stacking is centralized instead of scattered z-index patches.
 *
 * TWO portal families share that root:
 *
 * - Radix portals (dialogs, popovers, tooltips, the Radix select) read the
 *   container through {@link useVdPortalContainer}.
 * - React Aria / HeroUI overlays (the HeroUI Select popup) read it through
 *   {@link VdHeroOverlayScope}, the installed library's supported
 *   portal-container integration (`UNSAFE_PortalProvider`). Without it they
 *   fall back to `document.body`, OUTSIDE both themed roots: the popup then
 *   inherits the always-dark `:root` token fallback for its surface while
 *   its text `color` falls back to the UA default — the 021-R1 defect.
 *
 * When no scope is mounted (lab pages, boot screens) both families fall
 * back to `document.body` and the `:root` neutral palette applies —
 * components still render, just without the workspace theme. That fallback
 * is the documented, intentionally-isolated case.
 */

const VdPortalContainerContext = createContext<HTMLElement | null>(null);

export const VdPortalContainerProvider = VdPortalContainerContext.Provider;

/**
 * The portal container for Radix overlays, or `undefined` (→ body) outside a
 * desktop shell. Returns `undefined` rather than `null` on purpose: Radix
 * treats `container={null}` as "not ready" and skips portal mounting.
 */
export function useVdPortalContainer(): HTMLElement | undefined {
  return useContext(VdPortalContainerContext) ?? undefined;
}

/**
 * Routes React Aria / HeroUI overlay portals (Select popovers, and any
 * future HeroUI Popover/Menu/Dialog) into the same themed portal root the
 * Radix overlays use. Mount INSIDE {@link VdPortalContainerProvider},
 * around the subtree that renders HeroUI surfaces — the desktop shell mounts
 * it once, around everything.
 *
 * The overlay registration, dismissal, focus-scope and stacking behavior of
 * the library are untouched; only the portal destination changes. Before
 * the portal root exists (the first commit, before any interaction can open
 * an overlay) `getContainer` returns null and react-aria skips rendering —
 * the same "not ready" stance Radix takes.
 */
export function VdHeroOverlayScope({ children }: { readonly children: ReactNode }) {
  const portalContainer = useVdPortalContainer();
  const getContainer = useCallback(() => portalContainer ?? null, [portalContainer]);
  return (
    <UNSAFE_PortalProvider getContainer={getContainer}>{children}</UNSAFE_PortalProvider>
  );
}
