import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const expectedRepository = "git+https://github.com/flagwire/flagwire-js.git";
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

const textFiles = files.filter(
  (file) => !file.endsWith("pnpm-lock.yaml") && !file.endsWith(".png") && !file.endsWith(".woff2"),
);
const suspicious = [];
for (const file of textFiles) {
  const contents = readFileSync(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(contents))) suspicious.push(file);
}

const manifestErrors = [];
for (const directory of packageDirectories) {
  const manifest = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"));
  if (manifest.private === true) manifestErrors.push(`${manifest.name}: marked private`);
  if (manifest.license !== "MIT") manifestErrors.push(`${manifest.name}: license must be MIT`);
  if (manifest.repository?.url !== expectedRepository) {
    manifestErrors.push(`${manifest.name}: repository URL does not match public source`);
  }
  if (manifest.publishConfig?.provenance !== true) {
    manifestErrors.push(`${manifest.name}: provenance must remain enabled`);
  }
}

const errors = [
  ...forbiddenPaths.map((file) => `forbidden public path: ${file}`),
  ...suspicious.map((file) => `possible credential in tracked file: ${file}`),
  ...manifestErrors,
];

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

console.log(`Open-source boundary verified across ${files.length} tracked files.`);
