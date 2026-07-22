import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_CHALLENGER_PLAYERS,
  DEFAULT_MATCHES_PER_PLAYER,
  MAX_CHALLENGER_PLAYERS,
  MAX_MATCHES_PER_PLAYER,
  parseChallengerSeedArgs,
  runChallengerSeedCli,
} from "../../scripts/seed-challenger-matches.mjs";
import { JsonMatchRepository } from "../../server/src/matchData/jsonMatchRepository.js";
import { importRiotPayloads } from "../../server/src/matchData/matchImportService.js";
import {
  seedChallengerMatches,
  selectChallengerEntries,
} from "../../server/src/riotApi/riotChallengerSeeder.js";

const fixtures = JSON.parse(
  await fs.readFile(new URL("../fixtures/riot-matches.json", import.meta.url)),
);

async function temporaryPath(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "challenger-seed-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return path.join(directory, "matches.json");
}

test("Challenger selection is deterministic by league points and summoner ID", () => {
  const selected = selectChallengerEntries([
    { summonerId: "z", leaguePoints: 100 },
    { summonerId: "b", leaguePoints: 200 },
    { summonerId: "a", leaguePoints: 200 },
    { leaguePoints: 999 },
  ], 3);
  assert.deepEqual(selected.map((entry) => entry.summonerId), ["a", "b", "z"]);
});

test("seeding deduplicates lobbies and tolerates partial player and match failures", async (t) => {
  const repository = new JsonMatchRepository(await temporaryPath(t));
  await importRiotPayloads({ payloads: fixtures[0], repository });
  const fetchedIds = [];
  const client = {
    async fetchChallengerLeague() {
      return { entries: [
        { summonerId: "fail-player", leaguePoints: 300 },
        { summonerId: "player-a", leaguePoints: 200 },
        { summonerId: "player-b", leaguePoints: 100 },
      ] };
    },
    async resolveSummonerId(id) {
      if (id === "fail-player") throw new Error("not found");
      return { puuid: `puuid-${id}` };
    },
    async fetchMatchIds(puuid, options) {
      assert.deepEqual(options, { start: 0, count: 2 });
      return puuid.endsWith("player-a")
        ? ["SET17_001", "NEW_MATCH"]
        : ["SET17_001", "BROKEN_MATCH"];
    },
    async fetchMatch(matchId) {
      fetchedIds.push(matchId);
      if (matchId === "BROKEN_MATCH") throw new Error("HTTP 503");
      const payload = structuredClone(fixtures[0]);
      payload.metadata.match_id = matchId;
      return payload;
    },
  };

  const result = await seedChallengerMatches({
    client,
    repository,
    playerCount: 3,
    matchesPerPlayer: 2,
  });

  assert.deepEqual(fetchedIds, ["SET17_001", "NEW_MATCH", "BROKEN_MATCH"]);
  assert.deepEqual(result, {
    challengerEntriesFound: 3,
    playersSelected: 3,
    matchIdsRequestedPerPlayer: 2,
    uniqueMatchIdsDiscovered: 3,
    duplicateMatchIdsDiscovered: 1,
    matchesFetched: 2,
    matchesImported: 1,
    repositoryDuplicates: 1,
    failedPlayerResolutions: 1,
    failedMatchIdRequests: 0,
    failedMatchFetches: 1,
    finalRepositoryTotal: 2,
    participantBoardSamples: 2,
  });
});

test("CLI argument defaults, caps, missing key, and invalid platform are safe", async () => {
  assert.deepEqual(parseChallengerSeedArgs(["--platform", "EUW1"]), {
    platform: "euw1",
    players: DEFAULT_CHALLENGER_PLAYERS,
    matchesPerPlayer: DEFAULT_MATCHES_PER_PLAYER,
  });
  for (const args of [
    ["--platform", "bad"],
    ["--platform", "euw1", "--players", String(MAX_CHALLENGER_PLAYERS + 1)],
    ["--platform", "euw1", "--matches-per-player", String(MAX_MATCHES_PER_PLAYER + 1)],
  ]) assert.throws(() => parseChallengerSeedArgs(args));

  await assert.rejects(
    runChallengerSeedCli({
      argv: ["--platform", "euw1"],
      env: {},
      loadEnv() {},
    }),
    /RIOT_API_KEY/,
  );
});

test("CLI respects TFT_MATCH_DATA_PATH and reports complete safe summary", async (t) => {
  const repositoryPath = await temporaryPath(t);
  const logs = [];
  const errors = [];
  const match = structuredClone(fixtures[0]);
  const responses = [
    { entries: [{ summonerId: "encrypted-summoner", leaguePoints: 500 }] },
    { id: "encrypted-summoner", puuid: "secret-puuid" },
    ["SET17_001"],
    match,
  ];
  let request = 0;

  const result = await runChallengerSeedCli({
    argv: ["--platform", "euw1", "--players", "1", "--matches-per-player", "1"],
    env: { RIOT_API_KEY: "secret-key", TFT_MATCH_DATA_PATH: repositoryPath },
    output: { log: (line) => logs.push(line), error: (line) => errors.push(line) },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => responses[request++],
    }),
    sleep: async () => {},
    random: () => 0.5,
  });

  assert.equal(result.matchesImported, 1);
  assert.equal((await new JsonMatchRepository(repositoryPath).readStore()).matches.length, 1);
  assert.equal(errors.length, 0);
  assert.ok(logs.includes("Challenger entries found: 1"));
  assert.ok(logs.includes("Players selected: 1"));
  assert.ok(logs.includes("Unique match IDs discovered: 1"));
  assert.ok(logs.includes("Total participant-board samples available: 1"));
  assert.doesNotMatch(JSON.stringify(logs), /secret-key|secret-puuid|encrypted-summoner/);
});
