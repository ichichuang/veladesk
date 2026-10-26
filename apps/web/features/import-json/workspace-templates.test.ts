import { describe, expect, it } from "vitest";
import { resolvePagePlacement, validateWorkspace } from "@veladesk/domain";
import { buildWorkspaceTemplate } from "./sample-workspace";

for (const template of ["work", "home"] as const) {
  for (const locale of ["zh-CN", "en-US"] as const) {
    describe(`${template} preset in ${locale}`, () => {
      function build() { let id = 0; return buildWorkspaceTemplate(template, kind => `${kind}-${++id}`, locale); }
      it("has two compact, localized sections and valid short app names", () => {
        const snapshot = build(); expect(validateWorkspace(snapshot)).toEqual([]); expect(snapshot.pages).toHaveLength(2);
        expect(snapshot.preferences.appearance).toMatchObject({ colorMode: "system", wallpaperPreset: template === "work" ? "midnight" : "dawn" });
        expect(snapshot.pages[0]?.name).toBe(template === "work" ? locale === "zh-CN" ? "办公协作" : "Collaboration" : locale === "zh-CN" ? "休闲娱乐" : "Entertainment");
        for (const page of snapshot.pages) {
          const placement = resolvePagePlacement(page); expect(placement.mode).toBe("grid");
          if (placement.mode === "grid") expect(placement.items.every(item => item.row < 2 && item.column < 5)).toBe(true);
        }
        expect(snapshot.entities.every(entity => entity.kind !== "widget" && entity.name.length <= 8)).toBe(true);
      });
      it("keeps white glyph contrast at least 4.5:1 with varied brand colors", () => {
        const colors = new Set<string>();
        for (const app of build().entities) {
          if (app.kind !== "app") continue;
          expect(app.visual?.foregroundColor).toBe("#FFFFFF"); expect(app.visual?.decorationStyle).toBe("solid");
          const color = app.visual!.decorationColor!; colors.add(color);
          const rgb = [1, 3, 5].map(start => Number.parseInt(color.slice(start, start + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
          expect(1.05 / (rgb[0]! * .2126 + rgb[1]! * .7152 + rgb[2]! * .0722 + .05)).toBeGreaterThanOrEqual(4.5);
        }
        expect(colors.size).toBeGreaterThanOrEqual(5);
      });
    });
  }
}
