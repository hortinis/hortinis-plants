import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getGrowWfoStatus } from "../../src/curation/grow-wfo-status.js";

describe("GROW/WFO completion status", () => {
  it("keeps clean-checkout validity separate from draft coverage", async () => {
    const draftsDirectory = await mkdtemp(join("/tmp", "hortinis-c4-status-"));
    const result = await getGrowWfoStatus({
      repositoryRoot: process.cwd(),
      draftsDirectory,
    });

    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.draftsAvailable).toBe(false);
    expect(result.gates.c4).toBe("in progress");
    expect(result.gates.identity.status).toBe("in progress");
  });
});
