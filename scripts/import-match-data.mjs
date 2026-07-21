import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonMatchRepository } from "../server/src/matchData/jsonMatchRepository.js";
import { importRiotPayloads } from "../server/src/matchData/matchImportService.js";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");
const sourcePath = process.argv[2];

if (!sourcePath) {
  console.error(
    "Usage: npm run import:matches -- path/to/riot-match-or-array.json",
  );
  process.exit(1);
}

try {
  const [sourceRaw, championsRaw, traitsRaw] = await Promise.all([
    fs.readFile(path.resolve(sourcePath), "utf8"),
    fs.readFile(
      path.join(projectRoot, "server/data/champions.json"),
      "utf8",
    ),
    fs.readFile(path.join(projectRoot, "server/data/traits.json"), "utf8"),
  ]);
  const payloads = JSON.parse(sourceRaw);
  const champions = JSON.parse(championsRaw);
  const traits = JSON.parse(traitsRaw);
  const repository = new JsonMatchRepository(
    process.env.TFT_MATCH_DATA_PATH ||
      path.join(projectRoot, "server/data/importedMatches.json"),
  );
  const result = await importRiotPayloads({
    payloads,
    repository,
    champions,
    traits,
  });
  const rebuilt = result.importedCount
    ? await repository.rebuildDerivedBoardStatistics()
    : null;

  console.log(
    `Imported ${result.importedCount}; skipped ${result.duplicateCount} duplicate(s); ${result.totalMatches} total match(es).`,
  );
  console.log(
    rebuilt
      ? `Rebuilt ${rebuilt.length} contextual-fingerprint statistic group(s).`
      : "No new matches; derived statistics were left unchanged.",
  );
} catch (error) {
  console.error(`Match import failed: ${error.message || error}`);
  process.exit(1);
}
