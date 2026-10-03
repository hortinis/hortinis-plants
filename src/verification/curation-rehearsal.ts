import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  rename,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { WFO_SNAPSHOT_FILENAME } from "../adapters/wfo/constants.js";
import { serializeCanonicalJson } from "../serialization/canonical-json.js";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((argument) => argument !== "--");
if (
  args.some(
    (argument) => !["--clean-only", "--verify-existing"].includes(argument),
  ) ||
  args.length > 1
)
  throw new Error(
    "Choose --clean-only or --verify-existing, or omit options for two fresh runs",
  );
const cleanOnly = args.includes("--clean-only");
const verifyExisting = args.includes("--verify-existing");
const output = join(root, ".cache/verification/t19");
const runs = Object.fromEntries(
  ["grow", "cropgraph", "wfo", "taxref", "taxref-wfo"].map((kind) => [
    kind,
    join(output, "runs", kind),
  ]),
);
const dataset = join(root, "data/curation/grow-wfo-initial");
const growInput = join(root, "data/sources/grow/releases/2020");
const cropInput = join(
  root,
  "data/sources/cropgraph/releases/e722c3415bcf2773277f3422e13a4de5efd29b48",
);
const wfoInput = join(
  root,
  ".cache/source-inputs/wfo/2026-06",
  WFO_SNAPSHOT_FILENAME,
);
const taxrefInput = join(
  root,
  ".cache/source-inputs/taxref/18.0/TAXREF_v18_2025.zip",
);
const missing = join(output, "missing-input");
const drafts = join(output, "drafts");
const auditArgs = [
  "--dataset",
  dataset,
  "--drafts",
  drafts,
  "--scope",
  join(drafts, "review-scope.json"),
  ...["grow", "cropgraph", "wfo", "taxref-wfo"].flatMap((kind) => [
    "--run",
    `${kind === "wfo" || kind === "taxref-wfo" ? `${kind}-reconciliation` : `${kind}-importer`}-run-manifest=${runs[kind]!}`,
  ]),
];
const steps = [
  {
    name: "grow",
    script: "adapters/grow/cli.js",
    args: [growInput, runs.grow!],
    failedArgs: [missing, runs.grow!],
    output: runs.grow!,
  },
  {
    name: "cropgraph",
    script: "adapters/cropgraph/cli.js",
    args: [cropInput, runs.cropgraph!],
    failedArgs: [missing, runs.cropgraph!],
    output: runs.cropgraph!,
  },
  {
    name: "wfo",
    script: "adapters/wfo/cli.js",
    args: [runs.grow!, runs.cropgraph!, wfoInput, runs.wfo!],
    failedArgs: [runs.grow!, runs.cropgraph!, missing, runs.wfo!],
    output: runs.wfo!,
  },
  {
    name: "taxref",
    script: "adapters/taxref/cli.js",
    args: [taxrefInput, runs.taxref!],
    failedArgs: [missing, runs.taxref!],
    output: runs.taxref!,
  },
  {
    name: "taxref-wfo",
    script: "curation/taxref-wfo-localization-cli.js",
    args: [dataset, runs.taxref!, runs.wfo!, taxrefInput, runs["taxref-wfo"]!],
    failedArgs: [
      dataset,
      runs.taxref!,
      runs.wfo!,
      missing,
      runs["taxref-wfo"]!,
    ],
    output: runs["taxref-wfo"]!,
  },
  {
    name: "drafts",
    script: "curation/curation-cli.js",
    args: [
      "drafts",
      ...auditArgs.filter((_, index) => index < 4 || index >= 6),
      "--output",
      drafts,
    ],
    failedArgs: [
      "drafts",
      ...auditArgs.map((value) =>
        value === join(drafts, "review-scope.json") ? missing : value,
      ),
      "--output",
      drafts,
    ],
    output: drafts,
  },
];

// Archive transforms run in isolated processes with a fixed heap and an observed RSS ceiling.
const heapMiB = 1024;
const rssKiB = 1536 * 1024;
const evidence: unknown[] = [];
await mkdir(output, { recursive: true });
for (const step of cleanOnly ? [] : steps) {
  console.log(
    `Verifying ${step.name}: ${verifyExisting ? "existing baseline and measured rerun" : "two measured runs"}; failed-input preservation`,
  );
  const first = verifyExisting
    ? { existingBaseline: true, maxRssKiB: null }
    : await run(step.script, step.args);
  const firstFiles = await inventory(step.output);
  const second = await run(step.script, step.args);
  const secondFiles = await inventory(step.output);
  if (!equal(firstFiles, secondFiles))
    throw new Error(`${step.name}: repeated output differs`);
  const failed = await run(step.script, step.failedArgs, true);
  if (!equal(firstFiles, await inventory(step.output)))
    throw new Error(`${step.name}: failed run changed previous output`);
  evidence.push({
    step: step.name,
    status: "validated",
    runs: [first, second],
    failure: failed,
    files: firstFiles,
  });
  await writeFile(
    join(output, `${step.name}-verification.json`),
    serializeCanonicalJson(evidence[evidence.length - 1]),
  );
}
console.log(
  "Verifying an isolated checkout without ignored source archives or drafts",
);
evidence.push(await cleanCheckout());
if (!cleanOnly) {
  console.log("Verifying structural validation and full local source audit");
  evidence.push({
    step: "structural",
    ...(await run("curation/curation-cli.js", [
      "validate",
      "--dataset",
      dataset,
      "--json",
    ])),
  });
  evidence.push({
    step: "deep",
    ...(await run(
      "curation/curation-cli.js",
      ["status", ...auditArgs, "--deep", "--json"],
      false,
      join(output, "coverage.json"),
    )),
  });
}
const report = {
  status: "validated",
  node: process.version,
  heapMiB,
  rssLimitKiB: rssKiB,
  dataset,
  mode: cleanOnly
    ? "clean-only"
    : verifyExisting
      ? "existing-baseline-and-rerun"
      : "two-fresh-runs",
  evidence,
};
const reportName = cleanOnly
  ? "clean-checkout-report.json"
  : "verification-report.json";
