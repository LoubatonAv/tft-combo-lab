import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  MAX_MATCH_COUNT,
  parseRiotFetchArgs,
  runRiotFetchCli,
} from "../../scripts/fetch-riot-matches.mjs";
import {
  parseInspectArgs,
  summarizeRawMatch,
} from "../../scripts/inspect-riot-match.mjs";
import { JsonMatchRepository } from "../../server/src/matchData/jsonMatchRepository.js";
import { ingestRecentRiotMatches } from "../../server/src/riotApi/riotMatchIngestion.js";

const fixtures = JSON.parse(
  await fs.readFile(new URL("../fixtures/riot-matches.json", import.meta.url)),
);

async function temporaryRepository(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "riot-ingest-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return new JsonMatchRepository(path.join(directory, "matches.json"));
}

test("ingestion uses the existing parser/repository and tolerates partial batch failure", async (t) => {
  const repository = await temporaryRepository(t);
  const events = [];
  const client = {
    async resolveRiotId() {
      return {
        platform: "euw1",
        regionalRoute: "europe",
        account: { puuid: "player-puuid", gameName: "Name", tagLine: "TAG" },
        summoner: { id: "summoner-id" },
      };
    },
    async fetchMatchIds() {
      return ["SET17_001", "BROKEN_HTTP", "BROKEN_PAYLOAD"];
    },
    async fetchMatch(matchId) {
      if (matchId === "BROKEN_HTTP") {
        throw Object.assign(new Error("HTTP 503"), { status: 503 });
      }
      if (matchId === "BROKEN_PAYLOAD") return { info: { participants: [] } };
      return fixtures[0];
    },
  };

  const first = await ingestRecentRiotMatches({
    client,
    repository,
    gameName: "Name",
    tagLine: "TAG",
    count: 3,
    onProgress: (event) => events.push(event.type),
  });
  assert.equal(first.importedCount, 1);
  assert.equal(first.duplicateCount, 0);
  assert.equal(first.failedCount, 2);
  assert.deepEqual(
    first.failedMatches.map((entry) => entry.matchId),
    ["BROKEN_HTTP", "BROKEN_PAYLOAD"],
  );
  assert.equal((await repository.queryParticipants())[0].board.boardSize, 4);
  assert.ok(events.includes("player-resolved"));
  assert.ok(events.includes("match-ids"));

  const second = await ingestRecentRiotMatches({
    client,
    repository,
    gameName: "Name",
    tagLine: "TAG",
    count: 3,
  });
  assert.equal(second.importedCount, 0);
  assert.equal(second.duplicateCount, 1);
  assert.equal(second.totalMatches, 1);
});

test("CLI parser validates required arguments, bounds, and defaults", () => {
  assert.deepEqual(
    parseRiotFetchArgs([
      "--game-name",
      "Player Name",
      "--tag-line",
      "TAG",
      "--platform",
      "EUW1",
    ]),
    {
      help: false,
      gameName: "Player Name",
      tagLine: "TAG",
      platform: "euw1",
      count: 20,
      start: 0,
    },
  );

  for (const args of [
    [],
    ["--game-name", "Name", "--tag-line", "TAG"],
    ["--game-name", "Name", "--tag-line", "TAG", "--platform", "bad"],
    ["--game-name", "Name", "--tag-line", "TAG", "--platform", "euw1", "--count", "0"],
    ["--game-name", "Name", "--tag-line", "TAG", "--platform", "euw1", "--count", String(MAX_MATCH_COUNT + 1)],
    ["--game-name", "Name", "--tag-line", "TAG", "--platform", "euw1", "--start", "-1"],
    ["--game-name", "Name", "--tag-line", "TAG", "--platform", "euw1", "--unknown", "x"],
  ]) {
    assert.throws(() => parseRiotFetchArgs(args));
  }
});

test("CLI rejects a missing environment API key without making HTTP requests", async () => {
  let fetchCalled = false;
  await assert.rejects(
    runRiotFetchCli({
      argv: [
        "--game-name",
        "Name",
        "--tag-line",
        "TAG",
        "--platform",
        "euw1",
      ],
      env: {},
      fetchImpl: async () => {
        fetchCalled = true;
      },
      output: { log() {}, error() {} },
    }),
    /RIOT_API_KEY/,
  );
  assert.equal(fetchCalled, false);
});

test("CLI reports controlled ingestion progress with mocked Riot HTTP", async (t) => {
  const repository = await temporaryRepository(t);
  const logs = [];
  const errors = [];
  const responses = [
    { puuid: "puuid-123", gameName: "Name", tagLine: "TAG" },
    { id: "summoner-id", puuid: "puuid-123" },
    ["SET17_001"],
    fixtures[0],
  ];
  let requestIndex = 0;

  const result = await runRiotFetchCli({
    argv: [
      "--game-name",
      "Name",
      "--tag-line",
      "TAG",
      "--platform",
      "euw1",
      "--count",
      "1",
    ],
    env: { RIOT_API_KEY: "test-key" },
    repository,
    output: {
      log: (message) => logs.push(message),
      error: (message) => errors.push(message),
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => responses[requestIndex++],
    }),
    sleep: async () => {},
    random: () => 0.5,
  });

  assert.equal(result.importedCount, 1);
  assert.equal(result.failedCount, 0);
  assert.equal(errors.length, 0);
  assert.ok(logs.some((line) => line.startsWith("Player resolved:")));
  assert.ok(logs.includes("Match IDs found: 1"));
  assert.ok(logs.includes("Fetching match 1/1: SET17_001"));
  assert.ok(logs.includes("Imported count: 1"));
  assert.ok(logs.includes("Duplicate count: 0"));
  assert.ok(logs.includes("Failed count: 0"));
  assert.ok(logs.includes("Final repository total: 1"));
  assert.equal(logs.some((line) => line.includes("test-key")), false);
});

test("raw match inspector redacts identity fields and exposes schema fields", () => {
  assert.deepEqual(
    parseInspectArgs(["--match-id", "EUW1_123", "--platform", "euw1"]),
    { matchId: "EUW1_123", platform: "euw1" },
  );
  const summary = summarizeRawMatch({
    metadata: { match_id: "EUW1_123", participants: ["secret-puuid"] },
    info: {
      game_version: "Linux Version 16.14.1",
      tft_set_number: 17,
      participants: [
        {
          puuid: "secret-puuid",
          riotIdGameName: "private-name",
          augments: ["TFT_Augment_One"],
          units: [],
        },
      ],
    },
  });

  const printed = JSON.stringify(summary);
  assert.equal(summary.relevantInfoFields.tft_set_number, 17);
  assert.deepEqual(summary.relevantParticipantFields.augments, [
    "TFT_Augment_One",
  ]);
  assert.doesNotMatch(printed, /secret-puuid|private-name/);
});

test("raw match inspector makes an absent augment field explicit", () => {
  const summary = summarizeRawMatch({
    metadata: { match_id: "EUW1_123" },
    info: {
      tft_set_number: 17,
      participants: [{ placement: 2, units: [], traits: [] }],
    },
  });

  assert.equal(summary.relevantParticipantFields.augments, "<absent>");
});
