import { describe, expect, it, vi } from "vitest";

import { workspaceViewStateStorageKey } from "./workspace-view-state";
import {
  VIEW_STATE_FLUSH_MAX_DELAY_MS,
  browserIdleFlushScheduler,
  createWorkspaceViewStateController,
} from "./workspace-view-state-controller";

class MemoryStorage implements Storage {
  readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Captures scheduled callbacks instead of running them — deterministic time. */
class ManualScheduler {
  scheduled: (() => void)[] = [];
  schedule = (callback: () => void): (() => void) => {
    this.scheduled.push(callback);
    return () => {
      const index = this.scheduled.indexOf(callback);
      if (index >= 0) {
        this.scheduled.splice(index, 1);
      }
    };
  };
  fireFirst(): void {
    const callback = this.scheduled.shift();
    callback?.();
  }
}

describe("coalesced persistence (023-A §12/§33)", () => {
  it("rapid mutations before the flush persist only the LATEST state", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage,
      now: () => 42,
      schedule: scheduler.schedule,
    });

    controller.setActiveSection("b");
    controller.setActiveSection("c");
    controller.setActiveSection("d");
    // One deferred write is scheduled, not three.
    expect(scheduler.scheduled).toHaveLength(1);
    expect(storage.map.has(workspaceViewStateStorageKey("ws-a"))).toBe(false);

    scheduler.fireFirst();
    expect(JSON.parse(storage.map.get(workspaceViewStateStorageKey("ws-a"))!)).toEqual({
      version: 1,
      activeSectionId: "d",
      scrollTopBySectionId: {},
      updatedAt: 42,
    });
    controller.dispose();
  });

  it("a new mutation after a flush schedules exactly one new flush", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage,
      schedule: scheduler.schedule,
    });
    controller.setActiveSection("b");
    scheduler.fireFirst();
    controller.setActiveSection("c");
    expect(scheduler.scheduled).toHaveLength(1);
    scheduler.fireFirst();
    const stored = JSON.parse(storage.map.get(workspaceViewStateStorageKey("ws-a"))!);
    expect(stored.activeSectionId).toBe("c");
    controller.dispose();
  });

  it("identical values are no-ops that never schedule a write", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage,
      initial: {
        version: 1,
        activeSectionId: "b",
        scrollTopBySectionId: { b: 100 },
        updatedAt: 5,
      },
      schedule: scheduler.schedule,
    });
    controller.setActiveSection("b");
    controller.setScrollTop("b", 100);
    controller.setScrollTop("b", -3); // invalid — ignored
    controller.setScrollTop("b", Number.NaN); // invalid — ignored
    expect(scheduler.scheduled).toHaveLength(0);
    expect(controller.current().updatedAt).toBe(5);
    controller.dispose();
  });

  it("flushNow writes synchronously and cancels the scheduled write", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage,
      schedule: scheduler.schedule,
    });
    controller.setActiveSection("b");
    controller.flushNow();
    const first = storage.map.get(workspaceViewStateStorageKey("ws-a"));
    expect(JSON.parse(first!).activeSectionId).toBe("b");
    // The deferred callback was cancelled — firing nothing later must not
    // resurrect a stale write.
    controller.setActiveSection("c");
    controller.dispose(); // also cancels
    expect(scheduler.scheduled).toHaveLength(0);
    expect(JSON.parse(storage.map.get(workspaceViewStateStorageKey("ws-a"))!).activeSectionId).toBe("b");
  });

  it("dispose prevents any further writes", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage,
      schedule: scheduler.schedule,
    });
    controller.setActiveSection("b");
    controller.dispose();
    scheduler.scheduled.forEach((callback) => callback());
    expect(storage.map.has(workspaceViewStateStorageKey("ws-a"))).toBe(false);
    controller.setActiveSection("c");
    controller.flushNow();
    expect(storage.map.has(workspaceViewStateStorageKey("ws-a"))).toBe(false);
  });

  it("scroll entries accumulate per section alongside the active section", () => {
    const storage = new MemoryStorage();
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage,
      schedule: scheduler.schedule,
    });
    controller.setScrollTop("a", 10);
    controller.setScrollTop("b", 640);
    controller.setScrollTop("a", 30); // latest wins per section
    controller.setActiveSection("b");
    scheduler.fireFirst();
    expect(JSON.parse(storage.map.get(workspaceViewStateStorageKey("ws-a"))!)).toEqual({
      version: 1,
      activeSectionId: "b",
      scrollTopBySectionId: { a: 30, b: 640 },
      updatedAt: expect.any(Number),
    });
    controller.dispose();
  });

  it("without an injected initial state, the persisted payload is loaded as the base", () => {
    const storage = new MemoryStorage();
    storage.map.set(
      workspaceViewStateStorageKey("ws-a"),
      JSON.stringify({
        version: 1,
        activeSectionId: "old",
        scrollTopBySectionId: { old: 500 },
        updatedAt: 1,
      }),
    );
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage,
    });
    // The shell normally overlays the RESOLVED initial section; without it,
    // the persisted base is intact and the controller keeps its scroll data.
    expect(controller.current().scrollTopBySectionId).toEqual({ old: 500 });
    controller.setActiveSection("new");
    controller.flushNow();
    expect(JSON.parse(storage.map.get(workspaceViewStateStorageKey("ws-a"))!)).toEqual({
      version: 1,
      activeSectionId: "new",
      scrollTopBySectionId: { old: 500 },
      updatedAt: expect.any(Number),
    });
    controller.dispose();
  });

  it("a throwing storage write never propagates", () => {
    const throwing: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    } as unknown as Storage;
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage: throwing,
      schedule: scheduler.schedule,
    });
    expect(() => controller.setActiveSection("b")).not.toThrow();
    expect(() => scheduler.fireFirst()).not.toThrow();
    expect(controller.current().activeSectionId).toBe("b"); // memory survives
    controller.dispose();
  });

  it("null storage = in-memory only (mutators and flush are safe no-ops on disk)", () => {
    const scheduler = new ManualScheduler();
    const controller = createWorkspaceViewStateController({
      workspaceId: "ws-a",
      storage: null,
      schedule: scheduler.schedule,
    });
    controller.setActiveSection("b");
    expect(() => controller.flushNow()).not.toThrow();
    expect(controller.current().activeSectionId).toBe("b");
    controller.dispose();
  });
});

