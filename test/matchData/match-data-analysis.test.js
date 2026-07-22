import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeMatchData,
  classifyReadiness,
} from "../../server/src/matchData/matchDataAnalysis.js";
import { runAnalysisCli } from "../../scripts/analyze-match-data.mjs";

function participant(fingerprint, placement, overrides = {}) {
  return {
    placement,
    augments: ["augment"],
    board: {
      setNumber: 17,
      patch: "16.14",
      boardFingerprint: fingerprint,
      contextFingerprint: `17:16.14:${fingerprint}`,
      units: [{ unitId: "unit", itemIds: ["item"] }],
      activeTraits: [{ traitId: "trait" }],
    },
    ...overrides,
  };
}

function sampleStore() {
  return {
    matches: [
      {
        matchId: "ONE",
        set: 17,
        patch: "16.14",
        participants: [
          participant("board-a", 1),
          participant("board-a", 3),
          participant("board-b", 8, {
            augments: null,
            board: {
              setNumber: null,
              patch: null,
              boardFingerprint: "board-b",
              contextFingerprint: "context-b",
              units: [{ unitId: "unit", itemIds: [] }],
              activeTraits: [],
            },
          }),
        ],
      },
      {
        matchId: "TWO",
        set: 18,
        patch: "16.15",
        participants: [participant("board-a", 2, {
          board: {
            ...participant("board-a", 2).board,
            setNumber: 18,
            patch: "16.15",
            contextFingerprint: "18:16.15:board-a",
          },
        })],
      },
    ],
  };
}

test("empty repository produces deterministic insufficient analysis", () => {
  const result = analyzeMatchData({ matches: [] });
  assert.equal(result.totalMatches, 0);
  assert.equal(result.totalParticipantBoardSamples, 0);
  assert.equal(result.readiness.classification, "insufficient");
});

test("analysis groups sets and patches and calculates fingerprint placements", () => {
  const result = analyzeMatchData(sampleStore(), { minimumSamples: 3, top: 20 });
  assert.deepEqual(result.countsBySet, [
    { value: "17", matches: 1, boards: 3 },
    { value: "18", matches: 1, boards: 1 },
  ]);
  assert.deepEqual(result.countsByPatch, [
    { value: "16.14", matches: 1, boards: 3 },
    { value: "16.15", matches: 1, boards: 1 },
  ]);
  assert.equal(result.uniqueBoardFingerprints, 2);
  assert.equal(result.uniqueContextFingerprints, 3);
  assert.deepEqual(result.fingerprintFrequency, {
    once: 1,
    atLeast2: 1,
    atLeast3: 1,
    atLeast5: 0,
    atLeast10: 0,
  });
  assert.equal(result.placementStatistics.length, 1);
  assert.deepEqual(result.placementStatistics[0], {
    fingerprint: "board-a",
    boardCount: 3,
    sampleSize: 3,
    averagePlacement: 2,
    top4Rate: 1,
    winRate: 1 / 3,
  });
  assert.deepEqual(result.placementDistribution, {
    1: 1, 2: 1, 3: 1, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1,
  });
});

test("analysis reports missing data and invalid participant counts", () => {
  const result = analyzeMatchData(sampleStore());
  assert.deepEqual(result.completeness, {
    missingAugments: 1,
    emptyItems: 1,
    missingTraits: 1,
    missingSet: 0,
    missingPatch: 0,
    invalidParticipantCounts: 2,
  });
});

test("readiness classification thresholds are explicit and deterministic", () => {
  assert.equal(classifyReadiness(49, { atLeast2: 99, atLeast3: 99, atLeast5: 99 }), "insufficient");
  assert.equal(classifyReadiness(199, { atLeast2: 99, atLeast3: 99, atLeast5: 99 }), "exploratory only");
  assert.equal(classifyReadiness(499, { atLeast2: 99, atLeast3: 99, atLeast5: 99 }), "usable with low confidence");
  assert.equal(classifyReadiness(1999, { atLeast2: 99, atLeast3: 99, atLeast5: 99 }), "usable");
  assert.equal(classifyReadiness(2000, { atLeast2: 5, atLeast3: 10, atLeast5: 25 }), "strong");
});

test("malformed repositories produce clear errors", () => {
  assert.throws(() => analyzeMatchData(null), /JSON object/);
  assert.throws(() => analyzeMatchData({}), /matches.*array/);
});

test("JSON CLI output is exclusive, respects configured path, and performs no writes", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "match-analysis-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repositoryPath = path.join(directory, "challenger.json");
  await fs.writeFile(repositoryPath, JSON.stringify(sampleStore()));
  const before = await fs.readFile(repositoryPath);
  const logs = [];

  const result = await runAnalysisCli({
    argv: ["--minimum-samples", "2", "--top", "1", "--json"],
    env: { TFT_MATCH_DATA_PATH: repositoryPath },
    loadEnv() {},
    output: { log: (line) => logs.push(line) },
  });

  assert.equal(result.repositoryPath, path.resolve(repositoryPath));
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), result);
  assert.deepEqual(await fs.readFile(repositoryPath), before);
});

test("CLI distinguishes empty files and malformed JSON", async () => {
  for (const [raw, pattern] of [["", /is empty/], ["{", /invalid JSON/]]) {
    await assert.rejects(
      runAnalysisCli({
        argv: [],
        env: { TFT_MATCH_DATA_PATH: "ignored.json" },
        loadEnv() {},
        readFile: async () => raw,
        output: { log() {} },
      }),
      pattern,
    );
  }
});
