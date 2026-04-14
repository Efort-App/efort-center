import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  computeCohortRate,
  createEmptyFunnelAttribution,
  incrementFunnelAttribution,
  toFunnelCohort,
} from "./funnelAttribution.js";

describe("toFunnelCohort", () => {
  it("maps paid attribution types to tracked and inferred cohorts", () => {
    assert.equal(toFunnelCohort("tracked_paid"), "tracked");
    assert.equal(toFunnelCohort("inferred_paid"), "inferred");
  });

  it("maps everything else to non-paid", () => {
    assert.equal(toFunnelCohort("non_paid"), "nonPaid");
    assert.equal(toFunnelCohort("unknown"), "nonPaid");
  });
});

describe("incrementFunnelAttribution", () => {
  it("increments each stage in the matching cohort", () => {
    const funnelAttribution = createEmptyFunnelAttribution();

    incrementFunnelAttribution(funnelAttribution, {
      attributionType: "tracked_paid",
      invited: true,
      blocked: true,
      athleteShown: false,
      paid: true,
    });
    incrementFunnelAttribution(funnelAttribution, {
      attributionType: "inferred_paid",
      invited: true,
      blocked: false,
      athleteShown: true,
      paid: false,
    });
    incrementFunnelAttribution(funnelAttribution, {
      attributionType: "non_paid",
      invited: false,
      blocked: false,
      athleteShown: false,
      paid: true,
    });

    assert.deepEqual(funnelAttribution, {
      signups: {tracked: 1, inferred: 1, nonPaid: 1},
      invited: {tracked: 1, inferred: 1, nonPaid: 0},
      blocked: {tracked: 1, inferred: 0, nonPaid: 0},
      athleteShown: {tracked: 0, inferred: 1, nonPaid: 0},
      paid: {tracked: 1, inferred: 0, nonPaid: 1},
    });
  });
});

describe("computeCohortRate", () => {
  it("returns the cohort-specific conversion rate", () => {
    assert.equal(
      computeCohortRate(
        {tracked: 4, inferred: 2, nonPaid: 1},
        {tracked: 10, inferred: 5, nonPaid: 2},
        "tracked",
      ),
      0.4,
    );
    assert.equal(
      computeCohortRate(
        {tracked: 4, inferred: 2, nonPaid: 1},
        {tracked: 10, inferred: 5, nonPaid: 2},
        "inferred",
      ),
      0.4,
    );
  });

  it("returns null when the cohort denominator is zero", () => {
    assert.equal(computeCohortRate({tracked: 1}, {tracked: 0}, "tracked"), null);
  });
});
