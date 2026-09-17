import { describe, expect, it } from "vitest";
import {
  makeQualifiedSourceLocationKey,
  makeQualifiedSourceRecordKey,
  makeSourceReleaseKey,
  makeSemanticSubrecordKey,
  serializeQualifiedSourceLocationKey,
  serializeQualifiedSourceRecordKey,
  serializeSemanticSubrecordKey,
  sourceRecordKey,
} from "../../src/domain/source-keys.js";

describe("qualified source keys", () => {
  const grow = makeSourceReleaseKey("grow", "grow-manifest", "2020");
  const cropGraph = makeSourceReleaseKey(
    "cropgraph",
    "cropgraph-manifest",
    "commit-1",
  );

  it("keeps equal local record IDs distinct across sources", () => {
    const growRecord = makeQualifiedSourceRecordKey(grow, "1");
    const cropGraphRecord = makeQualifiedSourceRecordKey(cropGraph, "1");
    expect(serializeQualifiedSourceRecordKey(growRecord)).not.toBe(
      serializeQualifiedSourceRecordKey(cropGraphRecord),
    );
    expect(sourceRecordKey({ sourceRecordKey: growRecord })).not.toBe(
      sourceRecordKey({ sourceRecordKey: cropGraphRecord }),
    );
  });

  it("does not use source array order for record keys", () => {
    const first = makeQualifiedSourceRecordKey(grow, "1");
    const second = makeQualifiedSourceRecordKey(grow, "2");
    const forward = [first, second]
      .map((key) => serializeQualifiedSourceRecordKey(key))
      .sort();
    const reversed = [second, first]
      .map((key) => serializeQualifiedSourceRecordKey(key))
      .sort();
    expect(forward).toEqual(reversed);
  });

  it("preserves semantic path identity across repeated construction", () => {
    const record = makeQualifiedSourceRecordKey(grow, "1");
    const first = makeSemanticSubrecordKey(record, [
      { kind: "window", id: "direct-sow" },
      { kind: "claim", id: "start" },
    ]);
    const reordered = makeSemanticSubrecordKey(record, [
      { kind: "window", id: "direct-sow" },
      { kind: "claim", id: "start" },
    ]);
    expect(serializeSemanticSubrecordKey(first)).toBe(
      serializeSemanticSubrecordKey(reordered),
    );
  });

  it("qualifies source locations by release", () => {
    const growLocation = makeQualifiedSourceLocationKey(grow, "ATC");
    const cropGraphLocation = makeQualifiedSourceLocationKey(cropGraph, "ATC");
    expect(serializeQualifiedSourceLocationKey(growLocation)).not.toBe(
      serializeQualifiedSourceLocationKey(cropGraphLocation),
    );
  });
});
