export function parseNpmViewVersion(stdout, spec) {
  let result;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`Invalid registry response for ${spec}`);
  }

  const versions = Array.isArray(result) ? result : [result];
  if (versions.length !== 1 || typeof versions[0] !== "string" || versions[0].length === 0) {
    throw new Error(`Unexpected registry response for ${spec}`);
  }

  return versions[0];
}
