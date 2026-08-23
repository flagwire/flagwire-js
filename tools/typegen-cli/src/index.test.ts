import { describe, expect, it } from "vitest";

import { generateTypes, type TypegenManifest } from "./index";

const manifest: TypegenManifest = {
  projectId: "project_test",
  flags: [
    {
      key: "checkout.enabled",
      type: "boolean",
      variants: [
        { key: "on", value: true },
        { key: "off", value: false },
      ],
    },
    {
      key: "checkout.theme",
      type: "string",
      variants: [
        { key: "control", value: "classic" },
        { key: "treatment", value: "minimal" },
      ],
    },
    {
      key: "checkout.payload",
      type: "json",
      variants: [{ key: "control", value: { accent: "violet", columns: 2 } }],
    },
  ],
};

describe("type generator", () => {
  it("emits keys, value types, and both SDK module augmentations deterministically", () => {
    const output = generateTypes(manifest);
    expect(output).toContain(
      'export type FlagKey = "checkout.enabled" | "checkout.theme" | "checkout.payload";',
    );
    expect(output).toContain('readonly "checkout.enabled": boolean;');
    expect(output).toContain('readonly "checkout.theme": "classic" | "minimal";');
    expect(output).toContain('readonly "checkout.payload": {"accent":"violet","columns":2};');
    expect(output).toContain('declare module "@flagwire/sdk-js"');
    expect(output).toContain('declare module "@flagwire/sdk-node"');
    expect(generateTypes(manifest)).toBe(output);
  });

  it("emits never for projects without flags", () => {
    expect(generateTypes({ projectId: "project_empty", flags: [] })).toContain(
      "export type FlagKey = never;",
    );
  });
});
