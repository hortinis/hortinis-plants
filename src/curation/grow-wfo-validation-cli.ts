import { resolve } from "node:path";
import { validateGrowWfoDataset } from "./grow-wfo-validation.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
let againstDrafts = false;
let json = false;
for (const argument of args) {
  if (argument === "--against-drafts") againstDrafts = true;
  else if (argument === "--json") json = true;
  else throw new Error(`Unknown validation option ${argument}`);
}

const result = await validateGrowWfoDataset({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
  againstDrafts,
});

if (json) {
  console.log(
    JSON.stringify({
      valid: result.valid,
      issueCount: result.issues.length,
      issues: result.issues,
    }),
  );
} else if (result.valid) {
  console.log("C4 authoring dataset is structurally valid.");
} else {
  for (const issue of result.issues) {
    const location =
      issue.lineNumber === undefined
        ? issue.path
        : `${issue.path}:${issue.lineNumber}`;
    console.error(`${location}: ${issue.code}: ${issue.message}`);
  }
  console.error(
    `C4 authoring dataset is invalid (${result.issues.length} issue${result.issues.length === 1 ? "" : "s"}).`,
  );
}

process.exitCode = result.valid ? 0 : 1;
