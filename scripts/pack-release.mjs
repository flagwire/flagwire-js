import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const release = resolve("release");
rmSync(release, { force: true, recursive: true });
mkdirSync(release);

for (const directory of [
  "packages/schema",
  "packages/evaluate",
  "packages/sdk-js",
  "packages/sdk-react",
  "packages/sdk-node",
  "tools/typegen-cli",
]) {
  execFileSync("pnpm", ["--dir", directory, "pack", "--pack-destination", release], {
    stdio: "inherit",
  });
}
