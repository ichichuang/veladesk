import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Static contract for the App Visual Editor shell (task 016-C).
 *
 * The editor used to scroll as ONE container, so working on a lower property
 * pushed the live preview out of view. The shell is now fixed: the preview
 * header and the Save/Cancel footer sit OUTSIDE the single scrolling body.
 * These assertions pin the CSS structure; the browser matrix verifies the
 * resulting geometry (preview.top / footer.bottom deltas).
 */

const css = readFileSync(
  fileURLToPath(new URL("./home-shell.css", import.meta.url)),
  "utf8"
);

const editorSource = readFileSync(
  fileURLToPath(new URL("./app-visual-editor.tsx", import.meta.url)),
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

describe("visual editor fixed shell", () => {
  it("never scrolls the dialog container itself", () => {
    const block = ruleBlock(".vela-visual-editor");
    expect(block).toMatch(/overflow:\s*hidden/);
    expect(block).not.toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/width:\s*min\(760px,\s*calc\(100vw\s*-\s*32px\)\)/);
  });

  it("bounds the dialog in both axes so the shell cannot outgrow the viewport", () => {
    const block = ruleBlock(".vela-visual-editor");
    expect(block).toMatch(/height:\s*min\(86vh,\s*820px\)/);
    expect(block).toMatch(/max-height:\s*min\(86vh,\s*820px\)/);
  });

  it("lays the form out as a three-row shell", () => {
    const block = ruleBlock(".vela-visual-editor__form");
    expect(block).toMatch(/display:\s*grid/);
    expect(block).toMatch(/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
    expect(block).toMatch(/height:\s*100%/);
  });

  it("makes the middle row the one real scroll region", () => {
    const block = ruleBlock(".vela-visual-editor__body");
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/min-height:\s*0/);
    expect(block).toMatch(/overscroll-behavior:\s*contain/);
  });

  it("keeps the header outside the scroll region", () => {
    const block = ruleBlock(".vela-visual-editor__header");
    expect(block).not.toMatch(/overflow(-y)?:\s*auto/);
    // The header is a grid row, never a sticky overlay inside the body.
    expect(block).not.toMatch(/position:\s*sticky/);
  });

  it("keeps the footer outside the scroll region with a separation line", () => {
    const block = ruleBlock(".vela-visual-editor__footer");
    expect(block).not.toMatch(/overflow(-y)?:\s*auto/);
    expect(block).not.toMatch(/position:\s*(sticky|fixed|absolute)/);
    expect(block).toMatch(/border-top:/);
  });
});

describe("visual editor source contract", () => {
  it("declares the header, the scroll body and the footer in that order", () => {
    const header = editorSource.indexOf("vela-visual-editor__header");
    const body = editorSource.indexOf("vela-visual-editor__body");
    const footer = editorSource.indexOf("vela-visual-editor__footer");

    expect(header).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(header);
    expect(footer).toBeGreaterThan(body);
  });

  it("marks the scroll body as a local wheel scope", () => {
    const body = editorSource.slice(editorSource.indexOf("vela-visual-editor__body"));
    expect(body.slice(0, 400)).toMatch(/data-vd-wheel-scope="local"/);
  });

  it("exposes exactly one icon-size and one title-size range (017-C)", () => {
    // The 016-C "no range input" contract is intentionally obsolete: icon
    // and title presentation are edited HERE since 017-C. But geometry is
    // still not editable in this dialog — exactly two ranges, both bound to
    // the presentation draft, and no tile/grid/rect control anywhere.
    const ranges = editorSource.match(/type="range"/g) ?? [];
    expect(ranges).toHaveLength(2);
    expect(editorSource).toMatch(/"vela-visual-icon-scale"/);
    expect(editorSource).toMatch(/"vela-visual-label-scale"/);
    expect(editorSource).not.toMatch(/gridColumn|gridRow|columnSpan|rowSpan/);
    expect(editorSource).not.toMatch(/canvasRectStyle|gridPlacementStyle/);
  });

  it("binds the ranges to the semantic domain bounds", () => {
    expect(editorSource).toMatch(/min=\{MIN_ICON_SCALE\}/);
    expect(editorSource).toMatch(/max=\{MAX_ICON_SCALE\}/);
    expect(editorSource).toMatch(/min=\{MIN_APP_LABEL_SCALE\}/);
    expect(editorSource).toMatch(/max=\{MAX_APP_LABEL_SCALE\}/);
  });

  it("orders the body sections Icon → Title → Appearance", () => {
    const icon = editorSource.indexOf("visualEditor.section.icon");
    const title = editorSource.indexOf("visualEditor.section.title");
    const appearance = editorSource.indexOf("visualEditor.section.appearance");

    expect(icon).toBeGreaterThan(-1);
    expect(title).toBeGreaterThan(icon);
    expect(appearance).toBeGreaterThan(title);
  });

  it("disables title size while the name is hidden, without resetting it", () => {
    expect(editorSource).toMatch(/disabled=\{!draft\.labelVisible\}/);
    expect(editorSource).toMatch(/data-disabled=\{draft\.labelVisible \? undefined : "true"\}/);
  });

  it("renders the preview name only while the label is visible", () => {
    const preview = editorSource.slice(editorSource.indexOf("vela-visual-editor__preview"));
    expect(preview.slice(0, 1600)).toMatch(
      /\{draft\.labelVisible \? \([\s\S]*vela-visual-editor__preview-name/
    );
  });

  it("feeds the preview from the shared presentation vars, not a second formula", () => {
    expect(editorSource).toMatch(/buildAppIconStyleVars\(appVisual\(previewApp\)\)/);
  });

  it("points tile-size editing at Arrange mode instead of a control", () => {
    expect(editorSource).toMatch(/visualEditor\.resizeHint/);
  });

  it("keeps the dialog semantics and closes on Escape", () => {
    expect(editorSource).toMatch(/role="dialog"/);
    expect(editorSource).toMatch(/aria-modal="true"/);
    expect(editorSource).toMatch(/aria-labelledby="vela-visual-editor-title"/);
    expect(editorSource).toMatch(/event\.key === "Escape"/);
    expect(editorSource).toMatch(/tabIndex=\{-1\}/);
  });

  it("hides the foreground control for sources that keep their own colors", () => {
    expect(editorSource).toMatch(/appGlyphColorModel\(/);
    expect(editorSource).toMatch(/visualEditor\.originalColorNote/);
    expect(editorSource).toMatch(/visualEditor\.upload\.originalColorNote/);
  });
});
