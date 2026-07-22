import { importRiotPayload } from "../matchData/matchImportService.js";

export async function ingestRecentRiotMatches({
  client,
  repository,
  champions = [],
  traits = [],
  gameName,
  tagLine,
  start = 0,
  count = 20,
  includeRaw = true,
  onProgress = () => {},
}) {
  const player = await client.resolveRiotId(gameName, tagLine);
  onProgress({ type: "player-resolved", player });

  const matchIds = await client.fetchMatchIds(player.account.puuid, {
    start,
    count,
  });
  onProgress({ type: "match-ids", matchIds });

  const importedMatches = [];
  const failedMatches = [];

  for (let index = 0; index < matchIds.length; index += 1) {
    const matchId = matchIds[index];
    onProgress({
      type: "match-start",
      matchId,
      current: index + 1,
      total: matchIds.length,
    });

    try {
      const payload = await client.fetchMatch(matchId);
      importedMatches.push(
        importRiotPayload(payload, {
          champions,
          traits,
          includeRaw,
        }),
      );
    } catch (error) {
      failedMatches.push({
        matchId,
        status: error.status ?? null,
        message: error.message || "Match fetch failed.",
      });
      onProgress({ type: "match-failed", matchId, error });
    }
  }

  const importResult = await repository.saveImportedMatches(importedMatches);
  const rebuiltStatistics = importResult.importedCount
    ? await repository.rebuildDerivedBoardStatistics()
    : null;

  const result = {
    player,
    matchIds,
    requestedCount: count,
    fetchedCount: importedMatches.length,
    failedCount: failedMatches.length,
    failedMatches,
    importedCount: importResult.importedCount,
    duplicateCount: importResult.duplicateCount,
    totalMatches: importResult.totalMatches,
    rebuiltStatisticGroups: rebuiltStatistics?.length ?? null,
  };
  onProgress({ type: "complete", result });
  return result;
}
