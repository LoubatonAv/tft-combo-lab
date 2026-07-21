import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeFinalBoard } from "../../server/src/matchData/boardNormalizer.js";
import { calculateBoardStatistics } from "../../server/src/matchData/boardStatistics.js";
import {
  compareNormalizedBoards,
  DEFAULT_SIMILARITY_WEIGHTS,
} from "../../server/src/matchData/boardSimilarity.js";
import { JsonMatchRepository } from "../../server/src/matchData/jsonMatchRepository.js";
import { importRiotPayloads } from "../../server/src/matchData/matchImportService.js";

const fixtures = JSON.parse(
  await fs.readFile(new URL("../fixtures/riot-matches.json", import.meta.url)),
);
const candidate = normalizeFinalBoard({
  setNumber: 17,
  patch: "17.7",
  units: fixtures[0].info.participants[0].units,
  traits: fixtures[0].info.participants[0].traits,
});

async function seededRepository(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tft-stat-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = new JsonMatchRepository(path.join(directory, "matches.json"));
  await importRiotPayloads({ payloads: fixtures.slice(0, 8), repository });
  return repository;
}

test("similarity has understandable behavior across clear scenarios", () => {
  const near = normalizeFinalBoard({
    setNumber: 17,
    patch: "17.7",
    units: fixtures[1].info.participants[0].units,
    traits: fixtures[1].info.participants[0].traits,
  });
  const traitsOnly = normalizeFinalBoard({
    setNumber: 17,
    patch: "17.7",
    units: fixtures[3].info.participants[0].units,
    traits: fixtures[3].info.participants[0].traits,
  });
  const unrelated = normalizeFinalBoard({
    setNumber: 17,
    patch: "17.7",
    units: fixtures[4].info.participants[0].units,
    traits: fixtures[4].info.participants[0].traits,
  });
  const identicalResult = compareNormalizedBoards(candidate, candidate);
  const nearResult = compareNormalizedBoards(candidate, near);
  const traitsOnlyResult = compareNormalizedBoards(candidate, traitsOnly);
  const unrelatedResult = compareNormalizedBoards(candidate, unrelated);
  const oneSupportDifference = normalizeFinalBoard({
    ...candidate,
    units: candidate.units.map((unit) =>
      unit.unitId === "tft17_pantheon"
        ? { unitId: "tft17_other_support", starLevel: 2 }
        : unit,
    ),
  });
  const changedEquipment = normalizeFinalBoard({
    setNumber: 17,
    patch: "17.7",
    units: candidate.units.map((unit) => ({
      unitId: unit.unitId,
      starLevel: unit.starLevel === 4 ? 1 : 4,
      items: ["completely_different_item"],
    })),
    activeTraits: candidate.activeTraits.map((trait) => ({
      ...trait,
      isActive: true,
    })),
  });
  const changedEquipmentResult = compareNormalizedBoards(
    candidate,
    changedEquipment,
  );
  const withExtraUnit = normalizeFinalBoard({
    ...candidate,
    units: [...candidate.units, { unitId: "tft17_support", starLevel: 1 }],
  });
  const carryReplaced = normalizeFinalBoard({
    ...candidate,
    units: candidate.units.map((unit) =>
      unit.unitId === "tft17_riven"
        ? { unitId: "tft17_other_carry", starLevel: unit.starLevel }
        : unit,
    ),
  });

  assert.equal(identicalResult.score, 1);
  assert.ok(nearResult.score > 0.8);
  assert.ok(compareNormalizedBoards(candidate, oneSupportDifference).score > 0.8);
  assert.ok(traitsOnlyResult.score < 0.35);
  assert.ok(changedEquipmentResult.score < identicalResult.score);
  assert.ok(unrelatedResult.score < 0.1);
  assert.ok(
    compareNormalizedBoards(candidate, withExtraUnit).score >
      compareNormalizedBoards(candidate, carryReplaced).score,
  );
  assert.match(nearResult.explanation, /units overlap/);
  assert.equal(nearResult.sharedUnitIds.length, 4);
  assert.deepEqual(DEFAULT_SIMILARITY_WEIGHTS, {
    sharedUnits: 0.42,
    unitSetSimilarity: 0.13,
    starLevels: 0.1,
    sharedTraits: 0.12,
    traitTiers: 0.06,
    sharedItems: 0.12,
    boardSize: 0.05,
  });
});

test("statistics calculate placements, variations, and minimum-sample reliability", async (t) => {
  const repository = await seededRepository(t);
  const sufficient = await calculateBoardStatistics({
    candidateBoard: candidate,
    repository,
    setNumber: 17,
    patch: "17.7",
    minimumSimilarity: 0.55,
    minimumSampleSize: 2,
  });

  assert.ok(sufficient.sampleSize >= 2);
  assert.ok(sufficient.averagePlacement >= 1);
  assert.ok(sufficient.top4Rate > 0);
  assert.equal(sufficient.confidence.reliable, true);
  assert.ok(sufficient.commonUnitVariations.length > 0);
  assert.ok(sufficient.commonItemVariations.length > 0);

  const insufficient = await calculateBoardStatistics({
    candidateBoard: candidate,
    repository,
    setNumber: 17,
    patch: "17.7",
    minimumSimilarity: 0.9,
    minimumSampleSize: 10,
  });
  assert.equal(insufficient.confidence.level, "insufficient");
  assert.equal(insufficient.confidence.reliable, false);
});

test("statistics are unweighted, ignore invalid placements, and honor the exact reliability threshold", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tft-placement-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const repository = new JsonMatchRepository(path.join(directory, "matches.json"));
  const placements = [1, 5, 0, 9, null];
  const payloads = placements.map((placement, index) => {
    const payload = structuredClone(fixtures[0]);
    payload.metadata.match_id = `PLACEMENT_${index}`;
    payload.info.participants[0].puuid = `placement-player-${index}`;
    payload.info.participants[0].placement = placement;
    return payload;
  });
  await importRiotPayloads({ payloads, repository });

  const statistics = await calculateBoardStatistics({
    candidateBoard: candidate,
    repository,
    setNumber: 17,
    patch: "17.7",
    minimumSimilarity: 0.9,
    minimumSampleSize: 2,
  });

  assert.equal(statistics.similarBoardCount, 5);
  assert.equal(statistics.sampleSize, 2);
  assert.equal(statistics.averagePlacement, 3);
  assert.equal(statistics.top4Rate, 0.5);
  assert.equal(statistics.winRate, 0.5);
  assert.equal(statistics.confidence.reliable, true);
});

test("statistics honor patch and set filtering", async (t) => {
  const repository = await seededRepository(t);
  const currentPatch = await calculateBoardStatistics({
    candidateBoard: candidate,
    repository,
    setNumber: 17,
    patch: "17.7",
    minimumSimilarity: 0,
    minimumSampleSize: 1,
  });
  const allSet17 = await calculateBoardStatistics({
    candidateBoard: candidate,
    repository,
    setNumber: 17,
    minimumSimilarity: 0,
    minimumSampleSize: 1,
  });
  const otherSet = await calculateBoardStatistics({
    candidateBoard: candidate,
    repository,
    setNumber: 16,
    minimumSimilarity: 0,
    minimumSampleSize: 1,
  });

  assert.equal(currentPatch.sampleSize, 5);
  assert.equal(allSet17.sampleSize, 6);
  assert.equal(otherSet.sampleSize, 1);
});
