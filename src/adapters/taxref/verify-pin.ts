import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { pipeline } from "node:stream/promises";

interface ZipEntry extends AsyncIterable<Uint8Array> {
  readonly path: string;
  readonly type: string;
  autodrain(): ZipEntry;
}

interface UnzipperModule {
  Parse(options: { readonly forceStream: true }): Duplex;
}

interface TaxrefArchiveMember {
  readonly path: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly role: string;
}

interface TaxrefArchiveIndex {
  readonly release: string;
  readonly archiveLocator: string;
  readonly members: readonly TaxrefArchiveMember[];
}

interface TaxrefSourceManifest {
  readonly resources: readonly {
    readonly locator: string;
    readonly checksum: { readonly algorithm: string; readonly value: string };
    readonly byteSize: number;
  }[];
}

const unzipper = createRequire(import.meta.url)("unzipper") as UnzipperModule;

export class TaxrefPinError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TaxrefPinError";
  }
}

/** Verify the pinned ZIP and every required archive member before parsing. */
export async function verifyTaxrefPin(options: {
  readonly archivePath: string;
  readonly sourceManifestPath: string;
  readonly archiveIndexPath: string;
}): Promise<{ readonly release: string; readonly memberCount: number }> {
  const manifest = await readJson<TaxrefSourceManifest>(
    options.sourceManifestPath,
    "TAXREF source manifest",
  );
  const index = await readJson<TaxrefArchiveIndex>(
    options.archiveIndexPath,
    "TAXREF archive index",
  );
  const archiveResource = manifest.resources.find(
    (resource) => resource.locator === index.archiveLocator,
  );
  if (archiveResource === undefined) {
    throw new TaxrefPinError(
      `TAXREF manifest has no resource for archive locator ${index.archiveLocator}`,
    );
  }

  const archiveDigest = createHash("sha256");
  let archiveByteSize = 0;
  try {
    for await (const chunk of createReadStream(options.archivePath)) {
      const bytes = chunk as Buffer;
      archiveDigest.update(bytes);
      archiveByteSize += bytes.byteLength;
    }
  } catch (error) {
    throw new TaxrefPinError(
      `Cannot read TAXREF archive ${options.archivePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  const actualArchiveHash = archiveDigest.digest("hex");
  if (
    archiveResource.checksum.algorithm !== "sha256" ||
    actualArchiveHash !== archiveResource.checksum.value ||
    archiveByteSize !== archiveResource.byteSize
  ) {
    throw new TaxrefPinError(
      `TAXREF archive mismatch at ${options.archivePath}: expected ${archiveResource.byteSize} bytes and SHA-256 ${archiveResource.checksum.value}; got ${archiveByteSize} bytes and SHA-256 ${actualArchiveHash}`,
    );
  }

  validateIndex(index);
  const expectedByPath = new Map(index.members.map((member) => [member.path, member]));
  const found = new Set<string>();
  const archive = unzipper.Parse({ forceStream: true });
  const completion = pipeline(createReadStream(options.archivePath), archive);
  void completion.catch(() => undefined);
  try {
    for await (const entry of archive as AsyncIterable<ZipEntry>) {
      const expected = expectedByPath.get(entry.path);
      if (entry.type !== "File") {
        entry.autodrain();
        throw new TaxrefPinError(
          `Unexpected non-file TAXREF archive member ${entry.path}`,
        );
      }
      if (expected === undefined) {
        entry.autodrain();
        throw new TaxrefPinError(
          `Unexpected TAXREF archive member ${entry.path}; review the pin before parsing`,
        );
      }
      if (found.has(entry.path)) {
        entry.autodrain();
        throw new TaxrefPinError(
          `Duplicate TAXREF archive member ${entry.path}`,
        );
      }
      found.add(entry.path);
      const digest = createHash("sha256");
      let byteSize = 0;
      for await (const chunk of entry) {
        digest.update(chunk);
        byteSize += chunk.byteLength;
      }
      const sha256 = digest.digest("hex");
      if (byteSize !== expected.byteSize || sha256 !== expected.sha256) {
        throw new TaxrefPinError(
          `TAXREF member mismatch at ${entry.path}: expected ${expected.byteSize} bytes and SHA-256 ${expected.sha256}; got ${byteSize} bytes and SHA-256 ${sha256}`,
        );
      }
    }
    await completion;
  } catch (error) {
    if (error instanceof TaxrefPinError) throw error;
    throw new TaxrefPinError(
      `Cannot inspect TAXREF archive ${options.archivePath}: ${errorMessage(error)}`,
      { cause: error },
    );
  }

  const missing = index.members
    .filter((member) => !found.has(member.path))
    .map((member) => `${member.path} (${member.role})`);
  if (missing.length > 0) {
    throw new TaxrefPinError(
      `TAXREF archive is missing required member(s): ${missing.join(", ")}. Restore the pinned v18.0 archive or review and update the source pin before parsing.`,
    );
  }
  return { release: index.release, memberCount: found.size };
}

function validateIndex(index: TaxrefArchiveIndex): void {
  if (
    typeof index.release !== "string" ||
    typeof index.archiveLocator !== "string" ||
    !Array.isArray(index.members) ||
    index.members.length === 0
  ) {
    throw new TaxrefPinError("TAXREF archive index is incomplete");
  }
  const paths = new Set<string>();
  for (const member of index.members) {
    if (
      typeof member.path !== "string" ||
      typeof member.role !== "string" ||
      !Number.isSafeInteger(member.byteSize) ||
      member.byteSize < 0 ||
      !/^[0-9a-f]{64}$/u.test(member.sha256)
    ) {
      throw new TaxrefPinError(
        `Invalid TAXREF archive index entry ${JSON.stringify(member)}`,
      );
    }
    if (paths.has(member.path)) {
      throw new TaxrefPinError(
        `Duplicate path ${member.path} in TAXREF archive index`,
      );
    }
    paths.add(member.path);
  }
}

async function readJson<T>(path: string, label: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new TaxrefPinError(
      `Cannot read ${label} at ${path}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
