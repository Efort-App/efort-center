import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  computeAthleteTypeDailyCoachMix,
  computeAthleteTypeDailyDistribution,
  computeAthleteTypeDistribution,
  normalizeAthleteTypes,
} from "./athleteTypeDistribution.js";

describe("normalizeAthleteTypes", () => {
  it("normalizes and deduplicates values", () => {
    assert.deepEqual(
      normalizeAthleteTypes(["powerlifters", "powerlifters", "Body Builders", "other"]),
      ["powerlifters", "bodybuilders", "other"],
    );
  });

  it("supports legacy comma-separated strings", () => {
    assert.deepEqual(normalizeAthleteTypes("power lifters, bodybuilder, other"), [
      "powerlifters",
      "bodybuilders",
      "other",
    ]);
  });

  it("returns empty array for invalid data", () => {
    assert.deepEqual(normalizeAthleteTypes(null), []);
    assert.deepEqual(normalizeAthleteTypes("unknown,invalid"), []);
  });
});

describe("computeAthleteTypeDistribution", () => {
  it("counts multi-select responses and computes response-share ratios", () => {
    const result = computeAthleteTypeDistribution([
      {onboarding_athletes_types: ["powerlifters", "bodybuilders"]},
      {onboarding_athletes_types: ["powerlifters"]},
      {onboarding_athletes_types: ["other"]},
    ]);

    assert.deepEqual(result.counts, {
      powerlifters: 2,
      bodybuilders: 1,
      other: 1,
    });
    assert.equal(result.totalResponses, 4);
    assert.equal(result.respondingCoaches, 3);
    assert.equal(result.excludedMissing, 0);
    assert.equal(result.ratios.powerlifters, 0.5);
    assert.equal(result.ratios.bodybuilders, 0.25);
    assert.equal(result.ratios.other, 0.25);
    assert.equal(
      result.ratios.powerlifters + result.ratios.bodybuilders + result.ratios.other,
      1,
    );
  });

  it("excludes coaches with missing or invalid athlete type data", () => {
    const result = computeAthleteTypeDistribution([
      {onboarding_athletes_types: ["powerlifters"]},
      {onboarding_athletes_types: []},
      {onboarding_athletes_types: null},
      {onboarding_athletes_types: ["invalid"]},
    ]);

    assert.deepEqual(result.counts, {
      powerlifters: 1,
      bodybuilders: 0,
      other: 0,
    });
    assert.equal(result.totalResponses, 1);
    assert.equal(result.respondingCoaches, 1);
    assert.equal(result.excludedMissing, 3);
  });

  it("handles zero-data safely", () => {
    const result = computeAthleteTypeDistribution([]);

    assert.equal(result.totalResponses, 0);
    assert.equal(result.respondingCoaches, 0);
    assert.equal(result.excludedMissing, 0);
    assert.deepEqual(result.ratios, {
      powerlifters: null,
      bodybuilders: null,
      other: null,
    });
  });
});

describe("computeAthleteTypeDailyDistribution", () => {
  it("builds a per-day distribution that sums to 100%", () => {
    const result = computeAthleteTypeDailyDistribution([
      {
        trial_period_start_date: new Date("2026-02-20T10:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters", "bodybuilders"],
      },
      {
        trial_period_start_date: new Date("2026-02-20T13:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters"],
      },
      {
        trial_period_start_date: new Date("2026-02-21T08:00:00.000Z"),
        onboarding_athletes_types: ["other"],
      },
      {
        trial_period_start_date: new Date("2026-02-21T10:00:00.000Z"),
        onboarding_athletes_types: ["bodybuilders", "other"],
      },
    ]);

    assert.deepEqual(result.labels, ["2026-02-20", "2026-02-21"]);
    assert.deepEqual(result.powerlifters, [66.66666666666666, 0]);
    assert.deepEqual(result.bodybuilders, [33.33333333333333, 33.33333333333333]);
    assert.deepEqual(result.other, [0, 66.66666666666666]);
    assert.deepEqual(result.powerliftersCounts, [2, 0]);
    assert.deepEqual(result.bodybuildersCounts, [1, 1]);
    assert.deepEqual(result.otherCounts, [0, 2]);
    assert.deepEqual(result.totalResponsesByDate, [3, 3]);

    for (let i = 0; i < result.labels.length; i += 1) {
      const total =
        result.powerlifters[i] + result.bodybuilders[i] + result.other[i];
      assert.ok(Math.abs(total - 100) < 0.000001);
    }
  });

  it("excludes missing and invalid responses from daily series", () => {
    const result = computeAthleteTypeDailyDistribution([
      {
        trial_period_start_date: new Date("2026-02-20T10:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters"],
      },
      {
        trial_period_start_date: new Date("2026-02-20T12:00:00.000Z"),
        onboarding_athletes_types: [],
      },
      {
        trial_period_start_date: new Date("2026-02-21T12:00:00.000Z"),
        onboarding_athletes_types: ["invalid"],
      },
    ]);

    assert.deepEqual(result.labels, ["2026-02-20"]);
    assert.deepEqual(result.powerlifters, [100]);
    assert.deepEqual(result.bodybuilders, [0]);
    assert.deepEqual(result.other, [0]);
    assert.deepEqual(result.powerliftersCounts, [1]);
    assert.deepEqual(result.bodybuildersCounts, [0]);
    assert.deepEqual(result.otherCounts, [0]);
    assert.deepEqual(result.totalResponsesByDate, [1]);
  });
});

describe("computeAthleteTypeDailyCoachMix", () => {
  it("groups each coach into one bucket per day", () => {
    const result = computeAthleteTypeDailyCoachMix([
      {
        trial_period_start_date: new Date("2026-02-20T10:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters"],
      },
      {
        trial_period_start_date: new Date("2026-02-20T11:00:00.000Z"),
        onboarding_athletes_types: ["bodybuilders"],
      },
      {
        trial_period_start_date: new Date("2026-02-20T12:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters", "bodybuilders"],
      },
      {
        trial_period_start_date: new Date("2026-02-20T13:00:00.000Z"),
        onboarding_athletes_types: ["other"],
      },
      {
        trial_period_start_date: new Date("2026-02-20T14:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters", "other"],
      },
      {
        trial_period_start_date: new Date("2026-02-21T10:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters", "bodybuilders"],
      },
    ]);

    assert.deepEqual(result.labels, ["2026-02-20", "2026-02-21"]);
    assert.deepEqual(result.onlyPowerlifting, [1, 0]);
    assert.deepEqual(result.onlyBodybuilding, [1, 0]);
    assert.deepEqual(result.powerliftingAndBodybuilding, [1, 1]);
    assert.deepEqual(result.other, [2, 0]);
  });

  it("excludes invalid or missing athlete-type answers", () => {
    const result = computeAthleteTypeDailyCoachMix([
      {
        trial_period_start_date: new Date("2026-02-20T10:00:00.000Z"),
        onboarding_athletes_types: [],
      },
      {
        trial_period_start_date: new Date("2026-02-20T12:00:00.000Z"),
        onboarding_athletes_types: ["invalid"],
      },
      {
        trial_period_start_date: new Date("2026-02-20T14:00:00.000Z"),
        onboarding_athletes_types: ["powerlifters"],
      },
    ]);

    assert.deepEqual(result.labels, ["2026-02-20"]);
    assert.deepEqual(result.onlyPowerlifting, [1]);
    assert.deepEqual(result.onlyBodybuilding, [0]);
    assert.deepEqual(result.powerliftingAndBodybuilding, [0]);
    assert.deepEqual(result.other, [0]);
  });
});
