import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {formatCallToActionText, resolveOptimizationEventLabel} from "./metaAdEnrichment.js";

describe("resolveOptimizationEventLabel", () => {
  it("prefers an explicit optimization event", () => {
    assert.equal(
      resolveOptimizationEventLabel({
        optimization_event: "PowerlifterRegistrationSuccess",
        optimization_goal: "OFFSITE_CONVERSIONS",
      }),
      "PowerlifterRegistrationSuccess",
    );
  });

  it("falls back to the custom conversion name when present", () => {
    assert.equal(
      resolveOptimizationEventLabel({
        custom_conversion_name: "PowerlifterRegistrationSuccess",
        promoted_object: {custom_event_type: "CompleteRegistration"},
      }),
      "PowerlifterRegistrationSuccess",
    );
  });

  it("uses the promoted object custom event type for standard pixel events", () => {
    assert.equal(
      resolveOptimizationEventLabel({
        optimization_goal: "OFFSITE_CONVERSIONS",
        promoted_object: {custom_event_type: "CompleteRegistration"},
      }),
      "CompleteRegistration",
    );
  });

  it("falls back to the optimization goal when no event details are available", () => {
    assert.equal(
      resolveOptimizationEventLabel({
        optimization_goal: "LINK_CLICKS",
      }),
      "LINK_CLICKS",
    );
  });

  it("returns null for invalid data", () => {
    assert.equal(resolveOptimizationEventLabel(null), null);
    assert.equal(resolveOptimizationEventLabel({}), null);
  });
});

describe("formatCallToActionText", () => {
  it("humanizes Meta CTA enums", () => {
    assert.equal(formatCallToActionText("SIGN_UP"), "Sign Up");
    assert.equal(formatCallToActionText("LEARN_MORE"), "Learn More");
  });

  it("preserves already-readable values", () => {
    assert.equal(formatCallToActionText("Sign Up"), "Sign Up");
  });

  it("returns null for empty values", () => {
    assert.equal(formatCallToActionText(""), null);
    assert.equal(formatCallToActionText(null), null);
  });
});
