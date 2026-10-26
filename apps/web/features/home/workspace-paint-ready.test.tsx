// @vitest-environment jsdom
import { Suspense, lazy } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { WorkspacePaintReady } from "./responsive-workspace-shell";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("waits for the suspended shell to commit and a first paint, and cancels on unmount", async () => {
  let resolve!: () => void;
  const loaded = new Promise<void>((done) => { resolve = done; });
  const Shell = lazy(async () => { await loaded; return { default: () => <main>Desktop</main> }; });
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  const onReady = vi.fn();
  const view = render(<Suspense fallback={<p>Loading</p>}><Shell /><WorkspacePaintReady onReady={onReady} /></Suspense>);
  expect(onReady).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
  await act(async () => { resolve(); await loaded; });
  const flushFrame = () => {
    const callbacks = [...frames.values()]; frames.clear();
    act(() => callbacks.forEach((callback) => callback(0)));
  };
  flushFrame();
  expect(onReady).not.toHaveBeenCalled();
  flushFrame();
  expect(onReady).toHaveBeenCalledTimes(1);
  view.unmount();
  const pending = render(<WorkspacePaintReady onReady={onReady} />);
  pending.unmount();
  expect(frames.size).toBe(0);
});
