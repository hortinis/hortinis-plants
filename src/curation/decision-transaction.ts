import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { readJsonLines } from "../serialization/json-lines.js";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";
import { same, type RecordValue } from "./curation-artifacts.js";

export interface CollectionDescriptor {
  readonly role: string;
  readonly path: string;
  readonly schemaId: string;
}

export async function readCollections(
  directory: string,
  descriptors: readonly CollectionDescriptor[],
): Promise<Map<string, RecordValue[]>> {
  const result = new Map<string, RecordValue[]>();
  for (const descriptor of descriptors) {
    const rows: RecordValue[] = [];
    for await (const entry of readJsonLines(
      createReadStream(join(directory, descriptor.path)),
    ))
      rows.push(entry.value as RecordValue);
    result.set(descriptor.role, rows);
  }
  return result;
}

/** Includes manifest bytes; collection paths are framing, never catalog identifiers. */
export async function authoringFingerprint(
  directory: string,
  descriptors: readonly { readonly path: string }[],
): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [
    "dataset-manifest.json",
    ...descriptors.map((row) => row.path),
  ].sort()) {
    hash.update(path);
    hash.update("\0");
    for await (const chunk of createReadStream(join(directory, path)))
      hash.update(chunk as Buffer);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export async function stageDataset(
  source: string,
  collections: ReadonlyMap<string, readonly RecordValue[]>,
  descriptors: readonly { readonly role: string; readonly path: string }[],
  original?: ReadonlyMap<string, readonly RecordValue[]>,
): Promise<string> {
  const stage = await mkdtemp(join(dirname(source), ".curation-apply-"));
  try {
    for (const entry of await readdir(source))
      await cp(join(source, entry), join(stage, entry), {
        recursive: true,
        force: true,
        dereference: true,
      });
    for (const descriptor of descriptors) {
      const rows = collections.get(descriptor.role) ?? [];
      if (
        original?.has(descriptor.role) &&
        same(original.get(descriptor.role), rows)
      )
        continue;
      await mkdir(dirname(join(stage, descriptor.path)), { recursive: true });
      const sorted = [...rows].sort((a, b) =>
        String(a.id).localeCompare(String(b.id)),
      );
      await writeFile(
        join(stage, descriptor.path),
        Buffer.concat(
          sorted.map((row) =>
            Buffer.concat([
              Buffer.from(serializeCanonicalJson(row)),
              Buffer.from("\n"),
            ]),
          ),
        ),
      );
    }
    return stage;
  } catch (error) {
    await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

export type TransactionPhase = "staged" | "validated" | "backed-up";

/** A recoverable directory swap. Cleanup failure after commit is reported, never a failed transaction. */
export async function publishDirectory(
  stage: string,
  destination: string,
  onPhase?: (phase: TransactionPhase) => Promise<void>,
): Promise<string | undefined> {
  const backupRoot = await mkdtemp(
    join(dirname(destination), ".curation-backup-"),
  );
  const backup = join(backupRoot, "dataset");
  try {
    await rename(destination, backup);
    try {
      await onPhase?.("backed-up");
      await rename(stage, destination);
    } catch (error) {
      await rename(backup, destination);
      throw error;
    }
  } catch (error) {
    // Keep the backup if restoration itself failed.
    const entries = await readdir(backupRoot);
    if (entries.length === 0)
      await rm(backupRoot, { recursive: true, force: true });
    throw error;
  }
  try {
    await rm(backupRoot, { recursive: true, force: true });
  } catch {
    return backup;
  }
  return undefined;
}

export async function acquireDatasetLock(
  directory: string,
): Promise<() => Promise<void>> {
  const path = `${directory}.apply-lock`;
  await mkdir(path);
  return () => rm(path, { recursive: true });
}

export async function runDecisionTransaction(options: {
  readonly directory: string;
  readonly collections: ReadonlyMap<string, readonly RecordValue[]>;
  readonly descriptors: readonly CollectionDescriptor[];
  readonly original?: ReadonlyMap<string, readonly RecordValue[]>;
  readonly manifest?: RecordValue;
  readonly onPhase?: (phase: TransactionPhase) => Promise<void>;
  readonly validateStage: (directory: string) => Promise<void>;
  readonly beforePublish?: () => Promise<void>;
  readonly fingerprint: (directory: string) => Promise<string>;
}): Promise<{
  readonly datasetSha256: string;
  readonly retainedBackup?: string;
}> {
  let stage: string | undefined;
  try {
    stage = await stageDataset(
      options.directory,
      options.collections,
      options.descriptors,
      options.original,
    );
    if (options.manifest !== undefined)
      await writeFile(
        join(stage, "dataset-manifest.json"),
        Buffer.concat([
          Buffer.from(serializeCanonicalJson(options.manifest)),
          Buffer.from("\n"),
        ]),
      );
    await options.onPhase?.("staged");
    await options.validateStage(stage);
    const datasetSha256 = await options.fingerprint(stage);
    await options.onPhase?.("validated");
    await options.beforePublish?.();
    const retainedBackup = await publishDirectory(
      stage,
      options.directory,
      options.onPhase,
    );
    stage = undefined;
    return {
      datasetSha256,
      ...(retainedBackup === undefined ? {} : { retainedBackup }),
    };
  } finally {
    if (stage !== undefined) await rm(stage, { recursive: true, force: true });
  }
}
