import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {extractOptimizationMetrics} from "./metaResultMatching.js";

describe("extractOptimizationMetrics", () => {
  it("falls back to conversions for standard registration events", () => {
    assert.deepEqual(
      extractOptimizationMetrics(
        {
          actions: [],
          conversions: [
            {action_type: "offsite_conversion.fb_pixel_complete_registration", value: "7"},
          ],
          cost_per_action_type: [],
          cost_per_conversion: [
            {action_type: "offsite_conversion.fb_pixel_complete_registration", value: "12.34"},
          ],
        },
        "COMPLETE_REGISTRATION",
        null,
      ),
      {
        result_count: 7,
        cost_per_result: 12.34,
      },
    );
  });

  it("matches custom conversion ids in action metrics", () => {
    assert.deepEqual(
      extractOptimizationMetrics(
        {
          actions: [
            {action_type: "offsite_conversion.custom.120000000000001", value: "5"},
          ],
          conversions: [],
          cost_per_action_type: [
            {action_type: "offsite_conversion.custom.120000000000001", value: "9.5"},
          ],
          cost_per_conversion: [],
        },
        "OTHER",
        "120000000000001",
      ),
      {
        result_count: 5,
        cost_per_result: 9.5,
      },
    );
  });

  it("keeps unresolved metrics null", () => {
    assert.deepEqual(
      extractOptimizationMetrics(
        {
          actions: [],
          conversions: [],
          cost_per_action_type: [],
          cost_per_conversion: [],
        },
        "COMPLETE_REGISTRATION",
        null,
      ),
      {
        result_count: null,
        cost_per_result: null,
      },
    );
  });
});
