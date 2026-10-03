import { readFile } from "node:fs/promises";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import {
  applyCurationDecision,
  type IntegratedDecisionInput,
} from "./curation-apply.js";
import { resolve, join } from "node:path";
import { WFO_SNAPSHOT_FILENAME } from "../adapters/wfo/constants.js";
import { generateIntegratedReviewPackets } from "./integrated-review-packets.js";
import { createWfoLookupProposal } from "./wfo-lookup.js";
import {
  getCurationStatus,
  showCurationRecord,
} from "./curation-inspection.js";
import {
  curationPaths,
  validateCurationDataset,
  type CurationOptions,
} from "./curation-validation.js";
import { field, records, readObject } from "./curation-artifacts.js";

const commands = ["drafts", "lookup", "show", "status", "validate", "apply"];
const command = process.argv[2];
const args = process.argv.slice(3).filter((argument) => argument !== "--");
const common = ["dataset", "drafts", "scope", "json", "help"];
const audit = ["deep", "run", "input", "source-directory", "cohort"];
const allowed: Readonly<Record<string, readonly string[]>> = {
  apply: [...common, "input", "run", "resource", "source-directory", "cohort"],
  drafts: [...common, "run", "cohort", "output", "source-manifest"],
  lookup: [...common, "name", "id", "snapshot", "source-manifest"],
  show: [
    ...common,
    ...audit,
    "packet",
    "source-record",
    "source-id",
    "source-release",
    "source-manifest-id",
  ],
  status: [...common, ...audit, "targets"],
  validate: [...common, ...audit],
};

try {
  if (command === undefined || !commands.includes(command))
    throw new Error(`Choose a curation command: ${commands.join(", ")}`);
  const values = parseOptions(args, allowed[command]!);
  if (values.has("help")) {
    console.log(
      `curate:${command} options: ${allowed[command]!.map((name) => `--${name}`).join(" ")}`,
    );
  } else {
    const result = await run(command, values);
    if (values.has("json")) console.log(JSON.stringify(result));
    else print(command, result);
    if ("valid" in result && result.valid === false) process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseOptions(
  args: readonly string[],
  allowed: readonly string[],
): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const name = argument.slice(2);
    if (!argument.startsWith("--") || !allowed.includes(name))
      throw new Error(`Unknown option ${argument}`);
    const flag = ["json", "deep", "help"].includes(name);
    const value = flag ? "true" : args[++index];
    if (value === undefined || value.startsWith("--") || value.trim() === "")
      throw new Error(`${argument} requires a value`);
    if (
      values.has(name) &&
      ![
        "run",
        "input",
        "source-directory",
        "source-manifest",
        "resource",
      ].includes(name)
    )
      throw new Error(`Duplicate option ${argument}`);
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  return values;
}

function mappings(
  values: Map<string, string[]>,
  name: string,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values.get(name) ?? []) {
    const index = value.indexOf("=");
    if (index < 1 || index === value.length - 1)
      throw new Error(`--${name} requires role=path`);
    const role = value.slice(0, index);
    if (Object.hasOwn(result, role))
      throw new Error(`Duplicate --${name} role ${role}`);
    result[role] = resolve(value.slice(index + 1));
  }
  return result;
}