describe("browserIdleFlushScheduler (023-A §12)", () => {
  it("caps the coalescing window at the documented maximum", () => {
    expect(VIEW_STATE_FLUSH_MAX_DELAY_MS).toBeGreaterThanOrEqual(100);
    expect(VIEW_STATE_FLUSH_MAX_DELAY_MS).toBeLessThanOrEqual(250);
    expect(typeof browserIdleFlushScheduler()).toBe("function");
  });

  it("the fallback timer path schedules and cancels", () => {
    vi.useFakeTimers();
    try {
      // Ensure the setTimeout branch is taken even where requestIdleCallback exists.
      const originalIdle = globalThis.requestIdleCallback;
      const originalCancel = globalThis.cancelIdleCallback;
      delete (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback;
      delete (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback;
      const ran: string[] = [];
      const cancel = browserIdleFlushScheduler()(() => ran.push("flush"));
      expect(ran).toEqual([]);
      vi.advanceTimersByTime(VIEW_STATE_FLUSH_MAX_DELAY_MS - 1);
      expect(ran).toEqual([]);
      cancel();
      vi.advanceTimersByTime(1000);
      expect(ran).toEqual([]); // cancelled — nothing fires late
      if (originalIdle !== undefined) {
        (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback = originalIdle;
      }
      if (originalCancel !== undefined) {
        (globalThis as { cancelIdleCallback?: unknown }).cancelIdleCallback = originalCancel;
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
