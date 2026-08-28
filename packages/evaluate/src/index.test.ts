import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  bucketFor,
  evaluateBundle,
  evaluateFlag,
  evaluateFlagWithTrace,
  murmur3_32,
  type EvaluationContext,
  type EvaluationDetail,
} from "./index";

interface MurmurVector {
  input: string;
  seed: number;
  expectedUint32: number;
}

interface BucketingVector {
  contextKey: string;
  flagKey: string;
  salt: string;
  expectedBucketUint32: number;
  expectedFloat12dp: number;
}

interface EvalVector {
  name: string;
  bundle: unknown;
  context: EvaluationContext;
  expected: EvaluationDetail;
}

interface TraceVector extends EvalVector {
  flagKey: string;
  expectedTrace: ReturnType<typeof evaluateFlagWithTrace>;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8"),
  ) as T;
}

const murmurVectors = readJson<MurmurVector[]>("../vectors/murmur3.json");
const bucketingVectors = readJson<BucketingVector[]>("../vectors/bucketing.json");
const evalDirectory = fileURLToPath(new URL("../vectors/eval", import.meta.url));
const evalVectors = readdirSync(evalDirectory)
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => JSON.parse(readFileSync(`${evalDirectory}/${file}`, "utf8")) as EvalVector);
const traceVectors = readJson<TraceVector[]>("../vectors/trace/traces-01.json");

describe("Murmur3 compatibility vectors", () => {
  it.each(murmurVectors)("hashes $input", ({ input, seed, expectedUint32 }) => {
    expect(murmur3_32(input, seed)).toBe(expectedUint32);
  });
});

describe("bucketing compatibility vectors", () => {
  it.each(bucketingVectors)(
    "buckets $contextKey for $flagKey",
    ({ contextKey, flagKey, salt, expectedBucketUint32, expectedFloat12dp }) => {
      const actual = bucketFor(contextKey, flagKey, salt);
      expect(actual.uint32).toBe(expectedBucketUint32);
      expect(Number(actual.value.toFixed(12))).toBe(expectedFloat12dp);
    },
  );
});

describe("evaluation compatibility vectors", () => {
  it("covers the committed compatibility cases", () => {
    expect(evalVectors).toHaveLength(50);
  });

  it.each(evalVectors)("$name", ({ bundle, context, expected }) => {
    expect(evaluateFlag(bundle, "test-flag", context, "CODE_DEFAULT")).toEqual(expected);
  });
});

describe("explainable evaluation compatibility vectors", () => {
  it.each(traceVectors)("traces $name without changing its result", (vector) => {
    const trace = evaluateFlagWithTrace(
      vector.bundle,
      vector.flagKey,
      vector.context,
      "CODE_DEFAULT",
    );
    expect(trace).toEqual(vector.expectedTrace);
    expect(trace.detail).toEqual(
      evaluateFlag(vector.bundle, vector.flagKey, vector.context, "CODE_DEFAULT"),
    );
  });

  it.each(evalVectors)("preserves $name", ({ bundle, context, expected }) => {
    expect(evaluateFlagWithTrace(bundle, "test-flag", context, "CODE_DEFAULT").detail).toEqual(
      expected,
    );
  });

  it("never returns evaluation-context values in a trace", () => {
    const vector = traceVectors[0];
    expect(vector).toBeDefined();
    const sensitiveValue = "private-customer-value";
    const trace = evaluateFlagWithTrace(
      vector?.bundle,
      vector?.flagKey ?? "test-flag",
      { key: "private-user-id", attributes: { plan: sensitiveValue } },
      false,
    );
    expect(JSON.stringify(trace)).not.toContain(sensitiveValue);
    expect(JSON.stringify(trace)).not.toContain("private-user-id");
  });
});

describe("evaluator fail-safe boundary", () => {
  it.each([undefined, null, 0, "bundle", [], {}, { fmt: 999 }])(
    "never throws for a corrupt bundle: %j",
    (bundle) => {
      expect(() => evaluateFlag(bundle, "test-flag", { key: "user" }, false)).not.toThrow();
      expect(evaluateFlag(bundle, "test-flag", { key: "user" }, false)).toEqual({
        variantKey: null,
        value: false,
        reason: "ERROR",
      });
    },
  );

  it("evaluates every flag in a valid bundle snapshot", () => {
    const vector = evalVectors.find(
      ({ name }) => name === "normal fallthrough serves configured variant",
    );
    expect(vector).toBeDefined();
    expect(evaluateBundle(vector?.bundle, { key: "user" })).toEqual({
      version: 7,
      flags: {
        "test-flag": { variantKey: "on", value: true, reason: "FALLTHROUGH" },
      },
    });
  });
});
