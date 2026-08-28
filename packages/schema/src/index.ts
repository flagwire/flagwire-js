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
export const deliveryScopeSchema = z.enum(["browser", "server", "both"]);
export const flagLifecycleSchema = z.enum(["temporary", "permanent"]);
export const flagTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(
    /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/,
    "Use normalized lowercase letters, numbers, dots, underscores, or hyphens",
  );
export const flagTagsSchema = z
  .array(flagTagSchema)
  .max(10)
  .superRefine((tags, context) => {
    if (new Set(tags).size !== tags.length) {
      context.addIssue({ code: "custom", message: "Flag tags must be unique" });
    }
  });
export const flagMetadataSchema = z
  .object({
    deliveryScope: deliveryScopeSchema,
    ownerId: resourceIdSchema.nullable(),
    tags: flagTagsSchema,
    lifecycle: flagLifecycleSchema,
    expectedRemovalAt: z.iso.date().nullable(),
  })
  .strict()
  .superRefine((metadata, context) => {
    if (metadata.lifecycle === "permanent" && metadata.expectedRemovalAt !== null) {
      context.addIssue({
        code: "custom",
        message: "Permanent flags cannot have an expected removal date",
        path: ["expectedRemovalAt"],
      });
    }
  });
export const environmentSlugSchema = z.enum(["dev", "staging", "prod"]);
export const sdkKeyKindSchema = z.enum(["client", "server"]);
export const runtimeAccessModeSchema = z.enum(["full", "cached_only", "suspended"]);
export const browserOriginSchema = z
  .url()
  .max(2_048)
  .superRefine((value, context) => {
    const url = new URL(value);
    const localHost =
      url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && localHost)) {
      context.addIssue({ code: "custom", message: "Origins must use HTTPS, except localhost" });
    }
    if (value !== url.origin) {
      context.addIssue({
        code: "custom",
        message: "Origins must not contain a path, query, or hash",
      });
    }
  });
export const sdkKeyLookupSchema = z
  .object({
    accessMode: runtimeAccessModeSchema,
    allowedOrigins: z.array(browserOriginSchema).max(20).nullable(),
    envId: resourceIdSchema,
    kind: sdkKeyKindSchema,
    orgId: resourceIdSchema,
    projectId: resourceIdSchema,
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
    metadata: flagMetadataSchema.optional(),
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

const contextAttributeNameSchema = z.string().min(1).max(128);

export const contextAttributeSchema = z.union([
  z.string().max(1_024),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(256)).max(64),
]);

export const evaluationContextSchema = z
  .object({
    key: z.string().min(1).max(256),
    attributes: z.record(contextAttributeNameSchema, contextAttributeSchema).optional(),
  })
  .strict()
  .superRefine((context, refinement) => {
    if (context.attributes && Object.keys(context.attributes).length > 64) {
      refinement.addIssue({
        code: "too_big",
        origin: "object",
        maximum: 64,
        inclusive: true,
        message: "Evaluation contexts cannot contain more than 64 attributes",
        path: ["attributes"],
      });
    }
  });

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
    metadata: flagMetadataSchema.optional(),
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

const draftCommentSchema = z.string().trim().max(500).nullable();

export const flagDraftSchema = z
  .object({
    flagId: resourceIdSchema,
    envId: resourceIdSchema,
    baseVersion: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    config: flagConfigSchema,
    comment: draftCommentSchema,
    updatedBy: resourceIdSchema,
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const putFlagDraftSchema = z
  .object({
    expectedDraftRevision: z.number().int().nonnegative(),
    config: flagConfigSchema,
    comment: draftCommentSchema.optional(),
  })
  .strict();

export const publishDraftRequestSchema = z
  .object({
    expectedBaseVersion: z.number().int().nonnegative(),
    expectedDraftRevision: z.number().int().positive(),
    operationId: resourceIdSchema,
    comment: z.string().trim().max(500),
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

export const createSdkKeySchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("client"),
      allowedOrigins: z.array(browserOriginSchema).min(1).max(20),
    })
    .strict()
    .superRefine((value, context) => {
      if (new Set(value.allowedOrigins).size !== value.allowedOrigins.length) {
        context.addIssue({
          code: "custom",
          message: "Allowed origins must be unique",
          path: ["allowedOrigins"],
        });
      }
    }),
  z.object({ kind: z.literal("server") }).strict(),
]);

export const updateSdkKeyOriginsSchema = z
  .object({ allowedOrigins: z.array(browserOriginSchema).min(1).max(20) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.allowedOrigins).size !== value.allowedOrigins.length) {
      context.addIssue({
        code: "custom",
        message: "Allowed origins must be unique",
        path: ["allowedOrigins"],
      });
    }
  });

export const auditCursorSchema = z
  .object({
    createdAt: z.number().int().nonnegative(),
    id: resourceIdSchema,
  })
  .strict();

export const typegenScopeSchema = z.enum(["browser", "server", "all"]);

export const typegenFlagSchema = z
  .object({
    key: resourceKeySchema,
    type: flagTypeSchema,
    deliveryScope: deliveryScopeSchema.default("both"),
    variants: variantsSchema,
  })
  .strict();

export const typegenManifestSchema = z
  .object({
    flags: z.array(typegenFlagSchema),
    projectId: resourceIdSchema,
  })
  .strict();

export type Bundle = z.infer<typeof bundleSchema>;
export type Clause = z.infer<typeof clauseSchema>;
export type CompiledFlag = z.infer<typeof compiledFlagSchema>;
export type DeliveryScope = z.infer<typeof deliveryScopeSchema>;
export type FlagConfig = z.infer<typeof flagConfigSchema>;
export type FlagDefinition = z.infer<typeof flagDefinitionSchema>;
export type FlagDraft = z.infer<typeof flagDraftSchema>;
export type FlagLifecycle = z.infer<typeof flagLifecycleSchema>;
export type FlagMetadata = z.infer<typeof flagMetadataSchema>;
export type PublishDraftRequest = z.infer<typeof publishDraftRequestSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type SegmentRules = z.infer<typeof segmentRulesSchema>;
export type Serve = z.infer<typeof serveSchema>;
export type TypegenManifest = z.infer<typeof typegenManifestSchema>;
export type TypegenScope = z.infer<typeof typegenScopeSchema>;
export type Variant = z.infer<typeof variantSchema>;
