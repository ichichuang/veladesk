import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * VdSwitch canonical composite contract (task 020-A1 §14–§15).
 *
 * HeroUI's `Switch` root is React Aria's `SwitchField` — a static wrapper.
 * The interactive element is `Switch.Content` (React Aria's SwitchButton);
 * `Switch.Control`/`Switch.Thumb` are plain spans. The 020-A1 regression
 * shipped the bare Control/Thumb composite on both production surfaces:
 * zero interactive elements, so isSelected/onChange could never fire. This
 * contract keeps that composition from ever returning: every production
 * switch renders through VdSwitch, and no surface composes HeroUI Switch
 * primitives directly.
 */

const VD_SWITCH_SOURCE = new URL("./switch.tsx", import.meta.url);
const FEATURES_DIR = fileURLToPath(new URL("../../features", import.meta.url));

const SWITCH_USING_SURFACES = [
  new URL("../../features/home/app-appearance-inspector.tsx", import.meta.url),
  new URL("../../features/home/settings-center.tsx", import.meta.url),
];

function collectTsxFiles(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${name.name}`;
    if (name.isDirectory()) {
      entries.push(...collectTsxFiles(path));
    } else if (name.isFile() && /\.tsx$/.test(name.name) && !/\.test\.tsx?$/.test(name.name)) {
      entries.push(path);
    }
  }
  return entries;
}

describe("VdSwitch canonical composite (020-A1)", () => {
  it("wraps Control + Thumb INSIDE the interactive Switch.Content", () => {
    const source = readFileSync(VD_SWITCH_SOURCE, "utf8");
    const compositeStart = source.search(/<HeroUISwitch[\s>]/);
    const compositeEnd = source.indexOf("</HeroUISwitch>");
    expect(compositeStart, "VdSwitch must render the HeroUI Switch root").toBeGreaterThanOrEqual(0);
    expect(compositeEnd, "VdSwitch composite must close").toBeGreaterThan(compositeStart);
    const composite = source.slice(compositeStart, compositeEnd);

    const contentStart = composite.indexOf("<HeroUISwitch.Content>");
    const contentEnd = composite.indexOf("</HeroUISwitch.Content>");
    expect(contentStart, "the interactive Switch.Content must be rendered").toBeGreaterThanOrEqual(0);
    expect(contentEnd).toBeGreaterThan(contentStart);
    const insideContent = composite.slice(contentStart, contentEnd);
    expect(insideContent).toContain("<HeroUISwitch.Control>");
    expect(insideContent).toContain("<HeroUISwitch.Thumb");
    // Nothing interactive may sit OUTSIDE the content wrapper.
    const outsideContent = composite.slice(0, contentStart) + composite.slice(contentEnd);
    expect(outsideContent).not.toContain("HeroUISwitch.Control");
  });

  it("every production surface renders its switch through VdSwitch", () => {
    for (const surface of SWITCH_USING_SURFACES) {
      const source = readFileSync(surface, "utf8");
      expect(source, `${surface} must import VdSwitch`).toContain("VdSwitch");
      expect(source, `${surface} must not import Switch from @heroui/react`).not.toMatch(
        /\bSwitch,?\s*$/m
      );
    }
  });

  it("no production file composes bare HeroUI Switch primitives", () => {
    // The regression pattern: `<Switch ...><Switch.Control>` composed by
    // hand. It renders zero interactive elements. Any future switch must
    // go through components/vd/switch.tsx.
    const offenders = collectTsxFiles(FEATURES_DIR)
      .map((path) => ({ path, source: readFileSync(path, "utf8") }))
      .filter(({ source }) => /<Switch[\s.]/.test(source));
    expect(offenders, offenders.map(({ path }) => path).join(", ")).toEqual([]);
  });
});
