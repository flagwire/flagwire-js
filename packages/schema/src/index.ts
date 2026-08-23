import { z } from "zod";

export const bundleFormatVersion = 1 as const;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const resourceIdSchema = z.string().trim().min(1).max(128);
export const resourceKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    "Use lowercase letters, numbers, dots, underscores, or hyphens",
  );
export const displayNameSchema = z.string().trim().min(1).max(120);
export const descriptionSchema = z.string().trim().max(1_000).nullable().optional();

export const flagTypeSchema = z.enum(["boolean", "string", "json"]);
export const environmentSlugSchema = z.enum(["dev", "staging", "prod"]);
export const sdkKeyKindSchema = z.enum(["client", "server"]);
export const sdkKeyLookupSchema = z
  .object({
    envId: resourceIdSchema,
    kind: sdkKeyKindSchema,
    revoked: z.boolean(),
  })
  .strict();

export const clauseOperatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "contains",
  "startsWith",
  "endsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "semverEq",
  "semverGt",
  "semverLt",
  "regex",
  "segment",
]);

export const clauseValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);

export const clauseSchema = z
  .object({
    attr: z.string().trim().max(128),
    op: clauseOperatorSchema,
    values: z.array(clauseValueSchema).min(1),
    negate: z.boolean(),
  })
  .strict()
  .superRefine((clause, context) => {
    if (clause.op !== "segment" && clause.attr.length === 0) {
      context.addIssue({
        code: "custom",
        message: "Attribute is required for non-segment clauses",
        path: ["attr"],
      });
    }

    if (clause.op === "segment") {
      clause.values.forEach((value, index) => {
        if (typeof value !== "string" || !resourceKeySchema.safeParse(value).success) {
          context.addIssue({
            code: "custom",
            message: "Segment clause values must be segment keys",
            path: ["values", index],
          });
        }
      });
    }

    if (clause.op === "regex") {
      for (const [index, value] of clause.values.entries()) {
        if (typeof value !== "string") {
          context.addIssue({
            code: "custom",
            message: "Regex clause values must be strings",
            path: ["values", index],
          });
        } else if (value.length > 256) {
          context.addIssue({
            code: "too_big",
            origin: "string",
            maximum: 256,
            inclusive: true,
            message: "Regex patterns cannot exceed 256 characters",
            path: ["values", index],
          });
        }
      }
    }
  });

export const rolloutVariationSchema = z
  .object({
    variant: z.number().int().nonnegative(),
    weight: z.number().int().min(0).max(100_000),
  })
  .strict();

export const rolloutSchema = z
  .object({
    variations: z.array(rolloutVariationSchema).min(1),
  })
  .strict()
  .superRefine((rollout, context) => {
    const total = rollout.variations.reduce((sum, variation) => sum + variation.weight, 0);
    if (total !== 100_000) {
      context.addIssue({
        code: "custom",
        message: "Rollout weights must sum to 100000 basis points",
        path: ["variations"],
      });
    }

    const indexes = new Set<number>();
    rollout.variations.forEach((variation, index) => {
      if (indexes.has(variation.variant)) {
        context.addIssue({
          code: "custom",
          message: "A rollout can reference each variant only once",
          path: ["variations", index, "variant"],
        });
      }
      indexes.add(variation.variant);
    });
  });

export const serveSchema = z.union([
  z.object({ variant: z.number().int().nonnegative() }).strict(),
  z.object({ rollout: rolloutSchema }).strict(),
]);

export const ruleSchema = z
  .object({
    id: resourceIdSchema,
    clauses: z.array(clauseSchema).min(1),
    serve: serveSchema,
  })
  .strict();

export const segmentRuleGroupSchema = z
  .object({
    clauses: z.array(clauseSchema).min(1),
  })
  .strict();

export const segmentRulesSchema = z.array(segmentRuleGroupSchema);

export const flagConfigSchema = z
  .object({
    on: z.boolean(),
    offVariant: z.number().int().nonnegative(),
    fallthrough: serveSchema,
    rules: z.array(ruleSchema),
  })
  .strict()
  .superRefine((config, context) => {
    const ids = new Set<string>();
    config.rules.forEach((rule, index) => {
      if (ids.has(rule.id)) {
        context.addIssue({
          code: "custom",
          message: "Rule IDs must be unique within a flag configuration",
          path: ["rules", index, "id"],
        });
      }
      ids.add(rule.id);
    });
  });

export const variantSchema = z
  .object({
    key: resourceKeySchema,
    value: jsonValueSchema,
  })
  .strict();

export const variantsSchema = z
  .array(variantSchema)
  .min(1)
  .superRefine((variants, context) => {
    const keys = new Set<string>();
    variants.forEach((variant, index) => {
      if (keys.has(variant.key)) {
        context.addIssue({
          code: "custom",
          message: "Variant keys must be unique",
          path: [index, "key"],
        });
      }
      keys.add(variant.key);
    });
  });

function variantIndexes(serve: z.infer<typeof serveSchema>): number[] {
  return "variant" in serve
    ? [serve.variant]
    : serve.rollout.variations.map((variation) => variation.variant);
}

