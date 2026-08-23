import {
  bundleSchema,
  type Bundle,
  type Clause,
  type CompiledFlag,
  type EvaluationContext,
  type JsonValue,
  type SegmentRules,
  type Serve,
} from "@flagwire/schema";

export type { EvaluationContext } from "@flagwire/schema";

type ContextAttribute = NonNullable<EvaluationContext["attributes"]>[string];

export type EvaluationReason =
  | "ERROR"
  | "ERROR_MISSING_KEY"
  | "FALLTHROUGH"
  | "FLAG_NOT_FOUND"
  | "OFF"
  | "REVOKED"
  | `RULE_MATCH:${string}`;

export interface EvaluationDetail {
  variantKey: string | null;
  value: JsonValue;
  reason: EvaluationReason;
}

export interface EvaluationSnapshot {
  version: number;
  flags: Record<string, EvaluationDetail>;
}

type MatchResult = "error" | "match" | "no-match";

const encoder = new TextEncoder();
const UINT32_RANGE = 4_294_967_296;

function rotateLeft32(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** MurmurHash3 x86 32-bit over UTF-8 bytes. */
export function murmur3_32(input: string | Uint8Array, seed = 0): number {
  const bytes = typeof input === "string" ? encoder.encode(input) : input;
  const blockEnd = bytes.length - (bytes.length % 4);
  let hash = seed >>> 0;

  for (let index = 0; index < blockEnd; index += 4) {
    let block =
      bytes[index]! |
      (bytes[index + 1]! << 8) |
      (bytes[index + 2]! << 16) |
      (bytes[index + 3]! << 24);
    block = Math.imul(block, 0xcc9e2d51);
    block = rotateLeft32(block, 15);
    block = Math.imul(block, 0x1b873593);

    hash ^= block;
    hash = rotateLeft32(hash, 13);
    hash = (Math.imul(hash, 5) + 0xe6546b64) | 0;
  }

  const remaining = bytes.length & 3;
  if (remaining > 0) {
    let tail = bytes[blockEnd]!;
    if (remaining >= 2) tail ^= bytes[blockEnd + 1]! << 8;
    if (remaining === 3) tail ^= bytes[blockEnd + 2]! << 16;
    tail = Math.imul(tail, 0xcc9e2d51);
    tail = rotateLeft32(tail, 15);
    tail = Math.imul(tail, 0x1b873593);
    hash ^= tail;
  }

  hash ^= bytes.length;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function bucketFor(contextKey: string, flagKey: string, salt: string) {
  const uint32 = murmur3_32(`${contextKey}:${flagKey}:${salt}`, 0);
  return { uint32, value: uint32 / UINT32_RANGE };
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(input: string): Semver | undefined {
  const match =
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      input,
    );
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  const prerelease = match[4]?.split(".") ?? [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0"))) {
    return undefined;
  }
  return { major, minor, patch, prerelease };
}

function compareSemver(left: Semver, right: Semver): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    return left.prerelease.length === right.prerelease.length
      ? 0
      : left.prerelease.length === 0
        ? 1
        : -1;
  }

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1;
    if (a === b) continue;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      if (a.length !== b.length) return a.length < b.length ? -1 : 1;
      return a < b ? -1 : 1;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

function finiteNumber(value: ContextAttribute | string | number | boolean): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function compareValue(
  operator: Exclude<Clause["op"], "segment">,
  actual: ContextAttribute,
  expected: string | number | boolean,
): MatchResult {
  try {
    switch (operator) {
      case "eq":
        if (Array.isArray(actual) || typeof actual !== typeof expected) return "error";
        return actual === expected ? "match" : "no-match";
      case "neq":
        if (Array.isArray(actual) || typeof actual !== typeof expected) return "error";
        return actual !== expected ? "match" : "no-match";
      case "in":
        if (Array.isArray(actual) || typeof actual !== typeof expected) return "error";
        return actual === expected ? "match" : "no-match";
      case "contains":
        if (typeof actual === "string" && typeof expected === "string") {
          return actual.includes(expected) ? "match" : "no-match";
        }
        if (Array.isArray(actual) && typeof expected === "string") {
          return actual.includes(expected) ? "match" : "no-match";
        }
        return "error";
      case "startsWith":
        return typeof actual === "string" && typeof expected === "string"
          ? actual.startsWith(expected)
            ? "match"
            : "no-match"
          : "error";
      case "endsWith":
        return typeof actual === "string" && typeof expected === "string"
          ? actual.endsWith(expected)
            ? "match"
            : "no-match"
          : "error";
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        if (Array.isArray(actual)) return "error";
        const left = finiteNumber(actual);
        const right = finiteNumber(expected);
        if (left === undefined || right === undefined) return "error";
        const matched =
          operator === "gt"
            ? left > right
            : operator === "gte"
              ? left >= right
              : operator === "lt"
                ? left < right
                : left <= right;
        return matched ? "match" : "no-match";
      }
      case "semverEq":
      case "semverGt":
      case "semverLt": {
        if (typeof actual !== "string" || typeof expected !== "string") return "error";
        const left = parseSemver(actual);
        const right = parseSemver(expected);
        if (!left || !right) return "error";
        const comparison = compareSemver(left, right);
        const matched =
          operator === "semverEq"
            ? comparison === 0
            : operator === "semverGt"
              ? comparison > 0
              : comparison < 0;
        return matched ? "match" : "no-match";
      }
      case "regex":
        if (typeof actual !== "string" || typeof expected !== "string" || expected.length > 256) {
          return "error";
        }
        return new RegExp(expected).test(actual) ? "match" : "no-match";
    }
    return "error";
  } catch {
    return "error";
  }
}