const stage = join(output, `${reportName}.tmp`);
await writeFile(stage, serializeCanonicalJson(report));
await rename(stage, join(output, reportName));
console.log(`Verified T19 local rehearsal. Evidence: ${output}`);

async function run(
  script: string,
  args: string[],
  expectFailure = false,
  stdoutPath?: string,
) {
  const child = spawn(
    process.execPath,
    [
      `--max-old-space-size=${heapMiB}`,
      join(root, "dist/verification/measured-step.js"),
      resolve(root, "dist", script),
      ...args,
    ],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout = (stdout + chunk).slice(-4 * 1024 * 1024);
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr = (stderr + chunk).slice(-64 * 1024);
  });
  const exitCode = await new Promise<number | null>((done, reject) => {
    child.once("error", reject);
    child.once("close", done);
  });
  const line = stderr
    .split("\n")
    .find((value) => value.startsWith("T19_METRICS "));
  const maxRssKiB =
    line === undefined
      ? null
      : (JSON.parse(line.slice(12)) as { maxRssKiB: number }).maxRssKiB;
  if (exitCode === null || (expectFailure ? exitCode === 0 : exitCode !== 0))
    throw new Error(`${script}: unexpected exit ${exitCode}\n${stderr}`);
  if (maxRssKiB === null || maxRssKiB > rssKiB)
    throw new Error(
      `${script}: memory evidence missing or exceeds ${rssKiB} KiB: ${maxRssKiB}\n${stderr}`,
    );
  if (stdoutPath !== undefined) await writeFile(stdoutPath, stdout);
  return {
    exitCode,
    maxRssKiB,
    diagnostic: expectFailure
      ? stderr
          .replace(/^T19_METRICS.*$/m, "")
          .trim()
          .slice(-4000) || stdout.slice(-4000)
      : null,
  };
}

async function inventory(directory: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(path: string, prefix: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name, "en"),
    )) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(path, entry.name), name + "/");
      else if (entry.isFile()) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(join(path, entry.name)))
          hash.update(chunk as Buffer);
        result[name] = hash.digest("hex");
      } else throw new Error(`Unsupported verification output: ${name}`);
    }
  }
  await walk(directory, "");
  return result;
}
function equal(a: Record<string, string>, b: Record<string, string>) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function cleanCheckout() {
  const checkout = await mkdtemp(join(output, "clean-checkout-"));
  try {
    await cp(join(root, "dist"), join(checkout, "dist"), { recursive: true });
    const relativeDataset = "data/curation/grow-wfo-initial";
    await cp(dataset, join(checkout, relativeDataset), { recursive: true });
    const manifest = JSON.parse(
      await readFile(join(dataset, "dataset-manifest.json"), "utf8"),
    ) as { dependencies: { path: string }[] };
    for (const dependency of manifest.dependencies) {
      const destination = resolve(checkout, dependency.path);
      if (!destination.startsWith(checkout + "/"))
        throw new Error("Dependency escapes clean checkout");
      await mkdir(resolve(destination, ".."), { recursive: true });
      await cp(resolve(root, dependency.path), destination);
    }
    await cp(
      join(root, "data/curation/delivery-targets.json"),
      join(checkout, "data/curation/delivery-targets.json"),
    );
    const cli = join(checkout, "dist/curation/curation-cli.js");
    const structure = await run(cli, ["validate", "--json"]);
    const statusPath = join(output, "clean-checkout-coverage.json");
    const status = await run(cli, ["status", "--json"], false, statusPath);
    const coverage = JSON.parse(await readFile(statusPath, "utf8")) as {
      coverage: { available: boolean };
      sourceAudit: { valid: boolean | null };
    };
    if (coverage.coverage.available || coverage.sourceAudit.valid !== null)
      throw new Error("Clean checkout manufactured source coverage or audit");
    const deep = await run(cli, ["validate", "--deep", "--json"], true);
    return {
      step: "clean-checkout",
      status: "validated",
      structure,
      inspection: status,
      requestedDeepAudit: deep,
    };
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}
