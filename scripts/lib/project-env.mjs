import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function loadProjectEnv(
  env = process.env,
  envFilePath = path.join(projectRoot, ".env"),
) {
  const result = dotenv.config({ path: envFilePath, processEnv: env });
  if (result.error && result.error.code !== "ENOENT") throw result.error;
  return env;
}
