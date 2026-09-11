import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export interface ExpectedValidationError {
  readonly instancePath: string;
  readonly keyword: string;
}

export type FixtureExpectation =
  | { readonly valid: true }
  | {
      readonly valid: false;
      readonly errors: ExpectedValidationError[];
    }
  | { readonly pipelineError: string };

export interface ConformanceFixtureCase {
  readonly id: string;
  readonly schemaId: string;
  readonly fixturePath: string;
  readonly expected: FixtureExpectation;
}

interface ManifestDocument {
  readonly schemaId?: unknown;
  readonly cases?: unknown;
}

interface RawCase {
  readonly id?: unknown;
  readonly schemaId?: unknown;
  readonly fixture?: unknown;
  readonly expected?: unknown;
}

export async function loadConformanceFixtures(
  manifestPath: string,
): Promise<ConformanceFixtureCase[]> {
  const manifestDirectory = resolve(dirname(manifestPath));
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ManifestDocument;
  if (typeof manifest.schemaId !== "string" || manifest.schemaId.length === 0) {
    throw new Error(`Fixture manifest ${manifestPath} must declare schemaId`);
  }
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0) {
    throw new Error(`Fixture manifest ${manifestPath} must contain cases`);
  }

  const ids = new Set<string>();
  const fixtures: ConformanceFixtureCase[] = [];
  for (const [index, value] of manifest.cases.entries()) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Fixture case ${index} in ${manifestPath} must be an object`,
      );
    }
    const candidate = value as RawCase;
    if (
      typeof candidate.id !== "string" ||
      candidate.id.length === 0 ||
      ids.has(candidate.id)
    ) {
      throw new Error(
        `Fixture case ${index} in ${manifestPath} has an invalid or duplicate id`,
      );
    }
    if (
      typeof candidate.fixture !== "string" ||
      candidate.fixture.length === 0
    ) {
      throw new Error(`Fixture case ${candidate.id} must declare fixture`);
    }
    if (!isSafeRelativePath(candidate.fixture)) {
      throw new Error(
        `Fixture case ${candidate.id} has an unsafe fixture path`,
      );
    }
    const expected = parseExpectation(candidate.expected, candidate.id);
    const fixturePath = resolve(manifestDirectory, candidate.fixture);
    await readFile(fixturePath, "utf8");
    ids.add(candidate.id);
    fixtures.push({
      id: candidate.id,
      schemaId:
        typeof candidate.schemaId === "string" && candidate.schemaId.length > 0
          ? candidate.schemaId
          : manifest.schemaId,
      fixturePath,
      expected,
    });
  }
  return fixtures;
}

export async function readFixture(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function parseExpectation(value: unknown, caseId: string): FixtureExpectation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Fixture case ${caseId} has an invalid expected result`);
  }
  const candidate = value as {
    valid?: unknown;
    errors?: unknown;
    pipelineError?: unknown;
  };
  if (candidate.valid === true && candidate.errors === undefined) {
    return { valid: true };
  }
  if (candidate.valid === false && Array.isArray(candidate.errors)) {
    const errors = candidate.errors.map((error) => {
      if (
        error === null ||
        typeof error !== "object" ||
        typeof (error as { instancePath?: unknown }).instancePath !==
          "string" ||
        typeof (error as { keyword?: unknown }).keyword !== "string"
      ) {
        throw new Error(`Fixture case ${caseId} has an invalid expected error`);
      }
      return error as ExpectedValidationError;
    });
    if (errors.length === 0) {
      throw new Error(`Fixture case ${caseId} must expect at least one error`);
    }
    return { valid: false, errors };
  }
  if (
    typeof candidate.pipelineError === "string" &&
    candidate.pipelineError.length > 0
  ) {
    return { pipelineError: candidate.pipelineError };
  }
  throw new Error(`Fixture case ${caseId} has an invalid expected result`);
}

function isSafeRelativePath(path: string): boolean {
  return (
    !isAbsolute(path) &&
    !path.split("/").includes("..") &&
    relative(".", path) === path
  );
}
