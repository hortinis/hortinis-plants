import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseJsonStrict } from "../serialization/canonical-json.js";
import { applyGrowWfoDecision, type DecisionInput } from "./grow-wfo-apply.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
let inputPath: string | undefined;
let json = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--input") inputPath = args[++index];
  else if (argument === "--json") json = true;
  else throw new Error(`Unknown apply option ${argument}`);
}
if (inputPath === undefined) throw new Error("--input is required");

const parsed = parseJsonStrict(await readFile(resolve(inputPath)));
const result = await applyGrowWfoDecision(parsed as DecisionInput, {
  repositoryRoot: resolve(import.meta.dirname, "../.."),
});
if (json) console.log(JSON.stringify(result));
else
  console.log(
    `Applied ${result.transactionId}: ${result.created} created, ${result.unchanged} unchanged.`,
  );
