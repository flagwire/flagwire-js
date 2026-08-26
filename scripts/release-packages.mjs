import { readFileSync } from "node:fs";

const definitions = [
  {
    fileStem: "flagwire-schema",
    manifest: "../packages/schema/package.json",
    name: "@flagwire/schema",
  },
  {
    fileStem: "flagwire-evaluate",
    manifest: "../packages/evaluate/package.json",
    name: "@flagwire/evaluate",
  },
  {
    fileStem: "flagwire-sdk-js",
    manifest: "../packages/sdk-js/package.json",
    name: "@flagwire/sdk-js",
  },
  {
    fileStem: "flagwire-sdk-react",
    manifest: "../packages/sdk-react/package.json",
    name: "@flagwire/sdk-react",
  },
  {
    fileStem: "flagwire-sdk-node",
    manifest: "../packages/sdk-node/package.json",
    name: "@flagwire/sdk-node",
  },
  {
    fileStem: "flagwire-typegen",
    manifest: "../tools/typegen-cli/package.json",
    name: "flagwire-typegen",
  },
];

export const releasePackages = definitions.map(({ fileStem, manifest, name }) => {
  const parsed = JSON.parse(readFileSync(new URL(manifest, import.meta.url), "utf8"));
  if (parsed.name !== name || typeof parsed.version !== "string") {
    throw new Error(`${manifest} does not match the release definition for ${name}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(parsed.version)) {
    throw new Error(`${name} has an unsupported release version`);
  }
  return {
    file: `${fileStem}-${parsed.version}.tgz`,
    name,
    version: parsed.version,
  };
});
