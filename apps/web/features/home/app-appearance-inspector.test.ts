import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

/**
 * Static contract for the App Appearance Inspector (task 019-C).
 *
 * The REAL desktop is the preview: a fixed right-side panel receives the
 * shell-owned session draft and reports changes upward — no simulated
 * tile, no preview sizing, no second projection. These tests pin the
 * source/CSS shape: the panel overlay, the single projection, the
 * persistence boundary (draft changes and cancel NEVER persist; only the
 * Save handler may) and the removal of every fake-preview artifact.
 */

const inspectorSource = readFileSync(
  fileURLToPath(new URL("./app-appearance-inspector.tsx", import.meta.url)),
  "utf8"
);

const shellSource = readFileSync(
  fileURLToPath(new URL("./desktop-shell.tsx", import.meta.url)),
  "utf8"
);

const itemSource = readFileSync(
  fileURLToPath(new URL("./desktop-item.tsx", import.meta.url)),
  "utf8"
);

const css = readFileSync(
  fileURLToPath(new URL("./home-shell.css", import.meta.url)),
  "utf8"
);

function ruleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, "m"));
  if (match === null) {
    throw new Error(`CSS rule not found: ${selector}`);
  }
  return match[1]!;
}

describe("inspector: no fake preview remains (019-C §2/§21)", () => {
  it("renders no preview surface, preview measurement or preview projection", () => {
    for (const gone of [
      "preview-fit",
      "preview-stage",
      "previewLayout",
      "stageSize",
      "previewFit",
      "ResizeObserver",
      "resolveAppContentLayout",
      "buildAppContentStyleVars",
      "tileAspectRatio",
    ]) {
      expect(inspectorSource, `inspector must not contain ${gone}`).not.toMatch(
        new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      );
    }
  });

  it("the stylesheet has no preview classes left", () => {
    for (const gone of [
      ".vela-visual-editor__preview-fit",
      ".vela-visual-editor__preview-stage",
      ".vela-visual-editor__preview-name",
      ".vela-visual-editor__preview ",
    ]) {
      expect(css, gone).not.toMatch(new RegExp(gone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});

describe("inspector: fixed right-side panel over the workspace (019-C §7)", () => {
  it("mounts through the panel dialog variant", () => {
    expect(inspectorSource).toMatch(/variant="panel"/);
    expect(inspectorSource).toMatch(/data-vd-wheel-scope="local"/);
    // The panel body is its own scroll region through the canonical
    // VdScrollArea (021-A); header and footer are outside it.
    expect(inspectorSource).toMatch(/<VdScrollArea/);
    expect(inspectorSource).not.toMatch(/overflow-y-auto/);
  });

  it("owns no workspace-copy draft — it receives the session draft", () => {
    expect(inspectorSource).toMatch(/readonly draft: AppVisualDraft/);
    expect(inspectorSource).toMatch(/readonly onDraftChange: \(draft: AppVisualDraft\) => void/);
    expect(inspectorSource).toMatch(/readonly onCancel: \(\) => void/);
    expect(inspectorSource).toMatch(/readonly onSaved: \(\) => void/);
    // No internal copy of the editing draft.
    expect(inspectorSource).not.toMatch(/useState<AppVisualDraft/);
  });

  it("uses exactly ONE projection for identity, desktop and Save", () => {
    // buildDraftApp is the canonical projection; the inspector calls it
    // exactly twice — the projected app (header identity + save target).
    expect(inspectorSource.match(/buildDraftApp\(/g) ?? []).toHaveLength(2);
  });

  it("keeps the identity thumbnail a fixed-slot tile, never adaptive", () => {
    expect(inspectorSource).toMatch(/<AppIconTile app=\{projected\} \/>/);
    expect(inspectorSource).not.toMatch(/vela-app-content/);
  });
});

describe("inspector: persistence boundary (019-C §24)", () => {
  it("persists ONLY inside the Save handler — never on draft change or cancel", () => {
    const saveStart = inspectorSource.indexOf("async function handleSave");
    expect(saveStart).toBeGreaterThan(-1);
    const afterSave = inspectorSource.slice(saveStart);
    // Everything before the save handler is draft/UI code and must not
    // touch any persistence entry point.
    const beforeSave = inspectorSource.slice(0, saveStart);
    for (const forbidden of [
      "replaceApp(",
      "stageWorkspaceAndTrySync(",
      "runtime.stage",
      "stageAsset(",
    ]) {
      expect(beforeSave, `${forbidden} before handleSave`).not.toContain(forbidden);
    }
    // The save handler itself uses the domain op + staging.
    expect(afterSave).toContain("replaceApp(workspace, nextApp)");
    expect(afterSave).toContain("stageWorkspaceAndTrySync(runtime, result.workspace)");
    // Cancel and close are pure session drops.
    const cancelSite = inspectorSource.slice(
      inspectorSource.indexOf('onOpenChange={(open) => (open ? undefined : onCancel())}')
    );
    expect(cancelSite.slice(0, 200)).not.toContain("replaceApp");
  });
});

describe("shell: session ownership and zero-bounce handoff (019-C §5/§6)", () => {
  it("owns the appearance session and projects the rendered workspace", () => {
    expect(shellSource).toMatch(/useState<AppAppearanceSession \| null>/);
    expect(shellSource).toMatch(
      /projectRenderedWorkspace\(snapshot, effectiveAppearanceSession\)/
    );
    expect(shellSource).toMatch(/openAppearanceSession\(entity\)/);
    // The desktop renders the projection; dialogs still edit persisted data.
    expect(shellSource).toMatch(/workspace=\{renderedSnapshot\}/);
  });

  it("keeps a post-save session projecting only until the snapshot carries it", () => {
    // The zero-bounce handoff is DERIVED, not effect-reconciled: while the
    // panel is closed and the persisted app still differs, the session
    // keeps projecting (no old-appearance flash); once the snapshot
    // carries the projection, the derivation stops using it — rendered
    // equals persisted either way.
    expect(shellSource).toMatch(
      /if \(!inspectorOpen && appearanceHandoffSettled\(snapshot, appearanceSession\)\) \{/
    );
    expect(shellSource).toMatch(/return null; \/\/ Inert: the persisted app IS the projection\./);
    // No setState-in-effect reconciliation for the appearance session.
    expect(shellSource).not.toMatch(/setAppearanceSession\(null\);\s*\n\s*}\s*\n\s*\}, \[snapshot/);
  });

  it("navigates to the owning section when editing starts", () => {
    expect(shellSource).toMatch(/containerPageId\(snapshot, entity\.id\)/);
    expect(shellSource).toMatch(/switchSection\(owningPageId/);
  });

  it("the fake-preview aspect plumbing is gone", () => {
    expect(shellSource).not.toMatch(/visualEditorTileAspectRatio/);
  });
});

describe("desktop affordance (019-C §11)", () => {
  it("marks the inspected app with a quiet halo, never handles", () => {
    expect(itemSource).toMatch(/data-inspector-editing=\{editingAppearance === true \? "true" : undefined\}/);
    const halo = ruleBlock('.vela-item[data-inspector-editing="true"]');
    expect(halo).toMatch(/outline:\s*2px solid var\(--vd-accent\)/);
    expect(halo).not.toMatch(/resize/);
  });
});

describe("inspector information architecture (019-C §8/§9)", () => {
  it("exposes the designed controls and nothing else", () => {
    expect(inspectorSource).toMatch(/vela-visual-label-visible/);
    expect(inspectorSource).toMatch(/vela-appearance-inspector__decoration\b/);
    expect(inspectorSource).toMatch(/visualEditor\.changeIcon/);
    // No sizing controls, no sliders (019-B stays intact).
    expect(inspectorSource).not.toMatch(/Slider/);
    expect(inspectorSource).not.toMatch(/iconScale|labelScale/);
  });

  it("the icon picker is a separate focused surface fed by the same draft", () => {
    expect(inspectorSource).toMatch(/AppearanceIconPickerDialog/);
    expect(inspectorSource).toMatch(/onDraftChange=\{onDraftChange\}/);
    // The picker holds the upload blob; it does not duplicate appearance
    // controls (no decoration style buttons inside it).
    const pickerStart = inspectorSource.indexOf("function AppearanceIconPickerDialog");
    const pickerEnd = inspectorSource.indexOf("/** GeneratedTextControls");
    const pickerSource = inspectorSource.slice(pickerStart, pickerEnd);
    expect(pickerSource).not.toMatch(/vela-appearance-inspector__decoration/);
    expect(pickerSource).toMatch(/vela-upload-dropzone/);
    expect(pickerSource).toMatch(/<IconPicker/);
  });

  it("bounds the picker grid so it scrolls locally inside the fixed dialog", () => {
    // 019-D §10: the fixed 560px dialog bounds the picker; the picker is a
    // flex column whose framed well is the one scrolling region — owned by
    // the canonical VdScrollArea since 021-A, the grid inside is layout only.
    const bound = ruleBlock(".vela-visual-editor__picker-bound");
    expect(bound).toMatch(/min-height:\s*0/);
    expect(bound).toMatch(/overflow:\s*hidden/);
    expect(bound).not.toMatch(/max-height/);
    const scroll = ruleBlock(".vela-icon-picker__scroll");
    expect(scroll).toMatch(/flex:\s*1/);
    expect(scroll).toMatch(/min-height:\s*120px/);
    expect(scroll).not.toMatch(/max-height/);
    expect(scroll).not.toMatch(/overflow/);
    const grid = ruleBlock(".vela-icon-picker__grid");
    expect(grid).not.toMatch(/overflow/);
    expect(grid).not.toMatch(/flex:\s*1/);
  });
});

describe("inspector: product-grade controls (019-D §9/§21)", () => {
  it("uses the canonical HeroUI controls on the panel surface", () => {
    for (const component of [
      "Button",
      "CloseButton",
      "ToggleButtonGroup",
      "ToggleButton",
      "TextField",
      "Input",
      "Label",
    ]) {
      expect(inspectorSource, component).toMatch(
        new RegExp(`import \\{[^}]*\\b${component}\\b[^}]*\\} from "@heroui/react"`)
      );
    }
    // The boolean switch rides the canonical composite (task 020-A1 §14):
    // VdSwitch wraps HeroUI's Switch with the interactive Switch.Content —
    // a bare Control/Thumb composite renders zero interactive elements.
    expect(inspectorSource).toContain("VdSwitch");
  });

  it("shows no browser-native select/range/checkbox/color control", () => {
    // The hidden file input is the accessibility-exempt internal control.
    expect(inspectorSource).not.toMatch(/<select/);
    expect(inspectorSource).not.toMatch(/type="range"/);
    expect(inspectorSource).not.toMatch(/type="checkbox"/);
    expect(inspectorSource).not.toMatch(/type="color"/);
    expect(inspectorSource).toMatch(/type="file"/);
    expect(inspectorSource).toMatch(/aria-hidden="true"/);
  });

  it("never shows a technical icon id as the primary icon label", () => {
    expect(inspectorSource).toMatch(/humanizeIconName/);
    // The raw library id is never interpolated into visible copy.
    expect(inspectorSource).not.toMatch(/· \$\{draft\.libraryIcon\}/);
    expect(inspectorSource).toMatch(/describeDraftSourcePrimary/);
  });

  it("the icon row is one affordance with a thumb and a trailing chevron", () => {
    expect(inspectorSource).toMatch(/vela-inspector__row/);
    expect(inspectorSource).toMatch(/IconRowThumbnail/);
    expect(inspectorSource).toMatch(/ChevronRight/);
  });

  it("the panel window keeps Motion-owned enter/exit with canonical timing", () => {
    // variant="panel" and no custom motion override: the canonical 320ms
    // panel preset applies (motion-tokens contract covers the values).
    expect(inspectorSource).toMatch(/variant="panel"/);
    expect(inspectorSource).not.toMatch(/motionPreset="dialog"/);
  });
});
