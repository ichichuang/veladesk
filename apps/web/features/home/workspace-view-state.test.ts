import { describe, expect, it } from "vitest";

import {
  WORKSPACE_VIEW_STATE_VERSION,
  deleteWorkspaceViewState,
  emptyWorkspaceViewState,
  loadWorkspaceViewState,
  parseWorkspaceViewState,
  resolveInitialActiveSection,
  saveWorkspaceViewState,
  serializeWorkspaceViewState,
  workspaceViewStateStorageKey,
} from "./workspace-view-state";

/** Minimal duck-typed storage (node environment has no Storage global). */
class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

function validV1(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    activeSectionId: "page-ai",
    scrollTopBySectionId: { "page-ai": 640, "page-office": 0 },
    updatedAt: 1234,
    ...overrides,
  });
}

describe("storage key strategy (023-A §3)", () => {
  it("keys are version-namespaced and workspace-id scoped", () => {
    expect(workspaceViewStateStorageKey("ws-a")).toBe("veladesk:view-state:v1:ws-a");
    expect(workspaceViewStateStorageKey("ws-b")).toBe("veladesk:view-state:v1:ws-b");
    expect(workspaceViewStateStorageKey("ws-a")).not.toBe(workspaceViewStateStorageKey("ws-b"));
  });
});

describe("parseWorkspaceViewState (023-A §16/§28)", () => {
  it("no persisted value → null", () => {
    expect(parseWorkspaceViewState(null)).toBeNull();
    expect(parseWorkspaceViewState(undefined)).toBeNull();
    expect(parseWorkspaceViewState("")).toBeNull();
  });

  it("valid v1 → accepted with all fields", () => {
    const state = parseWorkspaceViewState(validV1());
    expect(state).toEqual({
      version: 1,
      activeSectionId: "page-ai",
      scrollTopBySectionId: { "page-ai": 640, "page-office": 0 },
      updatedAt: 1234,
    });
  });

  it("malformed JSON → ignored", () => {
    expect(parseWorkspaceViewState("{not json")).toBeNull();
  });

  it("non-object payloads → ignored", () => {
    expect(parseWorkspaceViewState('"a string"')).toBeNull();
    expect(parseWorkspaceViewState("42")).toBeNull();
    expect(parseWorkspaceViewState("null")).toBeNull();
    expect(parseWorkspaceViewState("[1,2]")).toBeNull();
  });

  it("wrong version → ignored", () => {
    expect(parseWorkspaceViewState(validV1({ version: 2 }))).toBeNull();
    expect(parseWorkspaceViewState(validV1({ version: "1" }))).toBeNull();
  });

  it("activeSectionId wrong type → sanitized to null, scroll entries kept", () => {
    const state = parseWorkspaceViewState(
      validV1({ activeSectionId: 17, scrollTopBySectionId: { "page-ai": 90 } }),
    );
    expect(state?.activeSectionId).toBeNull();
    expect(state?.scrollTopBySectionId).toEqual({ "page-ai": 90 });
  });

  it("negative, NaN and Infinity scrollTops → dropped; valid entries preserved", () => {
    const state = parseWorkspaceViewState(
      validV1({
        scrollTopBySectionId: {
          "page-a": 100,
          "page-neg": -5,
          "page-nan": Number.NaN,
          "page-inf": Number.POSITIVE_INFINITY,
          "page-str": "640",
        },
      }),
    );
    expect(state?.scrollTopBySectionId).toEqual({ "page-a": 100 });
  });

  it("scrollTopBySectionId wrong shape → empty map, rest kept", () => {
    const state = parseWorkspaceViewState(
      validV1({ scrollTopBySectionId: [1, 2, 3] }),
    );
    expect(state?.scrollTopBySectionId).toEqual({});
    expect(state?.activeSectionId).toBe("page-ai");
  });

  it("invalid updatedAt → sanitized to 0", () => {
    const state = parseWorkspaceViewState(validV1({ updatedAt: "soon" }));
    expect(state?.updatedAt).toBe(0);
  });
});