function matchSegment(
  segmentKey: string,
  segments: Record<string, SegmentRules>,
  context: EvaluationContext,
  visiting: ReadonlySet<string>,
): MatchResult {
  const groups = segments[segmentKey];
  if (!groups || visiting.has(segmentKey)) return "error";
  const nextVisiting = new Set(visiting);
  nextVisiting.add(segmentKey);
  let hadError = false;

  for (const group of groups) {
    let groupMatched = true;
    for (const clause of group.clauses) {
      const result = matchClause(clause, segments, context, nextVisiting);
      if (result === "error") {
        hadError = true;
        groupMatched = false;
        break;
      }
      if (result === "no-match") {
        groupMatched = false;
        break;
      }
    }
    if (groupMatched) return "match";
  }
  return hadError ? "error" : "no-match";
}

function matchClause(
  clause: Clause,
  segments: Record<string, SegmentRules>,
  context: EvaluationContext,
  visiting: ReadonlySet<string>,
): MatchResult {
  let matched = false;
  let hadError = false;

  if (clause.op === "segment") {
    for (const segmentKey of clause.values) {
      if (typeof segmentKey !== "string" || !segments[segmentKey]) {
        hadError = true;
        continue;
      }
      const result = matchSegment(segmentKey, segments, context, visiting);
      if (result === "error") {
        hadError = true;
        continue;
      }
      if (result === "match") {
        matched = true;
        break;
      }
    }
  } else {
    const actual = context.attributes?.[clause.attr];
    if (actual === undefined) return "error";
    for (const expected of clause.values) {
      const result = compareValue(clause.op, actual, expected);
      if (result === "error") {
        hadError = true;
        continue;
      }
      if (result === "match") {
        matched = true;
        break;
      }
    }
  }

  if (!matched && hadError) return "error";
  if (clause.negate) matched = !matched;
  return matched ? "match" : "no-match";
}

function defaultDetail(value: JsonValue, reason: EvaluationReason): EvaluationDetail {
  return { variantKey: null, value, reason };
}

function variantDetail(
  flag: CompiledFlag,
  variantIndex: number,
  reason: EvaluationReason,
  codeDefault: JsonValue,
): EvaluationDetail {
  const variant = flag.variants[variantIndex];
  return variant
    ? { variantKey: variant.key, value: variant.value, reason }
    : defaultDetail(codeDefault, "ERROR");
}

function offDetail(
  flag: CompiledFlag,
  reason: EvaluationReason,
  codeDefault: JsonValue,
): EvaluationDetail {
  return variantDetail(flag, flag.offVariant, reason, codeDefault);
}

function resolveServe(
  flag: CompiledFlag,
  flagKey: string,
  context: EvaluationContext,
  serve: Serve,
  reason: EvaluationReason,
  codeDefault: JsonValue,
): EvaluationDetail {
  if ("variant" in serve) return variantDetail(flag, serve.variant, reason, codeDefault);
  if (!context.key) return offDetail(flag, "ERROR_MISSING_KEY", codeDefault);

  const bucket = bucketFor(context.key, flagKey, flag.salt).uint32;
  let cumulativeWeight = 0;
  for (const variation of serve.rollout.variations) {
    cumulativeWeight += variation.weight;
    if (bucket * 100_000 < cumulativeWeight * UINT32_RANGE) {
      return variantDetail(flag, variation.variant, reason, codeDefault);
    }
  }
  return offDetail(flag, "ERROR", codeDefault);
}

function evaluateCompiledFlag(
  bundle: Bundle,
  flagKey: string,
  flag: CompiledFlag,
  context: EvaluationContext,
  codeDefault: JsonValue,
): EvaluationDetail {
  try {
    if (!flag.on) return offDetail(flag, "OFF", codeDefault);

    for (const rule of flag.rules) {
      let matches = true;
      for (const clause of rule.clauses) {
        if (matchClause(clause, bundle.segments, context, new Set()) !== "match") {
          matches = false;
          break;
        }
      }
      if (matches) {
        return resolveServe(
          flag,
          flagKey,
          context,
          rule.serve,
          `RULE_MATCH:${rule.id}`,
          codeDefault,
        );
      }
    }

    return resolveServe(flag, flagKey, context, flag.fallthrough, "FALLTHROUGH", codeDefault);
  } catch {
    return offDetail(flag, "ERROR", codeDefault);
  }
}

export function evaluateFlag(
  bundleInput: unknown,
  flagKey: string,
  context: EvaluationContext,
  codeDefault: JsonValue,
): EvaluationDetail {
  const parsed = bundleSchema.safeParse(bundleInput);
  if (!parsed.success) return defaultDetail(codeDefault, "ERROR");
  if (parsed.data.revoked) return defaultDetail(codeDefault, "REVOKED");
  const flag = parsed.data.flags[flagKey];
  if (!flag) return defaultDetail(codeDefault, "FLAG_NOT_FOUND");
  return evaluateCompiledFlag(parsed.data, flagKey, flag, context, codeDefault);
}

export function evaluateBundle(
  bundleInput: unknown,
  context: EvaluationContext,
): EvaluationSnapshot {
  const parsed = bundleSchema.safeParse(bundleInput);
  if (!parsed.success) return { version: 0, flags: {} };
  const bundle = parsed.data;
  if (bundle.revoked) return { version: bundle.version, flags: {} };

  const flags: Record<string, EvaluationDetail> = {};
  for (const [flagKey, flag] of Object.entries(bundle.flags)) {
    const fallback = flag.variants[flag.offVariant]?.value ?? null;
    flags[flagKey] = evaluateCompiledFlag(bundle, flagKey, flag, context, fallback);
  }
  return { version: bundle.version, flags };
}
