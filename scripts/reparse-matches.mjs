import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonMatchRepository } from "../server/src/matchData/jsonMatchRepository.js";
import { reparseMatchRepository } from "../server/src/matchData/matchReparseService.js";
import { loadProjectEnv } from "./lib/project-env.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function runReparseCli({
  env = process.env,
  output = console,
  loadEnv = loadProjectEnv,
} = {}) {
  loadEnv(env);
  const repository = new JsonMatchRepository(
    env.TFT_MATCH_DATA_PATH ||
      path.join(projectRoot, "server/data/importedMatches.json"),
  );
  const [champions, traits] = await Promise.all([
    fs.readFile(path.join(projectRoot, "server/data/champions.json"), "utf8").then(JSON.parse),
    fs.readFile(path.join(projectRoot, "server/data/traits.json"), "utf8").then(JSON.parse),
  ]);
  const result = await reparseMatchRepository({ repository, champions, traits });

  output.log(`Total stored matches: ${result.totalStoredMatches}`);
  output.log(`Successfully reparsed: ${result.successfullyReparsed}`);
  output.log(`Missing raw source: ${result.missingRawSource}`);
  output.log(`Failed reparses: ${result.failedReparses}`);
  output.log(`Backup path: ${result.backupPath}`);
  output.log(`Final repository total: ${result.finalRepositoryTotal}`);
  return result;
}

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  runReparseCli().catch((error) => {
    console.error(`Match reparse failed; original repository was not replaced: ${error.message || error}`);
    process.exitCode = 1;
  });
}