async function run(command: string, values: Map<string, string[]>) {
  const one = (name: string) => values.get(name)?.[0];
  const options: CurationOptions = {
    ...(one("dataset") === undefined
      ? {}
      : { datasetDirectory: resolve(one("dataset")!) }),
    ...(one("drafts") === undefined
      ? {}
      : { draftsDirectory: resolve(one("drafts")!) }),
    ...(one("scope") === undefined
      ? {}
      : { scopePath: resolve(one("scope")!) }),
    ...(one("cohort") === undefined
      ? {}
      : { cohortPath: resolve(one("cohort")!) }),
    deep: values.has("deep"),
    runDirectories: mappings(values, "run"),
    inputPaths: mappings(values, command === "apply" ? "resource" : "input"),
    sourceDirectories: mappings(values, "source-directory"),
  };
  for (const role of Object.keys(options.runDirectories!))
    if (
      ![
        "grow-importer-run-manifest",
        "cropgraph-importer-run-manifest",
        "wfo-reconciliation-run-manifest",
        "taxref-wfo-reconciliation-run-manifest",
      ].includes(role)
    )
      throw new Error(`Unknown run role ${role}`);
  for (const kind of Object.keys(options.sourceDirectories!))
    if (!["grow", "cropgraph", "taxref"].includes(kind))
      throw new Error(`Unknown source-directory kind ${kind}`);
  const paths = curationPaths(options);
  if (command === "apply") {
    if (one("input") === undefined || values.get("input")!.length !== 1)
      throw new Error("Exactly one --input decision file is required");
    return applyCurationDecision(
      parseJsonStrict(
        await readFile(resolve(one("input")!)),
      ) as IntegratedDecisionInput,
      options,
    );
  }
  if (command === "validate") {
    const result = await validateCurationDataset(options);
    return {
      valid: result.valid,
      structural: result.structural,
      sourceAudit: result.sourceAudit,
    };
  }
  if (command === "status")
    return getCurationStatus({
      ...options,
      ...(one("targets") === undefined
        ? {}
        : { targetsPath: resolve(one("targets")!) }),
    });
  if (command === "show") {
    if ((one("packet") === undefined) === (one("source-record") === undefined))
      throw new Error("Choose exactly one of --packet or --source-record");
    if (
      one("packet") !== undefined &&
      ["source-id", "source-release", "source-manifest-id"].some((name) =>
        values.has(name),
      )
    )
      throw new Error("Source qualifiers require --source-record");
    return showCurationRecord(
      one("packet") === undefined
        ? {
            recordId: one("source-record")!,
            ...(one("source-id") === undefined
              ? {}
              : { sourceId: one("source-id")! }),
            ...(one("source-release") === undefined
              ? {}
              : { sourceReleaseId: one("source-release")! }),
            ...(one("source-manifest-id") === undefined
              ? {}
              : { sourceManifestId: one("source-manifest-id")! }),
          }
        : { packetId: one("packet")! },
      options,
    );
  }
  if (command === "lookup") {
    if ((one("name") === undefined) === (one("id") === undefined))
      throw new Error("Choose exactly one of --name or --id");
    if ((values.get("source-manifest")?.length ?? 0) > 1)
      throw new Error("Lookup accepts one --source-manifest path");
    const datasetManifest = await readObject(
      join(paths.dataset, "dataset-manifest.json"),
    );
    const sourceManifestPath =
      one("source-manifest") ??
      records(datasetManifest.dependencies).find(
        (row) =>
          row.role === "source-manifest" &&
          row.id === "source_manifest_wfo_plant_list_2026_06",
      )?.path;
    if (typeof sourceManifestPath !== "string")
      throw new Error(
        "Dataset has no pinned WFO manifest; supply --source-manifest",
      );
    // An explicit scope is checked before looking up new, still-unreviewed WFO evidence.
    if (options.scopePath !== undefined || values.has("drafts")) {
      const status = await getCurationStatus(options);
      if (!status.valid || status.draftIntegrity.valid !== true)
        throw new Error("Explicit review scope is unavailable or invalid");
    }
    return createWfoLookupProposal({
      sourceManifestPath: resolve(paths.root, sourceManifestPath),
      snapshotPath: resolve(
        one("snapshot") ??
          join(
            paths.root,
            `.cache/source-inputs/wfo/2026-06/${WFO_SNAPSHOT_FILENAME}`,
          ),
      ),
      query:
        one("name") === undefined
          ? { by: "id", value: one("id")! }
          : { by: "name", value: one("name")! },
    });
  }
  const runs = mappings(values, "run");
  const sourceManifestPaths = mappings(values, "source-manifest");
  for (const kind of Object.keys(sourceManifestPaths))
    if (!["grow", "cropgraph", "wfo", "taxref"].includes(kind))
      throw new Error(`Unknown source manifest kind ${kind}`);
  const run = (role: string, directory: string) =>
    runs[role] ?? join(paths.root, `.cache/import-runs/${directory}/latest`);
  return generateIntegratedReviewPackets({
    datasetDirectory: paths.dataset,
    growRunDirectory: run("grow-importer-run-manifest", "grow"),
    cropGraphRunDirectory: run("cropgraph-importer-run-manifest", "cropgraph"),
    wfoRunDirectory: run("wfo-reconciliation-run-manifest", "wfo"),
    taxrefWfoRunDirectory: run(
      "taxref-wfo-reconciliation-run-manifest",
      "taxref-wfo",
    ),
    outputDirectory: resolve(one("output") ?? paths.drafts),
    sourceManifestPaths,
    ...(options.cohortPath === undefined
      ? {}
      : { cohortPath: options.cohortPath }),
    ...(options.scopePath === undefined
      ? {}
      : { scopePath: options.scopePath }),
  });
}

