import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { releasePackages } from "./release-packages.mjs";

test("release artifacts derive immutable filenames from package manifests", () => {
  const expected = [
    ["flagwire-schema", "../packages/schema/package.json"],
    ["flagwire-evaluate", "../packages/evaluate/package.json"],
    ["flagwire-sdk-js", "../packages/sdk-js/package.json"],
    ["flagwire-sdk-react", "../packages/sdk-react/package.json"],
    ["flagwire-sdk-node", "../packages/sdk-node/package.json"],
    ["flagwire-typegen", "../tools/typegen-cli/package.json"],
  ].map(([fileStem, manifest]) => {
    const parsed = JSON.parse(readFileSync(new URL(manifest, import.meta.url), "utf8"));
    return {
      file: `${fileStem}-${parsed.version}.tgz`,
      name: parsed.name,
      version: parsed.version,
    };
  });

  assert.deepEqual(releasePackages, expected);
  assert.equal(new Set(releasePackages.map(({ file }) => file)).size, releasePackages.length);
});
