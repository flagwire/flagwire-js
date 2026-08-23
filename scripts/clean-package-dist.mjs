import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";

const root = process.cwd();
const target = resolve(root, "dist");
if (relative(root, target) !== "dist") throw new Error("Refusing to clean outside the package");
await rm(target, { force: true, recursive: true });