describe("storage round-trip and failure safety (023-A §15/§28)", () => {
  it("load with no stored value → null", () => {
    expect(loadWorkspaceViewState(new MemoryStorage(), "ws-a")).toBeNull();
    expect(loadWorkspaceViewState(null, "ws-a")).toBeNull();
    expect(loadWorkspaceViewState(undefined, "ws-a")).toBeNull();
  });

  it("save then load round-trips through the sanitizer", () => {
    const storage = new MemoryStorage();
    expect(
      saveWorkspaceViewState(storage, "ws-a", {
        version: WORKSPACE_VIEW_STATE_VERSION,
        activeSectionId: "page-ai",
        scrollTopBySectionId: { "page-ai": 640, "page-x": -1 },
        updatedAt: 99,
      }),
    ).toBe(true);
    expect(loadWorkspaceViewState(storage, "ws-a")).toEqual({
      version: 1,
      activeSectionId: "page-ai",
      scrollTopBySectionId: { "page-ai": 640 }, // -1 never reaches disk
      updatedAt: 99,
    });
  });

  it("storage getItem throwing → safe fallback (null, no throw)", () => {
    const throwing: Storage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
    expect(() => loadWorkspaceViewState(throwing, "ws-a")).not.toThrow();
    expect(loadWorkspaceViewState(throwing, "ws-a")).toBeNull();
  });

  it("storage setItem throwing → reports failure, never throws", () => {
    const throwing: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    } as unknown as Storage;
    expect(() =>
      saveWorkspaceViewState(throwing, "ws-a", emptyWorkspaceViewState()),
    ).not.toThrow();
    expect(
      saveWorkspaceViewState(throwing, "ws-a", emptyWorkspaceViewState()),
    ).toBe(false);
  });

  it("serialize routes through the sanitizer (invalid entries never hit disk)", () => {
    const raw = serializeWorkspaceViewState({
      version: 1,
      activeSectionId: "page-ai",
      scrollTopBySectionId: { ok: 5, bad: Number.NaN },
      updatedAt: 7,
    });
    expect(JSON.parse(raw)).toEqual({
      version: 1,
      activeSectionId: "page-ai",
      scrollTopBySectionId: { ok: 5 },
      updatedAt: 7,
    });
  });

  it("deleteWorkspaceViewState removes the workspace-scoped key (future deletion boundary)", () => {
    const storage = new MemoryStorage();
    saveWorkspaceViewState(storage, "ws-a", emptyWorkspaceViewState());
    deleteWorkspaceViewState(storage, "ws-a");
    expect(loadWorkspaceViewState(storage, "ws-a")).toBeNull();
    // Other workspaces keep their keys.
    saveWorkspaceViewState(storage, "ws-b", emptyWorkspaceViewState());
    deleteWorkspaceViewState(storage, "ws-a");
    expect(loadWorkspaceViewState(storage, "ws-b")).not.toBeNull();
  });
});

describe("resolveInitialActiveSection precedence (023-A §5/§6/§29)", () => {
  const pageIds = ["a", "b", "c"] as const;

  function viewState(activeSectionId: string | null) {
    return {
      version: 1 as const,
      activeSectionId,
      scrollTopBySectionId: {},
      updatedAt: 0,
    };
  }

  it("persisted active wins over the configured default when it still exists", () => {
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "a",
        persistedViewState: viewState("c"),
        explicitTargetSectionId: null,
      }),
    ).toBe("c");
  });

  it("explicit navigation target wins over persistence", () => {
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "a",
        persistedViewState: viewState("c"),
        explicitTargetSectionId: "b",
      }),
    ).toBe("b");
  });

  it("persisted section deleted → configured default", () => {
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "a",
        persistedViewState: viewState("x"),
        explicitTargetSectionId: null,
      }),
    ).toBe("a");
  });

  it("persisted deleted AND default invalid → first valid section", () => {
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "x",
        persistedViewState: viewState("x"),
        explicitTargetSectionId: null,
      }),
    ).toBe("a");
  });

  it("no persistence at all → configured default, then first", () => {
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "b",
        persistedViewState: null,
        explicitTargetSectionId: null,
      }),
    ).toBe("b");
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "x",
        persistedViewState: null,
        explicitTargetSectionId: null,
      }),
    ).toBe("a");
  });

  it("null persisted activeSectionId never overrides the defaults", () => {
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "a",
        persistedViewState: viewState(null),
        explicitTargetSectionId: null,
      }),
    ).toBe("a");
  });

  it("an explicit target that no longer exists falls through to persistence", () => {
    expect(
      resolveInitialActiveSection({
        pageIds,
        defaultSectionId: "a",
        persistedViewState: viewState("c"),
        explicitTargetSectionId: "gone",
      }),
    ).toBe("c");
  });

  it("no sections → null", () => {
    expect(
      resolveInitialActiveSection({
        pageIds: [],
        defaultSectionId: "a",
        persistedViewState: viewState("a"),
        explicitTargetSectionId: "a",
      }),
    ).toBeNull();
  });
});
