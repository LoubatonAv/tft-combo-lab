import { importRiotPayload } from "../matchData/matchImportService.js";

export function selectChallengerEntries(entries, count) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.puuid || entry?.summonerId)
    .sort(
      (a, b) =>
        (Number(b.leaguePoints) || 0) - (Number(a.leaguePoints) || 0) ||
        String(a.puuid || a.summonerId).localeCompare(
          String(b.puuid || b.summonerId),
        ),
    )
    .slice(0, count);
}

export async function seedChallengerMatches({
  client,
  repository,
  champions = [],
  traits = [],
  playerCount,
  matchesPerPlayer,
  onProgress = () => {},
}) {
  const league = await client.fetchChallengerLeague();
  if (!league || !Array.isArray(league.entries)) {
    throw new Error("Riot Challenger League response did not include entries.");
  }

  const selected = selectChallengerEntries(league.entries, playerCount);
  onProgress({ type: "league", entriesFound: league.entries.length });
  onProgress({ type: "selection", playersSelected: selected.length });

  const uniqueMatchIds = new Set();
  let duplicateMatchIds = 0;
  let failedPlayerResolutions = 0;
  let failedMatchIdRequests = 0;

  for (let index = 0; index < selected.length; index += 1) {
    onProgress({ type: "player-resolution", current: index + 1, total: selected.length });
    let puuid = selected[index].puuid;
    try {
      if (!puuid) {
        const summoner = await client.resolveSummonerId(selected[index].summonerId);
        puuid = summoner.puuid;
      }
    } catch (error) {
      failedPlayerResolutions += 1;
      onProgress({ type: "player-resolution-failed", current: index + 1, error });
      continue;
    }

    onProgress({
      type: "match-ids-request",
      current: index + 1,
      requested: matchesPerPlayer,
    });
    let matchIds;
    try {
      matchIds = await client.fetchMatchIds(puuid, {
        start: 0,
        count: matchesPerPlayer,
      });
    } catch (error) {
      failedMatchIdRequests += 1;
      onProgress({ type: "match-ids-failed", current: index + 1, error });
      continue;
    }

    for (const matchId of matchIds) {
      if (uniqueMatchIds.has(matchId)) duplicateMatchIds += 1;
      else uniqueMatchIds.add(matchId);
    }
  }

  const importedMatches = [];
  let matchesFetched = 0;
  let failedMatchFetches = 0;
  const ids = [...uniqueMatchIds];
  for (let index = 0; index < ids.length; index += 1) {
    onProgress({ type: "match-fetch", current: index + 1, total: ids.length, matchId: ids[index] });
    try {
      const payload = await client.fetchMatch(ids[index]);
      matchesFetched += 1;
      importedMatches.push(importRiotPayload(payload, { champions, traits }));
    } catch (error) {
      failedMatchFetches += 1;
      onProgress({ type: "match-fetch-failed", matchId: ids[index], error });
    }
  }

  const imported = await repository.saveImportedMatches(importedMatches);
  if (imported.importedCount) await repository.rebuildDerivedBoardStatistics();
  const participantBoardSamples = await repository.countSamples();

  return {
    challengerEntriesFound: league.entries.length,
    playersSelected: selected.length,
    matchIdsRequestedPerPlayer: matchesPerPlayer,
    uniqueMatchIdsDiscovered: uniqueMatchIds.size,
    duplicateMatchIdsDiscovered: duplicateMatchIds,
    matchesFetched,
    matchesImported: imported.importedCount,
    repositoryDuplicates: imported.duplicateCount,
    failedPlayerResolutions,
    failedMatchIdRequests,
    failedMatchFetches,
    finalRepositoryTotal: imported.totalMatches,
    participantBoardSamples,
  };
}
