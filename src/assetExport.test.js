import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {buildAssetBaseName} from "./assetExport.js";

describe("buildAssetBaseName", () => {
  it("sanitizes and joins filename parts", () => {
    assert.equal(
      buildAssetBaseName(["Campaign Name", "Ad / Name", "Crèative"]),
      "Campaign-Name__Ad-Name__Creative",
    );
  });

  it("drops empty parts and preserves stable fallbacks", () => {
    assert.equal(buildAssetBaseName(["", null, "123"]), "123");
  });

  it("preserves explicit ids in the filename", () => {
    assert.equal(
      buildAssetBaseName(["creative-123456", "ad-987654", "Campaign Name"]),
      "creative-123456__ad-987654__Campaign-Name",
    );
  });
});
