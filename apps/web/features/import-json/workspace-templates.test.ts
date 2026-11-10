import { describe, expect, it } from "vitest";
import { resolvePagePlacement, validateWorkspace } from "@veladesk/domain";
import { buildWorkspaceTemplate } from "./sample-workspace";

for (const template of ["work", "home"] as const) {
  for (const locale of ["zh-CN", "en-US"] as const) {
    describe(`${template} preset in ${locale}`, () => {
      function build() { let id = 0; return buildWorkspaceTemplate(template, kind => `${kind}-${++id}`, locale); }
      it("has two compact, localized sections and valid short app names", () => {
        const snapshot = build(); expect(validateWorkspace(snapshot)).toEqual([]); expect(snapshot.pages).toHaveLength(2);
        expect(snapshot.preferences.appearance).toMatchObject({ colorMode: "dark", wallpaperPreset: template === "work" ? "midnight" : "dawn", interfaceStyle: "glass" });
        expect(snapshot.pages[0]?.name).toBe(template === "work" ? locale === "zh-CN" ? "办公协作" : "Collaboration" : locale === "zh-CN" ? "休闲娱乐" : "Entertainment");
        for (const page of snapshot.pages) {
          const placement = resolvePagePlacement(page); expect(placement.mode).toBe("grid");
          if (placement.mode === "grid") expect(placement.items.every(item => item.row < 2 && item.column < 5)).toBe(true);
        }
        expect(snapshot.entities.every(entity => entity.kind !== "widget" && entity.name.length <= 8)).toBe(true);
      });
      it("wears bundled brand glyphs on Auto glass — no forced solid blocks (Helm first picture)", () => {
        let glyphCount = 0;
        for (const app of build().entities) {
          if (app.kind !== "app") continue;
          expect(app.visual?.decorationStyle).toBeUndefined();
          if (app.icon.kind === "iconify") {
            glyphCount += 1;
            expect(app.icon.icon).toMatch(/^simple-icons:[a-z0-9]+$/);
          }
        }
        expect(glyphCount).toBeGreaterThanOrEqual(6);
      });
    });
  }
}