function validateVariantReferences(
  value: {
    variants: z.infer<typeof variantsSchema>;
    offVariant: number;
    fallthrough: z.infer<typeof serveSchema>;
    rules: z.infer<typeof ruleSchema>[];
  },
  context: z.RefinementCtx,
) {
  const highestIndex = value.variants.length - 1;
  const references = [
    { path: ["offVariant"] as PropertyKey[], indexes: [value.offVariant] },
    { path: ["fallthrough"] as PropertyKey[], indexes: variantIndexes(value.fallthrough) },
    ...value.rules.map((rule, index) => ({
      path: ["rules", index, "serve"] as PropertyKey[],
      indexes: variantIndexes(rule.serve),
    })),
  ];

  for (const reference of references) {
    if (reference.indexes.some((index) => index > highestIndex)) {
      context.addIssue({
        code: "custom",
        message: `Variant index must be between 0 and ${highestIndex}`,
        path: reference.path,
      });
    }
  }
}

export const flagDefinitionSchema = z
  .object({
    key: resourceKeySchema,
    name: displayNameSchema,
    type: flagTypeSchema,
    description: descriptionSchema,
    variants: variantsSchema,
  })
  .strict()
  .superRefine((flag, context) => {
    flag.variants.forEach((variant, index) => {
      const valid =
        flag.type === "json" ||
        (flag.type === "boolean" && typeof variant.value === "boolean") ||
        (flag.type === "string" && typeof variant.value === "string");
      if (!valid) {
        context.addIssue({
          code: "custom",
          message: `Variant value must match flag type ${flag.type}`,
          path: ["variants", index, "value"],
        });
      }
    });
  });

export const compiledFlagSchema = z
  .object({
    type: flagTypeSchema,
    version: z.number().int().positive(),
    salt: z.string().regex(/^[a-f0-9]{16}$/),
    on: z.boolean(),
    variants: variantsSchema,
    offVariant: z.number().int().nonnegative(),
    fallthrough: serveSchema,
    rules: z.array(ruleSchema),
  })
  .strict()
  .superRefine((flag, context) => {
    validateVariantReferences(flag, context);
    flag.variants.forEach((variant, index) => {
      const valid =
        flag.type === "json" ||
        (flag.type === "boolean" && typeof variant.value === "boolean") ||
        (flag.type === "string" && typeof variant.value === "string");
      if (!valid) {
        context.addIssue({
          code: "custom",
          message: `Variant value must match flag type ${flag.type}`,
          path: ["variants", index, "value"],
        });
      }
    });
  });

export const bundleSchema = z
  .object({
    fmt: z.literal(bundleFormatVersion),
    envId: resourceIdSchema,
    version: z.number().int().positive(),
    publishedAt: z.number().int().nonnegative(),
    revoked: z.boolean(),
    segments: z.record(resourceKeySchema, segmentRulesSchema),
    flags: z.record(resourceKeySchema, compiledFlagSchema),
  })
  .strict();

export const revokedBundleSchema = bundleSchema.refine(
  (bundle) => !bundle.revoked || Object.keys(bundle.flags).length === 0,
  { message: "Revoked bundles cannot contain flags", path: ["flags"] },
);

export const contextAttributeSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.string()),
]);

export const evaluationContextSchema = z
  .object({
    key: z.string(),
    attributes: z.record(z.string(), contextAttributeSchema).optional(),
  })
  .strict();

export const evaluationRequestSchema = z.object({ context: evaluationContextSchema }).strict();

export const exposureEventSchema = z
  .object({
    flagKey: resourceKeySchema,
    flagVersion: z.number().int().positive(),
    variant: resourceKeySchema,
    count: z.number().int().positive(),
  })
  .strict();

export const exposureEventsSchema = z.array(exposureEventSchema).max(100);

export type EvaluationContext = z.infer<typeof evaluationContextSchema>;
export type ExposureEvent = z.infer<typeof exposureEventSchema>;

export const createProjectSchema = z
  .object({
    orgId: resourceIdSchema,
    name: displayNameSchema,
    slug: resourceKeySchema.optional(),
  })
  .strict();

export const updateProjectSchema = z
  .object({
    name: displayNameSchema.optional(),
    slug: resourceKeySchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const createFlagSchema = flagDefinitionSchema;

export const updateFlagSchema = z
  .object({
    name: displayNameSchema.optional(),
    description: descriptionSchema,
    variants: variantsSchema.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const updateFlagEnvironmentSchema = z
  .object({
    config: flagConfigSchema,
    comment: z.string().trim().max(500).nullable().optional(),
  })
  .strict();

export const rollbackFlagSchema = z.object({ toVersion: z.number().int().positive() }).strict();

export const createSegmentSchema = z
  .object({
    key: resourceKeySchema,
    name: displayNameSchema,
    description: descriptionSchema,
    rules: segmentRulesSchema,
  })
  .strict();

export const updateSegmentSchema = z
  .object({
    key: resourceKeySchema.optional(),
    name: displayNameSchema.optional(),
    description: descriptionSchema,
    rules: segmentRulesSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const createSdkKeySchema = z.object({ kind: sdkKeyKindSchema }).strict();

export const auditCursorSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    id: resourceIdSchema,
  })
  .strict();

export type Bundle = z.infer<typeof bundleSchema>;
export type Clause = z.infer<typeof clauseSchema>;
export type CompiledFlag = z.infer<typeof compiledFlagSchema>;
export type FlagConfig = z.infer<typeof flagConfigSchema>;
export type FlagDefinition = z.infer<typeof flagDefinitionSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type SegmentRules = z.infer<typeof segmentRulesSchema>;
export type Serve = z.infer<typeof serveSchema>;
export type Variant = z.infer<typeof variantSchema>;
