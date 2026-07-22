function groupIncrement(groups, key, field) {
  const label = key === null || key === undefined || key === "" ? "<missing>" : String(key);
  const current = groups.get(label) || { value: label, matches: 0, boards: 0 };
  current[field] += 1;
  groups.set(label, current);
}

function sortedGroups(groups) {
  return [...groups.values()].sort((a, b) =>
    a.value.localeCompare(b.value, undefined, { numeric: true }),
  );
}

function placementSummary(fingerprint, samples) {
  const placements = samples
    .map((sample) => Number(sample.placement))
    .filter((placement) => Number.isInteger(placement) && placement >= 1 && placement <= 8);
  const total = placements.reduce((sum, placement) => sum + placement, 0);
  return {
    fingerprint,
    boardCount: samples.length,
    sampleSize: placements.length,
    averagePlacement: placements.length ? total / placements.length : null,
    top4Rate: placements.length
      ? placements.filter((placement) => placement <= 4).length / placements.length
      : null,
    winRate: placements.length
      ? placements.filter((placement) => placement === 1).length / placements.length
      : null,
  };
}

export const READINESS_THRESHOLDS = Object.freeze({
  insufficient: "fewer than 50 board samples",
  exploratoryOnly: "fewer than 200 samples or fewer than 5 fingerprints repeated at least twice",
  usableWithLowConfidence: "fewer than 500 samples or fewer than 10 fingerprints with 3+ samples",
  usable: "fewer than 2000 samples or fewer than 25 fingerprints with 5+ samples",
  strong: "at least 2000 samples and at least 25 fingerprints with 5+ samples",
});

export function classifyReadiness(totalSamples, frequency) {
  if (totalSamples < 50) return "insufficient";
  if (totalSamples < 200 || frequency.atLeast2 < 5) return "exploratory only";
  if (totalSamples < 500 || frequency.atLeast3 < 10) return "usable with low confidence";
  if (totalSamples < 2000 || frequency.atLeast5 < 25) return "usable";
  return "strong";
}

export function analyzeMatchData(store, { minimumSamples = 3, top = 20 } = {}) {
  if (!store || typeof store !== "object" || Array.isArray(store)) {
    throw new Error("Match repository must contain a JSON object.");
  }
  if (!Array.isArray(store.matches)) {
    throw new Error('Match repository is malformed: expected a "matches" array.');
  }

  const setGroups = new Map();
  const patchGroups = new Map();
  const fingerprints = new Map();
  const contextFingerprints = new Set();
  const placementDistribution = Object.fromEntries(
    Array.from({ length: 8 }, (_, index) => [String(index + 1), 0]),
  );
  const completeness = {
    missingAugments: 0,
    emptyItems: 0,
    missingTraits: 0,
    missingSet: 0,
    missingPatch: 0,
    invalidParticipantCounts: 0,
  };
  let totalBoards = 0;

  for (const match of store.matches) {
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    const matchSet = match?.set ?? match?.setNumber ?? null;
    const matchPatch = match?.patch ?? null;
    groupIncrement(setGroups, matchSet, "matches");
    groupIncrement(patchGroups, matchPatch, "matches");
    if (participants.length !== 8) completeness.invalidParticipantCounts += 1;

    for (const participant of participants) {
      const board = participant?.board;
      if (!board || typeof board !== "object") continue;
      totalBoards += 1;
      const boardSet = board.setNumber ?? matchSet;
      const boardPatch = board.patch ?? matchPatch;
      groupIncrement(setGroups, boardSet, "boards");
      groupIncrement(patchGroups, boardPatch, "boards");
      if (boardSet === null || boardSet === undefined || boardSet === "") completeness.missingSet += 1;
      if (!boardPatch) completeness.missingPatch += 1;
      if (participant.augments === null || participant.augments === undefined) completeness.missingAugments += 1;
      if (!Array.isArray(board.activeTraits) || board.activeTraits.length === 0) completeness.missingTraits += 1;
      for (const unit of Array.isArray(board.units) ? board.units : []) {
        if (!Array.isArray(unit.itemIds) || unit.itemIds.length === 0) completeness.emptyItems += 1;
      }

      const placement = Number(participant.placement);
      if (Number.isInteger(placement) && placement >= 1 && placement <= 8) {
        placementDistribution[String(placement)] += 1;
      }
      if (board.contextFingerprint) contextFingerprints.add(board.contextFingerprint);
      if (board.boardFingerprint) {
        const samples = fingerprints.get(board.boardFingerprint) || [];
        samples.push({ placement: participant.placement });
        fingerprints.set(board.boardFingerprint, samples);
      }
    }
  }

  const summaries = [...fingerprints.entries()].map(([fingerprint, samples]) =>
    placementSummary(fingerprint, samples),
  );
  const frequency = {
    once: summaries.filter((entry) => entry.boardCount === 1).length,
    atLeast2: summaries.filter((entry) => entry.boardCount >= 2).length,
    atLeast3: summaries.filter((entry) => entry.boardCount >= 3).length,
    atLeast5: summaries.filter((entry) => entry.boardCount >= 5).length,
    atLeast10: summaries.filter((entry) => entry.boardCount >= 10).length,
  };
  const commonSort = (a, b) =>
    b.boardCount - a.boardCount || a.fingerprint.localeCompare(b.fingerprint);
  const performanceSort = (a, b) =>
    a.averagePlacement - b.averagePlacement ||
    b.top4Rate - a.top4Rate ||
    b.winRate - a.winRate ||
    b.sampleSize - a.sampleSize ||
    a.fingerprint.localeCompare(b.fingerprint);

  return {
    totalMatches: store.matches.length,
    totalParticipantBoardSamples: totalBoards,
    countsBySet: sortedGroups(setGroups),
    countsByPatch: sortedGroups(patchGroups),
    uniqueBoardFingerprints: fingerprints.size,
    uniqueContextFingerprints: contextFingerprints.size,
    fingerprintFrequency: frequency,
    placementStatistics: summaries
      .filter((entry) => entry.sampleSize >= minimumSamples)
      .sort(commonSort),
    topCommonFingerprints: [...summaries].sort(commonSort).slice(0, top),
    topPerformingFingerprints: summaries
      .filter((entry) => entry.sampleSize >= minimumSamples)
      .sort(performanceSort)
      .slice(0, top),
    completeness,
    placementDistribution,
    readiness: {
      classification: classifyReadiness(totalBoards, frequency),
      thresholds: READINESS_THRESHOLDS,
    },
  };
}
