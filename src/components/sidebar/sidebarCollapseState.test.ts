import { describe, expect, it } from "vitest";
import { normalizeSidebarCollapsedState } from "./sidebarCollapseState";

describe("normalizeSidebarCollapsedState", () => {
  it("expands only the restored active workspace on startup", () => {
    expect(
      normalizeSidebarCollapsedState(["ws-a", "ws-b", "ws-c"], "ws-b", {}, null),
    ).toEqual({
      "ws-a": true,
      "ws-b": false,
      "ws-c": true,
    });
  });

  it("expands the new active workspace but preserves other workspaces' state", () => {
    expect(
      normalizeSidebarCollapsedState(
        ["ws-a", "ws-b", "ws-c"],
        "ws-c",
        {
          "ws-a": false,
          "ws-b": true,
          "ws-c": true,
        },
        "ws-a",
      ),
    ).toEqual({
      "ws-a": false, // stays expanded (was manually expanded)
      "ws-b": true,
      "ws-c": false, // expanded because it's the new active
    });
  });

  it("prunes removed ids and collapses newly added inactive workspaces", () => {
    expect(
      normalizeSidebarCollapsedState(
        ["ws-a", "ws-b", "ws-c"],
        "ws-a",
        {
          "ws-a": false,
          "ws-b": true,
          "ws-removed": true,
        },
        "ws-a",
      ),
    ).toEqual({
      "ws-a": false,
      "ws-b": true,
      "ws-c": true,
    });
  });

  it("preserves manual collapse state when the active workspace is unchanged", () => {
    expect(
      normalizeSidebarCollapsedState(
        ["ws-a", "ws-b"],
        "ws-a",
        {
          "ws-a": true,
          "ws-b": true,
        },
        "ws-a",
      ),
    ).toEqual({
      "ws-a": true,
      "ws-b": true,
    });
  });
});
