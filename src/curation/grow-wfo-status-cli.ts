import { resolve } from "node:path";
import { getGrowWfoStatus } from "./grow-wfo-status.js";

const args = process.argv.slice(2).filter((argument) => argument !== "--");
let json = false;
for (const argument of args) {
  if (argument === "--json") json = true;
  else throw new Error(`Unknown status option ${argument}`);
}

const result = await getGrowWfoStatus({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
});

if (json) {
  console.log(JSON.stringify(result));
} else {
  console.log(
    `C4 authoring dataset: ${result.valid ? "validated" : "blocked"}`,
  );
  console.log(
    `Draft coverage: ${result.draftsAvailable ? "available" : "in progress (local drafts unavailable)"}`,
  );
  printGate("Identity", result.gates.identity);
  printGate("Subject", result.gates.subject);
  printGate("Context", result.gates.context);
  printGate("Assertion", result.gates.assertion);
  console.log(`C4 gate: ${result.gates.c4}`);
  if (result.issues.length > 0)
    console.log(`Validation issues: ${result.issues.length}`);
}

process.exitCode = result.valid ? 0 : 1;

function printGate(
  label: string,
  gate: {
    readonly status: string;
    readonly total: number;
    readonly completed: number;
    readonly pending: number;
  },
): void {
  console.log(
    `${label} gate: ${gate.status} (${gate.completed}/${gate.total} accounted; ${gate.pending} pending)`,
  );
}
