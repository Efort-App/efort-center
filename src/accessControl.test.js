import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {hasDashboardAccess, normalizeEmail} from "./accessControl.js";

describe("normalizeEmail", () => {
  it("trims and lowercases emails", () => {
    assert.equal(normalizeEmail("  EfortApp@Gmail.com "), "efortapp@gmail.com");
  });

  it("returns an empty string for non-strings", () => {
    assert.equal(normalizeEmail(null), "");
    assert.equal(normalizeEmail(undefined), "");
  });
});

describe("hasDashboardAccess", () => {
  it("allows both dashboard accounts", () => {
    assert.equal(hasDashboardAccess({email: "efortapp@gmail.com"}), true);
    assert.equal(hasDashboardAccess({email: "testec202405@gmail.com"}), true);
  });

  it("matches emails case-insensitively", () => {
    assert.equal(hasDashboardAccess({email: " TestEc202405@GMAIL.com "}), true);
  });

  it("rejects other accounts", () => {
    assert.equal(hasDashboardAccess({email: "someone@example.com"}), false);
    assert.equal(hasDashboardAccess({}), false);
  });
});
