import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {
  formatFeedbackTimestamp,
  formatFeedbackTimestampCsv,
  normalizeFeedbackEntry,
  normalizeFeedbackEntries,
  resolveFeedbackText,
  resolveTimestampMillis,
} from "./feedback.js";

describe("resolveFeedbackText", () => {
  it("uses the first supported feedback field", () => {
    assert.equal(resolveFeedbackText({message: "Fallback", text: "Primary"}), "Primary");
    assert.equal(resolveFeedbackText({feedback: "Direct feedback"}), "Direct feedback");
  });

  it("prefixes the text with the normalized source when present", () => {
    assert.equal(
      resolveFeedbackText({text: "Primary", source: "instagram"}),
      "[INSTAGRAM] Primary",
    );
  });

  it("returns an empty string when no supported field exists", () => {
    assert.equal(resolveFeedbackText({note: "Ignored"}), "");
  });
});

describe("resolveTimestampMillis", () => {
  it("supports Firestore-style timestamps and unix seconds", () => {
    assert.equal(resolveTimestampMillis({toMillis: () => 1_710_000_000_000}), 1_710_000_000_000);
    assert.equal(resolveTimestampMillis(1_710_000_000), 1_710_000_000_000);
  });
});

describe("normalizeFeedbackEntries", () => {
  it("preserves input order and removes blank feedback", () => {
    assert.deepEqual(
      normalizeFeedbackEntries([
        {id: "older", text: "Old", timestamp: 1_710_000_000},
        {id: "skip", text: "   ", timestamp: 1_720_000_000},
        {id: "newer", message: "New", timestamp: 1_720_000_000},
      ]),
      [
        {
          id: "older",
          source: "",
          text: "Old",
          displayText: "Old",
          coach_id: "",
          timestampMs: 1_710_000_000_000,
        },
        {
          id: "newer",
          source: "",
          text: "New",
          displayText: "New",
          coach_id: "",
          timestampMs: 1_720_000_000_000,
        },
      ],
    );
  });
});

describe("normalizeFeedbackEntry", () => {
  it("keeps raw fields for export and formatted text for display", () => {
    assert.deepEqual(
      normalizeFeedbackEntry({
        id: "x",
        source: "instagram",
        text: "hello",
        coach_id: "coach-1",
        timestamp: 1_720_000_000,
      }),
      {
        id: "x",
        source: "instagram",
        text: "hello",
        displayText: "[INSTAGRAM] hello",
        coach_id: "coach-1",
        timestampMs: 1_720_000_000_000,
      },
    );
  });
});

describe("formatFeedbackTimestamp", () => {
  it("returns a fallback label for invalid timestamps", () => {
    assert.equal(formatFeedbackTimestamp(0), "Unknown date");
  });
});

describe("formatFeedbackTimestampCsv", () => {
  it("returns an ISO timestamp for CSV export", () => {
    assert.equal(formatFeedbackTimestampCsv(1_720_000_000_000), "2024-07-03T09:46:40.000Z");
  });
});
