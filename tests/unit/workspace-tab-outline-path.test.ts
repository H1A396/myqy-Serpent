import { describe, expect, it } from "vitest";
import { workspaceTabOutlinePath } from "../../src/renderer/workspace-tab-outline-path";

describe("workspaceTabOutlinePath", () => {
  it("emits an open path with scoop arcs and top radii", () => {
    const d = workspaceTabOutlinePath(120, 40, 18, 14);
    expect(d.startsWith("M ")).toBe(true);
    expect(d.includes("Z")).toBe(false);
    // left tip, left scoop end, top corners, right tip
    expect(d).toContain("M -18 40");
    expect(d).toContain("A 18 18 0 0 1 0 22");
    expect(d).toContain("A 14 14 0 0 1 14 0");
    expect(d).toContain("A 14 14 0 0 1 120 14");
    expect(d).toContain("A 18 18 0 0 0 138 40");
  });

  it("clamps radius when the tab is narrow", () => {
    const d = workspaceTabOutlinePath(20, 40, 18, 14);
    // radius min(14, 20/2, 40-18) = 10
    expect(d).toContain("A 10 10 0 0 1 10 0");
  });
});
