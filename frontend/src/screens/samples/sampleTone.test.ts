import { describe, expect, test } from "vitest";

import { SAMPLE_STATES } from "../../api/types";
import { formatAmount, humanState, sampleTone } from "./sampleTone";

describe("sampleTone", () => {
  test("maps every state the backend can return", () => {
    // If the backend gains a state and this file isn't updated, the dot
    // silently goes grey — this catches that at test time instead.
    for (const state of SAMPLE_STATES) {
      expect(sampleTone(state), state).not.toBeUndefined();
    }
    expect(SAMPLE_STATES.map(sampleTone)).not.toContain(undefined);
  });

  test("falls back to muted for an unknown state rather than throwing", () => {
    expect(sampleTone("levitating")).toBe("muted");
  });

  test("flags quarantine as the one dangerous state", () => {
    expect(sampleTone("quarantined")).toBe("danger");
  });
});

describe("humanState", () => {
  test("unsnakes for display", () => {
    expect(humanState("in_process")).toBe("in process");
  });
});

describe("formatAmount", () => {
  test("joins value and unit", () => {
    expect(formatAmount(1.5, "mL")).toBe("1.5 mL");
  });

  test("keeps a value with no unit", () => {
    expect(formatAmount(1.5, null)).toBe("1.5");
  });

  test("returns null when there's nothing to show", () => {
    expect(formatAmount(null, null)).toBeNull();
  });

  test("shows zero rather than treating it as absent", () => {
    expect(formatAmount(0, "mL")).toBe("0 mL");
  });
});
