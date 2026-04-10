import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {buildCsvContent} from "./tableExport.js";

describe("buildCsvContent", () => {
  it("escapes commas, quotes, and nulls", () => {
    const csv = buildCsvContent(
      [
        {label: "Name", csvValue: (row) => row.name},
        {label: "Note", csvValue: (row) => row.note},
      ],
      [
        {name: 'A "quoted" value', note: "one,two"},
        {name: null, note: "plain"},
      ],
    );

    assert.equal(
      csv,
      'Name,Note\n"A ""quoted"" value","one,two"\n,plain',
    );
  });

  it("appends metadata rows after the table when provided", () => {
    const csv = buildCsvContent(
      [{label: "Name", csvValue: (row) => row.name}],
      [{name: "alpha"}],
      {
        metadataRows: [
          ["Date Range", "2026-01-01 to 2026-01-31"],
          ["Exported At", "2026-04-10T12:00:00.000Z"],
        ],
      },
    );

    assert.equal(
      csv,
      "Name\nalpha\n\nDate Range,2026-01-01 to 2026-01-31\nExported At,2026-04-10T12:00:00.000Z",
    );
  });
});
