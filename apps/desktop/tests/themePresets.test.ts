import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_THEMES } from "../src/app/themePresets";
import { GRAPH_LANE_SLOTS } from "../src/lib/styles";

for (const theme of DEFAULT_THEMES) {
  test(`${theme.name}: graph_palette covers all ${GRAPH_LANE_SLOTS} canonical lane slots`, () => {
    assert.ok(
      theme.colors.graph_palette.length >= GRAPH_LANE_SLOTS,
      `${theme.name}: graph_palette has only ${theme.colors.graph_palette.length} colors, ` +
        `but --gc-lane-0..${GRAPH_LANE_SLOTS - 1} wrap via \`index % graph_palette.length\` ` +
        `(apps/desktop/src/app/theme.ts) — a shorter palette makes distinct lanes render identically.`,
    );
  });

  test(`${theme.name}: first ${GRAPH_LANE_SLOTS} graph_palette colors are pairwise distinct`, () => {
    const canonical = theme.colors.graph_palette
      .slice(0, GRAPH_LANE_SLOTS)
      .map((color) => color.toLowerCase());
    assert.equal(
      new Set(canonical).size,
      canonical.length,
      `${theme.name}: duplicate colors among the first ${GRAPH_LANE_SLOTS} graph_palette entries`,
    );
  });
}
