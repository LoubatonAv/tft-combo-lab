import fs from "node:fs/promises";
import path from "node:path";
import { importRiotPayload } from "./matchImportService.js";

function timestamp(value) {
  return value.toISOString().replace(/[:.]/g, "-");
}

export async function reparseMatchRepository({
  repository,
  champions = [],
  traits = [],
  now = () => new Date(),
  copyFile = fs.copyFile,
} = {}) {
  if (!repository?.filePath) throw new Error("A match repository is required.");

  const store = structuredClone(await repository.readStore());
  const reparsedMatches = [];
  const failedMatchIds = [];
  let missingRawSource = 0;
  let successfullyReparsed = 0;

  for (const storedMatch of store.matches) {
    const rawSource = storedMatch?.rawSource;
    if (!rawSource || typeof rawSource !== "object" || Array.isArray(rawSource)) {
      missingRawSource += 1;
      reparsedMatches.push(storedMatch);
      continue;
    }

    try {
      const reparsed = importRiotPayload(rawSource, {
        champions,
        traits,
        includeRaw: true,
        importedAt: storedMatch.importedAt,
      });
      reparsed.matchId = storedMatch.matchId;
      reparsedMatches.push(reparsed);
      successfullyReparsed += 1;
    } catch {
      failedMatchIds.push(storedMatch.matchId);
      reparsedMatches.push(storedMatch);
    }
  }

  const backupPath = `${repository.filePath}.backup-${timestamp(now())}`;
  await fs.mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(repository.filePath, backupPath);

  const replacement = await repository.replaceMatchesAndRebuildStatistics(
    reparsedMatches,
  );

  return {
    totalStoredMatches: store.matches.length,
    successfullyReparsed,
    missingRawSource,
    failedReparses: failedMatchIds.length,
    failedMatchIds,
    backupPath,
    finalRepositoryTotal: replacement.totalMatches,
    derivedStatisticGroups: replacement.derivedStatisticGroups,
  };
}
