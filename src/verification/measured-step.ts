import { pathToFileURL } from "node:url";

const script = process.argv[2];
if (script === undefined) throw new Error("A verification step is required");
process.argv = [process.execPath, script, ...process.argv.slice(3)];
try {
  await import(pathToFileURL(script).href);
} finally {
  console.error(
    `T19_METRICS ${JSON.stringify({ maxRssKiB: process.resourceUsage().maxRSS })}`,
  );
}
