import { describe, expect, it } from "vitest";

import {
  bundleSchema,
  createSdkKeySchema,
  clauseSchema,
  compiledFlagSchema,
  evaluationContextSchema,
  exposureEventsSchema,
  flagDefinitionSchema,
  rolloutSchema,
  sdkKeyLookupSchema,
} from "./index";

const variants = [
  { key: "on", value: true },
  { key: "off", value: false },
];

const compiledFlag = {
  type: "boolean" as const,
  version: 7,
  salt: "9f2ac41d03b8e657",
  on: true,
  variants,
  offVariant: 1,
  fallthrough: { variant: 0 },
  rules: [],
};

describe("normative schemas", () => {
  it("accepts the v1 bundle wire contract", () => {
    const result = bundleSchema.safeParse({
      fmt: 1,
      envId: "env_7xk2",
      version: 42,
      publishedAt: 1_755_763_200_000,
      revoked: false,
      segments: {
        "beta-users": [
          {
            clauses: [{ attr: "email", op: "contains", values: ["@acme.com"], negate: false }],
          },
        ],
      },
      flags: { "new-checkout": compiledFlag },
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown bundle fields so wire changes are deliberate", () => {
    const result = bundleSchema.safeParse({
      fmt: 1,
      envId: "env_7xk2",
      version: 1,
      publishedAt: Date.now(),
      revoked: false,
      segments: {},
      flags: {},
      experimental: true,
    });

    expect(result.success).toBe(false);
  });

  it("requires rollout weights to total 100000 basis points", () => {
    expect(
      rolloutSchema.safeParse({
        variations: [
          { variant: 0, weight: 20_000 },
          { variant: 1, weight: 70_000 },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects out-of-range variant references", () => {
    expect(compiledFlagSchema.safeParse({ ...compiledFlag, offVariant: 2 }).success).toBe(false);
  });

  it("enforces flag variant value types", () => {
    expect(
      flagDefinitionSchema.safeParse({
        key: "new-checkout",
        name: "New checkout",
        type: "boolean",
        variants: [{ key: "on", value: "yes" }],
      }).success,
    ).toBe(false);
  });

  it("caps regex patterns at 256 characters", () => {
    expect(
      clauseSchema.safeParse({
        attr: "email",
        op: "regex",
        values: ["x".repeat(257)],
        negate: false,
      }).success,
    ).toBe(false);
  });

  it("requires attributes except for segment clauses", () => {
    expect(
      clauseSchema.safeParse({ attr: "", op: "eq", values: ["pro"], negate: false }).success,
    ).toBe(false);
    expect(
      clauseSchema.safeParse({
        attr: "",
        op: "segment",
        values: ["beta-users"],
        negate: false,
      }).success,
    ).toBe(true);
  });

  it("accepts only the flat v1 evaluation context value types", () => {
    expect(
      evaluationContextSchema.safeParse({
        key: "user-1",
        attributes: {
          region: "eu-west",
          age: 42,
          betaTester: true,
          groups: ["staff", "beta"],
        },
      }).success,
    ).toBe(true);
    expect(
      evaluationContextSchema.safeParse({
        key: "user-1",
        attributes: { nested: { region: "eu-west" } },
      }).success,
    ).toBe(false);
    expect(
      evaluationContextSchema.safeParse({
        key: "user-1",
        attributes: Object.fromEntries(
          Array.from({ length: 65 }, (_, index) => [`attribute-${index}`, index]),
        ),
      }).success,
    ).toBe(false);
    expect(evaluationContextSchema.safeParse({ key: "x".repeat(257) }).success).toBe(false);
    expect(
      evaluationContextSchema.safeParse({ key: "user", attributes: { value: "x".repeat(1_025) } })
        .success,
    ).toBe(false);
  });

  it("caps exposure batches and rejects invalid counters", () => {
    const event = { flagKey: "new-checkout", flagVersion: 7, variant: "on", count: 1 };
    expect(exposureEventsSchema.safeParse(Array.from({ length: 100 }, () => event)).success).toBe(
      true,
    );
    expect(exposureEventsSchema.safeParse(Array.from({ length: 101 }, () => event)).success).toBe(
      false,
    );
    expect(exposureEventsSchema.safeParse([{ ...event, count: 0 }]).success).toBe(false);
  });

  it("keeps the SDK-key cache value strict", () => {
    expect(
      sdkKeyLookupSchema.safeParse({
        accessMode: "full",
        allowedOrigins: ["https://app.example.com"],
        envId: "env_7xk2",
        kind: "client",
        orgId: "org_7xk2",
        projectId: "project_7xk2",
        revoked: false,
      }).success,
    ).toBe(true);
    expect(
      sdkKeyLookupSchema.safeParse({
        accessMode: "full",
        allowedOrigins: null,
        envId: "env_7xk2",
        kind: "client",
        revoked: false,
      }).success,
    ).toBe(false);
  });

  it("requires exact safe origins for browser keys and none for server keys", () => {
    expect(
      createSdkKeySchema.safeParse({
        kind: "client",
        allowedOrigins: ["https://app.example.com", "http://localhost:3000"],
      }).success,
    ).toBe(true);
    expect(
      createSdkKeySchema.safeParse({ kind: "client", allowedOrigins: ["http://example.com"] })
        .success,
    ).toBe(false);
    expect(
      createSdkKeySchema.safeParse({ kind: "client", allowedOrigins: ["https://example.com/path"] })
        .success,
    ).toBe(false);
    expect(createSdkKeySchema.safeParse({ kind: "server" }).success).toBe(true);
    expect(
      createSdkKeySchema.safeParse({ kind: "server", allowedOrigins: ["https://example.com"] })
        .success,
    ).toBe(false);
  });
});
