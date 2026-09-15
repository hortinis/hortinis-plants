import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WFO_SNAPSHOT_FILENAME } from "../adapters/wfo/constants.js";
import { createWfoLookupProposal } from "./wfo-lookup.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
let query:
  | { readonly by: "name"; readonly value: string }
  | { readonly by: "id"; readonly value: string }
  | undefined;
for (let index = 0; index < args.length; index += 1) {
  const option = args[index];
  if (option !== "--name" && option !== "--id") {
    throw new Error(`Unknown WFO lookup option ${option ?? "<missing>"}`);
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  if (query !== undefined) {
    throw new Error("Choose exactly one of --name or --id");
  }
  query = { by: option === "--name" ? "name" : "id", value };
  index += 1;
}
if (query === undefined)
  throw new Error("Use --name <scientific-name> or --id <wfo-id>");

const repositoryRoot = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const snapshotPath = resolve(
  repositoryRoot,
  ".cache/source-inputs/wfo/2026-06",
  WFO_SNAPSHOT_FILENAME,
);
const proposal = await createWfoLookupProposal({ snapshotPath, query });
console.log(`${JSON.stringify(proposal, null, 2)}`);
