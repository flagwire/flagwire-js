import { execFileSync } from "node:child_process";

const baseRef = process.env.GITHUB_BASE_REF;

if (!baseRef) {
  console.log("Golden-vector append-only check skipped outside a pull request.");
  process.exit(0);
}

const remoteBase = `origin/${baseRef}`;
let mergeBase;

try {
  mergeBase = execFileSync("git", ["merge-base", "HEAD", remoteBase], {
    encoding: "utf8",
  }).trim();
} catch {
  console.error(`Cannot resolve ${remoteBase}; CI checkout must include full history.`);
  process.exit(1);
}

const changes = execFileSync(
  "git",
  [
    "diff",
    "--name-status",
    "--find-renames",
    `${mergeBase}...HEAD`,
    "--",
    "packages/evaluate/vectors",
  ],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);

const incompatible = changes.filter((line) => !line.startsWith("A\t"));
if (incompatible.length > 0) {
  console.error("Golden vectors are append-only. Add new files instead of changing existing ones:");
  for (const line of incompatible) console.error(`  ${line}`);
  process.exit(1);
}

console.log(`Golden-vector compatibility preserved (${changes.length} new file(s)).`);
