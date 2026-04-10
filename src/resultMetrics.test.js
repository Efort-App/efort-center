import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  rollupAdsetResultMetrics,
  resolveInternalCostPerResult,
  resolveInternalResultCount,
} from "./resultMetrics.js";

describe("resolveInternalResultCount", () => {
  it("uses signups for complete registration", () => {
    assert.equal(
      resolveInternalResultCount({
        optimizationEvent: "COMPLETE_REGISTRATION",
        cookieAcceptedSignups: 12,
        cookieAcceptedPowerliftersSelected: 3,
      }),
      12,
    );
  });

  it("uses powerlifter signups for other", () => {
    assert.equal(
      resolveInternalResultCount({
        optimizationEvent: "OTHER",
        cookieAcceptedSignups: 12,
        cookieAcceptedPowerliftersSelected: 5,
      }),
      5,
    );
  });

  it("returns null for unsupported events", () => {
    assert.equal(
      resolveInternalResultCount({
        optimizationEvent: "LINK_CLICKS",
        cookieAcceptedSignups: 12,
        cookieAcceptedPowerliftersSelected: 5,
      }),
      null,
    );
  });
});

describe("resolveInternalCostPerResult", () => {
  it("calculates spend divided by result count", () => {
    assert.equal(
      resolveInternalCostPerResult({
        hasMetaAttributionLink: true,
        spend: 40,
        resultCount: 5,
      }),
      8,
    );
  });

  it("returns null when the row has no result count", () => {
    assert.equal(
      resolveInternalCostPerResult({
        hasMetaAttributionLink: true,
        spend: 40,
        resultCount: 0,
      }),
      null,
    );
  });
});

describe("rollupAdsetResultMetrics", () => {
  it("sums child ad results and recomputes cost per result", () => {
    assert.deepEqual(
      rollupAdsetResultMetrics(
        {
          hasMetaAttributionLink: true,
          spend: 290,
          result_count: 28,
          cost_per_result: 10.36,
        },
        [
          {result_count: 12},
          {result_count: 17},
          {result_count: 0},
        ],
      ),
      {
        hasMetaAttributionLink: true,
        spend: 290,
        result_count: 29,
        cost_per_result: 10,
      },
    );
  });

  it("keeps the ad set row unchanged when no child results are resolved", () => {
    const row = {
      hasMetaAttributionLink: true,
      spend: 290,
      result_count: null,
      cost_per_result: null,
    };
    assert.equal(rollupAdsetResultMetrics(row, [{result_count: null}]), row);
  });
});