function print(command: string, result: Awaited<ReturnType<typeof run>>): void {
  if (command === "apply") {
    const value = result as Awaited<ReturnType<typeof applyCurationDecision>>;
    console.log(
      `Applied ${value.transactionId}: ${value.created} created, ${value.unchanged} unchanged, ${value.replaced} replaced; ${value.decisions} reviewed dispositions.`,
    );
    if (value.retainedBackup !== undefined)
      console.log(`Committed; retained backup: ${value.retainedBackup}`);
  } else if (
    command === "validate" ||
    command === "status" ||
    command === "show"
  ) {
    const value = result as Awaited<ReturnType<typeof getCurationStatus>>;
    console.log(`Structural validation: ${value.structural.status}`);
    console.log(`Source audit: ${value.sourceAudit.status}`);
    for (const issue of [
      ...value.structural.issues,
      ...value.sourceAudit.issues,
    ])
      console.log(`${issue.path}: ${issue.code}: ${issue.message}`);
    if ("draftIntegrity" in value) {
      console.log(`Draft integrity: ${value.draftIntegrity.status}`);
      for (const issue of value.draftIntegrity.issues)
        console.log(`${issue.path}: ${issue.code}: ${issue.message}`);
    }
    if (command === "status") {
      console.log(
        `Authoring dataset fingerprint: ${value.baseDatasetSha256 ?? "unavailable"}`,
      );
      for (const [kind, gate] of Object.entries(value.editorial))
        console.log(
          `${kind}: ${gate.status} (${gate.available ? `${gate.accounted}/${gate.total} accounted; ${gate.deferred} deferred` : "coverage unavailable"})`,
        );
      console.log(
        `Localization: ${value.localization.available ? `${value.localization.eligibleIdentities} eligible identities; ${value.localization.notYetEligibleRecords} records not yet eligible; ${value.localization.notReconciled} not reconciled` : "coverage unavailable"}`,
      );
      console.log(
        `TAXREF outcomes: ${JSON.stringify(value.localization.outcomes)}`,
      );
      for (const [kind, cohort] of Object.entries(value.coverage.cohorts)) {
        console.log(`${kind} records: ${cohort.records ?? "unavailable"}`);
        for (const [family, count] of Object.entries(cohort.candidates))
          console.log(
            `${kind}/${family}: ${count.total ?? "unavailable"} total; ${count.accepted} accepted; ${count.rejected} rejected; ${count.deferred} deferred; ${count.pending ?? "unavailable"} pending`,
          );
      }
      console.log(
        `Delivery targets: ${value.coverage.delivery.concepts} MVP concepts; ${value.coverage.delivery.cultivarExemplars} cultivar exemplars`,
      );
      console.log(`C4 readiness: ${value.coverage.readiness.status}`);
      for (const reason of value.coverage.readiness.reasons)
        console.log(`  ${reason}`);
    } else if (command === "show") {
      const view = result as Awaited<ReturnType<typeof showCurationRecord>>;
      console.log(
        `Packet ${field(view.packet, "id")}: ${JSON.stringify(view.packet.sourceRecordKey)}`,
      );
      console.log(
        JSON.stringify(
          {
            packet: view.packet,
            comparisons: view.comparisons,
            decisions: view.decisions,
            authored: view.authored,
          },
          null,
          2,
        ),
      );
    }
  } else if (command === "lookup") {
    const proposal = result as Awaited<
      ReturnType<typeof createWfoLookupProposal>
    >;
    console.log(
      `WFO lookup (${proposal.reviewState}): ${proposal.matches.length} matches`,
    );
    for (const row of [...proposal.matches, ...proposal.acceptedNameTargets])
      console.log(
        `${row.externalIdentifier.identifier}: ${row.scientificName} (${row.taxonomicStatus}) — ${row.sourceLocator}`,
      );
  } else {
    const draft = result as Awaited<
      ReturnType<typeof generateIntegratedReviewPackets>
    >;
    console.log(`Unreviewed drafts: ${draft.outputDirectory}`);
    for (const count of draft.counts)
      console.log(`${count.role}: ${count.count}`);
  }
}
