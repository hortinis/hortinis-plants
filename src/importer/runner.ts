import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { validate, type ValidationApi } from "../schema/validation-api.js";
import { ImporterRunError } from "./errors.js";
import type {
  ImportEvent,
  ImportOutputDefinition,
  ImportOutputResult,
  ImporterRunOptions,
  ImporterRunResult,
} from "./types.js";

const SOURCE_MANIFEST_SCHEMA = "urn:hortinis:plants:schema:v1:source-manifest";
const RUN_MANIFEST_SCHEMA =
  "urn:hortinis:plants:schema:v1:importer-run-manifest";
const DIAGNOSTIC_SCHEMA = "urn:hortinis:plants:schema:v1:import-diagnostic";

interface SourceResource {
  readonly locator?: unknown;
  readonly checksum?: {
    readonly algorithm?: unknown;
    readonly value?: unknown;
  };
}

interface SourceManifest {
  readonly id?: unknown;
  readonly resources?: unknown;
}

interface OutputState {
  readonly definition: ImportOutputDefinition;
  readonly stream: ReturnType<typeof createWriteStream>;
  readonly completion: Promise<void>;
  readonly hash: ReturnType<typeof createHash>;
  byteSize: number;
  recordCount: number;
}

/** Run an importer into a staged directory and expose it only after validation succeeds. */
export async function runImporter<TConfiguration>(
  options: ImporterRunOptions<TConfiguration>,
): Promise<ImporterRunResult> {
  const { importer } = options;
  const validationApi: ValidationApi = options.validationApi ?? { validate };
  const outputDirectory = resolve(options.outputDirectory);
  const resourceDirectory = resolve(options.resourceDirectory);
  const manifestBytes = await readFile(options.sourceManifestPath);
  const sourceManifestValue = parseSourceManifest(manifestBytes);
  const sourceValidation = validationApi.validate(
    SOURCE_MANIFEST_SCHEMA,
    sourceManifestValue,
  );
  if (!sourceValidation.valid) {
    throw new ImporterRunError(
      "INVALID_SOURCE_MANIFEST",
      `Source manifest failed schema validation: ${JSON.stringify(sourceValidation.errors)}`,
    );
  }
  const sourceManifest = sourceManifestValue as SourceManifest;
  if (typeof sourceManifest.id !== "string") {
    throw new ImporterRunError(
      "INVALID_SOURCE_MANIFEST",
      "Validated source manifest has no string identifier",
    );
  }
  validateDefinition(importer);
  for (const output of importer.outputs) {
    if (output.schemaId === undefined) continue;
    try {
      validationApi.validate(output.schemaId, null);
    } catch (error) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Output ${output.name} references unavailable schema ${output.schemaId}`,
        { cause: error },
      );
    }
  }
  const configurationBytes = serializeConfiguration(importer.configuration);
  const configuration = deepFreeze(
    JSON.parse(
      Buffer.from(configurationBytes).toString("utf8"),
    ) as TConfiguration,
  );
  const configurationSha256 = sha256(configurationBytes);
  const sourceManifestSha256 = sha256(manifestBytes);
  const inputResults = [
    ...(await verifyInputs(
      importer.inputs,
      sourceManifest.resources as readonly SourceResource[],
      resourceDirectory,
    )),
  ].sort((a, b) => String(a.locator).localeCompare(String(b.locator)));

  const parent = dirname(outputDirectory);
  await mkdir(parent, { recursive: true });
  const stagingDirectory = await mkdtemp(join(parent, ".import-run-"));
  const outputs = new Map<string, OutputState>();

  try {
    for (const definition of importer.outputs) {
      const path = join(stagingDirectory, ...definition.path.split("/"));
      await mkdir(dirname(path), { recursive: true });
      const stream = createWriteStream(path, { flags: "wx" });
      const completion = finished(stream);
      void completion.catch(() => undefined);
      outputs.set(definition.name, {
        definition,
        stream,
        completion,
        hash: createHash("sha256"),
        byteSize: 0,
        recordCount: 0,
      });
    }
    const resourcePaths = new Map(
      importer.inputs.map((input) => [
        input.locator,
        resolve(resourceDirectory, input.path),
      ]),
    );
    const context = {
      configuration,
      sourceManifest: sourceManifestValue,
      sourceManifestId: sourceManifest.id,
      resourcePath(locator: string): string {
        const path = resourcePaths.get(locator);
        if (path === undefined) {
          throw new ImporterRunError(
            "INVALID_IMPORTER_DEFINITION",
            `Importer requested undeclared input resource ${locator}`,
          );
        }
        return path;
      },
    };
    let assertionCount = 0;
    let warningCount = 0;
    let rejectedRecordCount = 0;
    let unresolvedMappingCount = 0;
    let eventIndex = 0;
    for await (const event of importer.run(context)) {
      eventIndex += 1;
      const output = getOutput(outputs, event, eventIndex);
      const schemaId =
        output.definition.schemaId ??
        (output.definition.role === "diagnostics"
          ? DIAGNOSTIC_SCHEMA
          : undefined);
      if (schemaId !== undefined) {
        const result = validationApi.validate(schemaId, event.value);
        if (!result.valid) {
          throw new ImporterRunError(
            "OUTPUT_VALIDATION_FAILED",
            `Importer output ${output.definition.name} record ${output.recordCount + 1} failed ${schemaId}: ${JSON.stringify(result.errors)}`,
          );
        }
      }
      const line = serializeCanonicalJson(event.value);
      const framed = Buffer.concat([Buffer.from(line), Buffer.from("\n")]);
      await writeChunk(output.stream, framed);
      output.hash.update(framed);
      output.byteSize += framed.byteLength;
      output.recordCount += 1;
      if (output.definition.role === "assertions") assertionCount += 1;
      if (output.definition.role === "diagnostics") {
        const kind = (event.value as { kind?: unknown }).kind;
        if (kind === "warning") warningCount += 1;
        else if (kind === "rejected-record") rejectedRecordCount += 1;
        else if (kind === "unresolved-mapping") unresolvedMappingCount += 1;
      }
    }

    const finalInputResults = [
      ...(await verifyInputs(
        importer.inputs,
        sourceManifest.resources as readonly SourceResource[],
        resourceDirectory,
      )),
    ].sort((a, b) => String(a.locator).localeCompare(String(b.locator)));
    if (
      Buffer.compare(
        Buffer.from(serializeCanonicalJson(inputResults)),
        Buffer.from(serializeCanonicalJson(finalInputResults)),
      ) !== 0
    ) {
      throw new ImporterRunError(
        "SOURCE_RESOURCE_MISMATCH",
        "A declared input changed while the importer was running",
      );
    }

    await Promise.all([...outputs.values()].map((output) => endStream(output)));
    const outputResults = [...outputs.values()]
      .map(toOutputResult)
      .sort((a, b) => a.path.localeCompare(b.path));
    const tools = Object.fromEntries(
      Object.entries({ ...importer.tools, node: process.version }).sort(
        ([a], [b]) => a.localeCompare(b),
      ),
    );
    const runManifest = {
      schemaVersion: "1.0.0",
      importer: { name: importer.name, version: importer.version },
      sourceManifest: { id: sourceManifest.id, sha256: sourceManifestSha256 },
      inputs: inputResults,
      configuration,
      configurationSha256,
      tools,
      outputs: outputResults,
      counts: {
        assertions: assertionCount,
        warnings: warningCount,
        rejectedRecords: rejectedRecordCount,
        unresolvedMappings: unresolvedMappingCount,
      },
    };
    const manifestValidation = validationApi.validate(
      RUN_MANIFEST_SCHEMA,
      runManifest,
    );
    if (!manifestValidation.valid) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Generated run manifest failed schema validation: ${JSON.stringify(manifestValidation.errors)}`,
      );
    }
    const manifestBytesOut = Buffer.concat([
      Buffer.from(serializeCanonicalJson(runManifest)),
      Buffer.from("\n"),
    ]);
    await writeFile(
      join(stagingDirectory, "importer-run-manifest.json"),
      manifestBytesOut,
      {
        flag: "wx",
      },
    );
    await publishDirectory(stagingDirectory, outputDirectory);
    return {
      manifest: runManifest,
      manifestSha256: sha256(manifestBytesOut),
      outputDirectory,
    };
  } catch (error) {
    for (const output of outputs.values()) {
      if (!output.stream.closed) output.stream.destroy();
    }
    await rm(stagingDirectory, { recursive: true, force: true });
    if (error instanceof ImporterRunError) throw error;
    throw new ImporterRunError("IMPORTER_FAILED", "Importer run failed", {
      cause: error,
    });
  }
}

