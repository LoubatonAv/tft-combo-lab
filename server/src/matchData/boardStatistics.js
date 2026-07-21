import { compareNormalizedBoards } from "./boardSimilarity.js";

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function increment(map, key, placement) {
  const current = map.get(key) || {
    count: 0,
    placementTotal: 0,
    placementSamples: 0,
  };
  current.count += 1;
  if (Number.isInteger(placement) && placement >= 1 && placement <= 8) {
    current.placementTotal += placement;
    current.placementSamples += 1;
  }
  map.set(key, current);
}

function commonRows(map, sampleSize, keyName) {
  return [...map.entries()]
    .map(([key, value]) => ({
      [keyName]: key,
      count: value.count,
      presenceRate: round(value.count / Math.max(sampleSize, 1)),
      averagePlacement: value.placementSamples
        ? round(value.placementTotal / value.placementSamples, 3)
        : null,
    }))
    .sort((a, b) => b.count - a.count || String(a[keyName]).localeCompare(String(b[keyName])))
    .slice(0, 20);
}

function confidenceFor(sampleSize, minimumSampleSize, averageSimilarity) {
  if (sampleSize < minimumSampleSize) {
    return {
      level: "insufficient",
      reliable: false,
      reason: `Only ${sampleSize} similar board(s); at least ${minimumSampleSize} are required.`,
    };
  }

  if (sampleSize >= minimumSampleSize * 5 && averageSimilarity >= 0.8) {
    return {
      level: "high",
      reliable: true,
      reason: "Large enough sample with high average board similarity.",
    };
  }

  if (sampleSize >= minimumSampleSize * 2 && averageSimilarity >= 0.7) {
    return {
      level: "medium",
      reliable: true,
      reason: "Adequate sample with useful average board similarity.",
    };
  }

  return {
    level: "low",
    reliable: true,
    reason: "Minimum sample met, but more or closer matches are recommended.",
  };
}

export async function calculateBoardStatistics({
  candidateBoard,
  repository,
  setNumber = candidateBoard?.setNumber,
  patch = null,
  minimumSimilarity = 0.65,
  minimumSampleSize = 5,
  weights,
}) {
  if (!candidateBoard?.units?.length) {
    throw new Error("Candidate board must contain at least one normalized unit.");
  }

  const historicalBoards = await repository.queryNormalizedBoards({
    setNumber,
    patch,
  });
  const similar = historicalBoards
    .map((entry) => ({
      entry,
      similarity: compareNormalizedBoards(candidateBoard, entry.board, {
        weights,
      }),
    }))
    .filter((row) => row.similarity.score >= minimumSimilarity)
    .sort((a, b) => b.similarity.score - a.similarity.score);

  const placements = similar
    .map((row) => Number(row.entry.placement))
    .filter(
      (placement) =>
        Number.isInteger(placement) && placement >= 1 && placement <= 8,
    );
  const similarBoardCount = similar.length;
  const sampleSize = placements.length;
  const averageSimilarity = similarBoardCount
    ? similar.reduce((sum, row) => sum + row.similarity.score, 0) /
      similarBoardCount
    : 0;
  const patchCounts = new Map();
  const unitCounts = new Map();
  const itemCounts = new Map();

  for (const { entry } of similar) {
    const placement = Number(entry.placement);
    const patchKey = entry.patch || "unknown";
    patchCounts.set(patchKey, (patchCounts.get(patchKey) || 0) + 1);

    for (const unit of entry.board.units || []) {
      increment(unitCounts, `${unit.unitId}@${unit.starLevel ?? "?"}`, placement);
      for (const itemId of unit.itemIds || []) {
        increment(itemCounts, `${unit.unitId}:${itemId}`, placement);
      }
    }
  }

  const confidence = confidenceFor(
    sampleSize,
    minimumSampleSize,
    averageSimilarity,
  );

  return {
    candidateBoardFingerprint: candidateBoard.boardFingerprint,
    candidateContextFingerprint: candidateBoard.contextFingerprint,
    filters: {
      setNumber: setNumber ?? null,
      patch: patch || null,
      minimumSimilarity,
      minimumSampleSize,
    },
    sampleSize,
    similarBoardCount,
    averagePlacement: placements.length
      ? round(placements.reduce((sum, value) => sum + value, 0) / placements.length, 3)
      : null,
    top4Rate: placements.length
      ? round(placements.filter((value) => value <= 4).length / placements.length)
      : null,
    winRate: placements.length
      ? round(placements.filter((value) => value === 1).length / placements.length)
      : null,
    averageSimilarity: round(averageSimilarity),
    confidence,
    patchDistribution: [...patchCounts.entries()]
      .map(([patchName, count]) => ({ patch: patchName, count }))
      .sort((a, b) => b.count - a.count || a.patch.localeCompare(b.patch)),
    commonUnitVariations: commonRows(
      unitCounts,
      similarBoardCount,
      "unitVariant",
    ),
    commonItemVariations: commonRows(
      itemCounts,
      similarBoardCount,
      "itemVariant",
    ),
    similarityExplanations: similar
      .slice(0, 3)
      .map((row) => ({
        matchId: row.entry.matchId,
        participantId: row.entry.participantId,
        score: row.similarity.score,
        explanation: row.similarity.explanation,
      })),
  };
}
