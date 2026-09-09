import { describe, expect, it } from "vitest";

describe("Vitest test harness", () => {
  it("runs a TypeScript unit test in Node.js", () => {
    expect(process.release.name).toBe("node");
  });
});