function parseSourceManifest(bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch (error) {
    throw new ImporterRunError(
      "INVALID_SOURCE_MANIFEST",
      "Source manifest is not valid JSON",
      { cause: error },
    );
  }
}

function validateDefinition<TConfiguration>(
  importer: ImporterRunOptions<TConfiguration>["importer"],
): void {
  if (
    !importer.name ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(
      importer.version,
    )
  ) {
    throw new ImporterRunError(
      "INVALID_IMPORTER_DEFINITION",
      "Importer name and semantic version are required",
    );
  }
  try {
    serializeConfiguration(importer.configuration);
  } catch (error) {
    throw new ImporterRunError(
      "INVALID_IMPORTER_CONFIGURATION",
      "Importer configuration must be a JSON value",
      { cause: error },
    );
  }
  const inputLocators = new Set<string>();
  for (const input of importer.inputs) {
    if (!input.locator || !input.path || inputLocators.has(input.locator)) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Importer has an empty or duplicate input locator ${input.locator}`,
      );
    }
    inputLocators.add(input.locator);
    if (
      input.role === "derived" &&
      (!input.sha256 || !input.preparation || !input.derivedFrom)
    ) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Derived input ${input.locator} must declare checksum and preparation provenance`,
      );
    }
  }
  const upstreamLocators = new Set(
    importer.inputs
      .filter((input) => input.role === "upstream")
      .map((input) => input.locator),
  );
  for (const input of importer.inputs) {
    if (
      input.role === "derived" &&
      !upstreamLocators.has(input.derivedFrom ?? "")
    ) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Derived input ${input.locator} references undeclared upstream input ${input.derivedFrom}`,
      );
    }
  }
  const names = new Set<string>();
  const paths = new Set<string>();
  for (const output of importer.outputs) {
    if (
      !output.name ||
      names.has(output.name) ||
      !isSafeOutputPath(output.path) ||
      output.path === "importer-run-manifest.json" ||
      paths.has(output.path) ||
      !output.mediaType
    ) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Importer output name or path is invalid or duplicated: ${output.path}`,
      );
    }
    if (
      (output.role === "assertions" || output.role === "diagnostics") &&
      output.schemaId === undefined
    ) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Output ${output.name} must declare a schema identifier`,
      );
    }
    if (
      output.role === "diagnostics" &&
      output.schemaId !== DIAGNOSTIC_SCHEMA
    ) {
      throw new ImporterRunError(
        "INVALID_IMPORTER_DEFINITION",
        `Diagnostic output ${output.name} must use ${DIAGNOSTIC_SCHEMA}`,
      );
    }
    names.add(output.name);
    paths.add(output.path);
  }
  for (const path of paths) {
    for (const candidate of paths) {
      if (candidate !== path && candidate.startsWith(`${path}/`)) {
        throw new ImporterRunError(
          "INVALID_IMPORTER_DEFINITION",
          `Importer output paths cannot nest: ${path} and ${candidate}`,
        );
      }
    }
  }
  if (![...importer.outputs].some((item) => item.role === "diagnostics")) {
    throw new ImporterRunError(
      "INVALID_IMPORTER_DEFINITION",
      "Importer must declare a diagnostics output, which may be empty",
    );
  }
}

async function verifyInputs(
  inputs: ImporterRunOptions["importer"]["inputs"],
  sourceResources: readonly SourceResource[],
  resourceDirectory: string,
): Promise<readonly Record<string, unknown>[]> {
  return Promise.all(
    inputs.map(async (input) => {
      const absolutePath = resolve(resourceDirectory, input.path);
      if (
        isAbsolute(input.path) ||
        input.path.includes("\\") ||
        input.path.split("/").some((part) => part === ".." || part === ".") ||
        relative(resourceDirectory, absolutePath).startsWith(`..${sep}`) ||
        relative(resourceDirectory, absolutePath) === ".."
      ) {
        throw new ImporterRunError(
          "INVALID_IMPORTER_DEFINITION",
          `Input path escapes resource directory: ${input.path}`,
        );
      }
      const expectedSha256 = input.sha256;
      let declaredChecksum: SourceResource["checksum"];
      if (input.role === "upstream") {
        const declaration = sourceResources.find(
          (resource) => resource.locator === input.locator,
        );
        if (
          (declaration?.checksum?.algorithm !== "sha256" &&
            declaration?.checksum?.algorithm !== "md5") ||
          typeof declaration.checksum.value !== "string"
        ) {
          throw new ImporterRunError(
            "SOURCE_RESOURCE_MISMATCH",
            `Input ${input.locator} is not declared with a supported checksum by its source manifest`,
          );
        }
        if (
          declaration.checksum.algorithm === "sha256" &&
          expectedSha256 !== undefined &&
          expectedSha256 !== declaration.checksum.value
        ) {
          throw new ImporterRunError(
            "SOURCE_RESOURCE_MISMATCH",
            `Importer checksum disagrees with source manifest for ${input.locator}`,
          );
        }
        declaredChecksum = declaration.checksum;
      }
      if (
        (expectedSha256 !== undefined &&
          !/^[0-9a-f]{64}$/u.test(expectedSha256)) ||
        (input.role === "derived" && expectedSha256 === undefined)
      ) {
        throw new ImporterRunError(
          "INVALID_IMPORTER_DEFINITION",
          `Input ${input.locator} has no valid SHA-256 checksum`,
        );
      }
      let actual: { sha256: string; md5: string; byteSize: number };
      try {
        actual = await hashFile(absolutePath);
      } catch (error) {
        throw new ImporterRunError(
          "SOURCE_RESOURCE_MISMATCH",
          `Unable to read declared input ${input.locator} at ${input.path}`,
          { cause: error },
        );
      }
      const { sha256: actualSha256, byteSize } = actual;
      if (
        declaredChecksum !== undefined &&
        actual[declaredChecksum.algorithm as "md5" | "sha256"] !==
          declaredChecksum.value
      ) {
        throw new ImporterRunError(
          "SOURCE_RESOURCE_MISMATCH",
          `${String(declaredChecksum.algorithm).toUpperCase()} mismatch for input ${input.locator}: expected ${String(declaredChecksum.value)}, got ${actual[declaredChecksum.algorithm as "md5" | "sha256"]}`,
        );
      }
      if (expectedSha256 !== undefined && actualSha256 !== expectedSha256) {
        throw new ImporterRunError(
          "SOURCE_RESOURCE_MISMATCH",
          `SHA-256 mismatch for input ${input.locator}: expected ${expectedSha256}, got ${actualSha256}`,
        );
      }
      return {
        locator: input.locator,
        sha256: actualSha256,
        byteSize,
        role: input.role,
        ...(input.role === "derived"
          ? {
              derivedFrom: input.derivedFrom,
              preparation: input.preparation,
            }
          : {}),
      };
    }),
  );
}

async function hashFile(
  path: string,
): Promise<{ sha256: string; md5: string; byteSize: number }> {
  const sha256 = createHash("sha256");
  const md5 = createHash("md5");
  let byteSize = 0;
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    sha256.update(bytes);
    md5.update(bytes);
    byteSize += bytes.byteLength;
  }
  return { sha256: sha256.digest("hex"), md5: md5.digest("hex"), byteSize };
}

function getOutput(
  outputs: ReadonlyMap<string, OutputState>,
  event: ImportEvent,
  eventIndex: number,
): OutputState {
  if (
    event === null ||
    typeof event !== "object" ||
    typeof event.output !== "string"
  ) {
    throw new ImporterRunError(
      "INVALID_IMPORT_EVENT",
      `Importer emitted malformed event ${eventIndex}`,
    );
  }
  const output = outputs.get(event.output);
  if (output === undefined) {
    throw new ImporterRunError(
      "INVALID_IMPORT_EVENT",
      `Importer emitted event for undeclared output ${event.output}`,
    );
  }
  return output;
}

function toOutputResult(output: OutputState): ImportOutputResult {
  const base = {
    path: output.definition.path,
    role: output.definition.role,
    mediaType: output.definition.mediaType,
    sha256: output.hash.digest("hex"),
    byteSize: output.byteSize,
    recordCount: output.recordCount,
  };
  return output.definition.schemaId === undefined
    ? base
    : { ...base, schemaId: output.definition.schemaId };
}

async function writeChunk(
  stream: ReturnType<typeof createWriteStream>,
  bytes: Buffer,
): Promise<void> {
  if (!stream.write(bytes)) await once(stream, "drain");
}

async function endStream(output: OutputState): Promise<void> {
  output.stream.end();
  await output.completion;
}

async function publishDirectory(
  staging: string,
  destination: string,
): Promise<void> {
  const backup = `${destination}.backup-${randomUUID()}`;
  let movedOld = false;
  try {
    await access(destination);
    await rename(destination, backup);
    movedOld = true;
  } catch (error) {
    if (!isMissingFile(error)) throw error;
  }
  try {
    await rename(staging, destination);
  } catch (error) {
    if (movedOld) await rename(backup, destination);
    throw error;
  }
  if (movedOld)
    await rm(backup, { recursive: true, force: true }).catch(() => undefined);
}

function serializeConfiguration(value: unknown): Uint8Array {
  return serializeCanonicalJson(value);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isSafeOutputPath(path: string): boolean {
  return (
    path.length > 0 &&
    !isAbsolute(path) &&
    path
      .split("/")
      .every((part) => part.length > 0 && part !== "." && part !== "..") &&
    !path.includes("\\")
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
