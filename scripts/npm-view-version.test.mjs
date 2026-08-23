import assert from "node:assert/strict";
import test from "node:test";

import { parseNpmViewVersion } from "./npm-view-version.mjs";

const spec = "@flagwire/schema@0.1.0";

test("accepts the scalar JSON response emitted by npm 11", () => {
  assert.equal(parseNpmViewVersion('"0.1.0"\n', spec), "0.1.0");
});

test("accepts the single-item array emitted by npm 12", () => {
  assert.equal(parseNpmViewVersion('[\n  "0.1.0"\n]\n', spec), "0.1.0");
});

test("rejects ambiguous, empty, and non-string responses", () => {
  for (const response of ["[]", '["0.1.0", "0.1.1"]', "{}", "null", "0", "[null]"]) {
    assert.throws(
      () => parseNpmViewVersion(response, spec),
      new Error(`Unexpected registry response for ${spec}`),
    );
  }
});

test("rejects malformed JSON", () => {
  assert.throws(
    () => parseNpmViewVersion("not-json", spec),
    new Error(`Invalid registry response for ${spec}`),
  );
});
