import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { releasePackages } from "./release-packages.mjs";

const allowedFiles = new Set(["LICENSE", "README.md", "package.json"]);
for (const { file, name, version } of releasePackages) {
  const tarball = resolve("release", file);
  const contents = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((entry) => entry.replace(/^package\//, ""));
  const unexpected = contents.filter(
    (entry) =>
      !allowedFiles.has(entry) && !entry.startsWith("dist/") && !entry.startsWith("vectors/"),
  );
  if (unexpected.length > 0) {
    throw new Error(`${name} contains unexpected files: ${unexpected.join(", ")}`);
  }

  const directory = mkdtempSync(join(tmpdir(), "flagwire-package-"));
  try {
    execFileSync("tar", ["-xzf", tarball, "-C", directory]);
    const manifest = JSON.parse(readFileSync(join(directory, "package/package.json"), "utf8"));
    if (manifest.name !== name || manifest.version !== version) {
      throw new Error(`${file} identity does not match the release manifest`);
    }
    if (manifest.license !== "MIT" || manifest.publishConfig?.provenance !== true) {
      throw new Error(`${name} is missing MIT licensing or provenance metadata`);
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

console.log(`Verified ${releasePackages.length} release artifacts.`);
