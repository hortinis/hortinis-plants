import { resolve } from "node:path";
import { showGrowWfoRecord } from "./grow-wfo-show.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
let sourceRecordId: string | undefined;
let json = false;
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--source-record") {
    sourceRecordId = args[++index];
  } else if (argument === "--json") {
    json = true;
  } else {
    throw new Error(`Unknown show option ${argument}`);
  }
}
if (sourceRecordId === undefined)
  throw new Error("--source-record is required");

const view = await showGrowWfoRecord(sourceRecordId, {
  repositoryRoot: resolve(import.meta.dirname, "../.."),
});

if (json) {
  console.log(JSON.stringify(view));
} else {
  console.log(`GROW source record ${view.sourceRecordId}`);
  console.log(`Assertions in draft: ${view.assertionReviews.length}`);
  console.log(`Name decisions: ${view.decisions.name.length}`);
  console.log(`Subject decisions: ${view.decisions.subject.length}`);
  console.log(`Geography decisions: ${view.decisions.geography.length}`);
  console.log(`Assertion decisions: ${view.decisions.assertion.length}`);
  console.log(`Validation: ${view.validation.valid ? "validated" : "blocked"}`);
}
