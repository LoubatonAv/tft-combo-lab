import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeMatchData,
  classifyReadiness,
  comparePatches,
} from "../../server/src/matchData/matchDataAnalysis.js";
import {
  compareBoardsRelaxed,
  createAnalysisMetadata,
  createBoardSignatures,
  selectCarries,
  selectCoreUnits,
} from "../../server/src/matchData/boardSignatures.js";
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
  assert.equal(result.readiness.exactSignatures, "insufficient");
});

test("analysis groups sets and patches and calculates fingerprint placements", () => {
  const result = analyzeMatchData(sampleStore(), { minimumSamples: 2, top: 20 });
  assert.deepEqual(result.countsBySet, [
    { value: "17", matches: 1, boards: 3 },
    { value: "18", matches: 1, boards: 1 },
  ]);
  assert.deepEqual(result.countsByPatch, [
    { value: "16.14", matches: 1, boards: 3 },
    { value: "16.15", matches: 1, boards: 1 },
  ]);
  assert.equal(result.uniqueBoardFingerprints, 3);
  assert.equal(result.uniqueContextFingerprints, 3);
  assert.deepEqual(result.fingerprintFrequency, {
    once: 2,
    atLeast2: 1,
    atLeast3: 0,
    atLeast5: 0,
    atLeast10: 0,
  });
  assert.equal(result.placementStatistics.length, 1);
  assert.equal(result.placementStatistics[0].signature, "board-a");
  assert.equal(result.placementStatistics[0].sampleSize, 2);
  assert.equal(result.placementStatistics[0].averagePlacement, 2);
  assert.equal(result.placementStatistics[0].top4Rate, 1);
  assert.equal(result.placementStatistics[0].winRate, 1 / 2);
  assert.deepEqual(result.placementDistribution, {
    1: 1, 2: 1, 3: 1, 4: 0, 5: 0, 6: 0, 7: 0, 8: 1,
  });
});

test("analysis reports missing data and invalid participant counts", () => {
  const result = analyzeMatchData(sampleStore());
  assert.deepEqual(result.completeness, {
    missingAugments: 1,
    unitsWithNoItems: 1,
    missingItemArrays: 0,
    invalidItemIds: 0,
    unknownItemIds: 3,
    componentItems: 0,
    completedItems: 0,
    missingTraits: 1,
    missingSet: 0,
    missingPatch: 0,
    invalidParticipantCounts: 2,
  });
});

const metadata = createAnalysisMetadata({
  itemCatalog: {
    "Sword Item": {
      iconUrl: "https://example.test/tft_item_sworditem.png",
      components: ["B.F. Sword", "Recurve Bow"],
    },
    "Rod Item": {
      iconUrl: "https://example.test/tft_item_roditem.png",
      components: ["Needlessly Large Rod", "Giant's Belt"],
    },
  },
});

function signatureBoard(overrides = {}) {
  return {
    setNumber: 17,
    patch: "16.14",
    boardFingerprint: "exact",
    units: [
      { unitId: "a", cost: 5, starLevel: 2, itemIds: ["tft_item_sworditem", "tft_item_roditem"] },
      { unitId: "b", cost: 2, starLevel: 2, itemIds: [] },
      { unitId: "c", cost: 1, starLevel: 3, itemIds: [] },
    ],
    activeTraits: [{ traitId: "trait-a", activeTier: 2, unitCount: 3 }],
    ...overrides,
  };
}

test("relaxed signatures ignore position and unit signatures ignore stars and items", () => {
  const board = signatureBoard();
  const reordered = signatureBoard({
    units: [
      { ...board.units[2], starLevel: 1 },
      { ...board.units[0], itemIds: ["tft_item_roditem"] },
      board.units[1],
    ],
  });
  const first = createBoardSignatures(board, metadata);
  const second = createBoardSignatures(reordered, metadata);
  assert.equal(first.unit, second.unit);
  assert.notEqual(first.carry, second.carry);
});

test("trait, carry, and core selection are deterministic", () => {
  const board = signatureBoard();
  const changedTraits = signatureBoard({ activeTraits: [{ traitId: "trait-b", activeTier: 1, unitCount: 2 }] });
  assert.notEqual(createBoardSignatures(board, metadata).trait, createBoardSignatures(changedTraits, metadata).trait);
  assert.deepEqual(selectCarries(board, metadata).map((unit) => unit.unitId), ["a"]);
  assert.deepEqual(selectCoreUnits(board, metadata).map((unit) => unit.unitId), ["a", "c"]);
  assert.deepEqual(selectCoreUnits({ ...board, units: [...board.units].reverse() }, metadata).map((unit) => unit.unitId), ["a", "c"]);
});

test("sets never group and relaxed similarity is symmetric, bounded, and intuitive", () => {
  const board = signatureBoard();
  const otherSet = signatureBoard({ setNumber: 18 });
  assert.notEqual(createBoardSignatures(board, metadata).unit, createBoardSignatures(otherSet, metadata).unit);
  assert.equal(compareBoardsRelaxed(board, otherSet, metadata).score, 0);
  assert.equal(compareBoardsRelaxed(board, board, metadata).score, 1);
  const unrelated = signatureBoard({
    units: [{ unitId: "x", cost: 1, starLevel: 1, itemIds: [] }],
    activeTraits: [{ traitId: "other", activeTier: 1 }],
  });
  const forward = compareBoardsRelaxed(board, unrelated, metadata);
  const reverse = compareBoardsRelaxed(unrelated, board, metadata);
  assert.deepEqual(forward, reverse);
  assert.ok(forward.score >= 0 && forward.score <= 1);
  assert.ok(forward.score < 0.6);
  const separated = analyzeMatchData({
    matches: [
      { set: 17, patch: "16.14", participants: [{ placement: 1, board }] },
      { set: 18, patch: "16.14", participants: [{ placement: 2, board: otherSet }] },
    ],
  }, { metadata });
  assert.equal(separated.signatureStatistics.exact.uniqueCount, 2);
});

test("set and numeric patch filters apply before analysis and multiple sets warn", () => {
  assert.ok(comparePatches("16.9", "16.10") < 0);
  const all = analyzeMatchData(sampleStore());
  assert.equal(all.warnings.length, 1);
  const filtered = analyzeMatchData(sampleStore(), { setNumber: 17, patchMin: "16.9", patchMax: "16.14" });
  assert.equal(filtered.totalMatches, 1);
  assert.equal(filtered.totalParticipantBoardSamples, 3);
  assert.deepEqual(filtered.warnings, []);
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
    metadata: {},
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
