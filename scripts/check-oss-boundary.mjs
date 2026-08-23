import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const expectedRepository = "git+https://github.com/flagwire/flagwire-js.git";
const expectedHomepagePrefix = "https://github.com/flagwire/flagwire-js/tree/main/";
const packageDirectories = [
  "packages/schema",
  "packages/evaluate",
  "packages/sdk-js",
  "packages/sdk-react",
  "packages/sdk-node",
  "tools/typegen-cli",
];

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .trim()
  .split("\n")
  .filter(Boolean);

const forbiddenPaths = files.filter(
  (file) =>
    file.startsWith("apps/") ||
    file.startsWith("docs/internal/") ||
    file === "PROMPT_V1.md" ||
    /(?:^|\/)(?:business-plan|market-research|build-record|launch-checklist)\.md$/i.test(file) ||
    file.includes("/drizzle/") ||
    file.includes("/migrations/") ||
    basename(file).startsWith(".env") ||
    basename(file) === ".dev.vars" ||
    basename(file) === "wrangler.jsonc" ||
    basename(file) === "write-worker-secrets.mjs",
);

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bnpm_[A-Za-z0-9]{30,}\b/,
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9_-]{43}\b/,
  /\b\d{6,}-[a-z0-9]{24,}\.apps\.googleusercontent\.com\b/i,
];

const privateSourcePatterns = [
  new RegExp(`github\\.com/${["arjunbharti", "flagwire"].join("/")}(?:\\.git|/|\\b)`, "i"),
  new RegExp(`\\b${["NPM", "PUBLISH", "TOKEN"].join("_")}\\b`),
  new RegExp(`\\b${["NODE", "AUTH", "TOKEN"].join("_")}\\b`),
];

const textFiles = files.filter(
  (file) => !file.endsWith("pnpm-lock.yaml") && !file.endsWith(".png") && !file.endsWith(".woff2"),
);
const suspicious = [];
for (const file of textFiles) {
  const contents = readFileSync(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(contents))) suspicious.push(file);
  if (privateSourcePatterns.some((pattern) => pattern.test(contents))) suspicious.push(file);
}

const publicDocumentation = files.filter(
  (file) =>
    file === "README.md" ||
    file === "CONTRIBUTING.md" ||
    file === "SECURITY.md" ||
    file.endsWith("/README.md"),
);
const businessContentPatterns = [
  /\bpricing\b/i,
  /\brevenue\b/i,
  /\bgo-to-market\b/i,
  /\broadmap\b/i,
  /\bmilestone\b/i,
  /\bday[ -][0-9]+\b/i,
  /\bbusiness plan\b/i,
  /\bmarket research\b/i,
];
const businessContent = publicDocumentation.filter((file) => {
  const contents = readFileSync(file, "utf8");
  return businessContentPatterns.some((pattern) => pattern.test(contents));
});

const manifestErrors = [];
for (const directory of packageDirectories) {
  const manifest = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"));
  if (manifest.private === true) manifestErrors.push(`${manifest.name}: marked private`);
  if (manifest.license !== "MIT") manifestErrors.push(`${manifest.name}: license must be MIT`);
  if (manifest.repository?.url !== expectedRepository) {
    manifestErrors.push(`${manifest.name}: repository URL does not match public source`);
  }
  if (!manifest.homepage?.startsWith(expectedHomepagePrefix)) {
    manifestErrors.push(`${manifest.name}: homepage does not point to public source`);
  }
  if (manifest.bugs?.url !== "https://github.com/flagwire/flagwire-js/issues") {
    manifestErrors.push(`${manifest.name}: bugs URL does not point to public issue tracker`);
  }
  if (manifest.publishConfig?.access !== "public") {
    manifestErrors.push(`${manifest.name}: publish access must remain public`);
  }
  if (manifest.publishConfig?.provenance !== true) {
    manifestErrors.push(`${manifest.name}: provenance must remain enabled`);
  }
}

const errors = [
  ...forbiddenPaths.map((file) => `forbidden public path: ${file}`),
  ...suspicious.map((file) => `possible credential in tracked file: ${file}`),
  ...businessContent.map((file) => `business or planning content in public documentation: ${file}`),
  ...manifestErrors,
];

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Open-source boundary verified across ${files.length} tracked files.`);
