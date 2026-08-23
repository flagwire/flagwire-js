import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { releasePackages } from "./release-packages.mjs";

for (const { file, name, version } of releasePackages) {
  const spec = `${name}@${version}`;
  const existing = spawnSync("npm", ["view", spec, "version", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (existing.status === 0) {
    const published = JSON.parse(existing.stdout);
    if (published !== version) throw new Error(`Unexpected registry response for ${spec}`);
    console.log(`${spec} is already published; skipping immutable version.`);
    continue;
  }

  execFileSync("npm", ["publish", resolve("release", file), "--access", "public"], {
    stdio: "inherit",
  });
}
