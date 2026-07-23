import {
  classifyBoardItem,
  compareBoardsRelaxed,
  createBoardSignatures,
  selectCarries,
  selectCoreUnits,
} from "./boardSignatures.js";

function patchParts(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

export function comparePatches(left, right) {
  const a = patchParts(left);
  const b = patchParts(right);
  if (!a || !b) return null;
  return a[0] - b[0] || a[1] - b[1];
}

function matchesFilters(match, filters) {
  const setNumber = match?.set ?? match?.setNumber;
  if (filters.setNumber !== undefined && Number(setNumber) !== Number(filters.setNumber)) return false;
  if (filters.patch && String(match?.patch) !== String(filters.patch)) return false;
  if (filters.patchMin && (comparePatches(match?.patch, filters.patchMin) ?? -1) < 0) return false;
  if (filters.patchMax && (comparePatches(match?.patch, filters.patchMax) ?? 1) > 0) return false;
  return true;
}

function groupIncrement(groups, key, field) {
  const label = key === null || key === undefined || key === "" ? "<missing>" : String(key);
  const current = groups.get(label) || { value: label, matches: 0, boards: 0 };
  current[field] += 1;
  groups.set(label, current);
}

function sortedGroups(groups) {
  return [...groups.values()].sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
}

function rates(placements) {
  const valid = placements.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 8);
  return {
    sampleSize: valid.length,
    averagePlacement: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null,
    top4Rate: valid.length ? valid.filter((value) => value <= 4).length / valid.length : null,
    winRate: valid.length ? valid.filter((value) => value === 1).length / valid.length : null,
  };
}

function summarizeSignatureGroups(groups, top) {
  const summaries = [...groups.values()].map((samples) => {
    const representative = samples[0].board;
    return {
      signature: samples[0].groupSignature,
      boardCount: samples.length,
      ...rates(samples.map((sample) => sample.placement)),
      patches: [...new Set(samples.map((sample) => sample.patch).filter(Boolean))].sort((a, b) => comparePatches(a, b) || 0),
      representativeUnitIds: (representative.units || []).map((unit) => unit.unitId).sort(),
      representativeActiveTraits: (representative.activeTraits || []).map((trait) => `${trait.traitId}:${trait.activeTier}`).sort(),
      representativeCarries: selectCarries(representative, samples[0].metadata).map((unit) => ({ unitId: unit.unitId, itemIds: unit.completedItemIds })),
    };
  });
  summaries.sort((a, b) => b.boardCount - a.boardCount || a.signature.localeCompare(b.signature));
  return {
    uniqueCount: summaries.length,
    once: summaries.filter((entry) => entry.boardCount === 1).length,
    atLeast2: summaries.filter((entry) => entry.boardCount >= 2).length,
    atLeast3: summaries.filter((entry) => entry.boardCount >= 3).length,
    atLeast5: summaries.filter((entry) => entry.boardCount >= 5).length,
    atLeast10: summaries.filter((entry) => entry.boardCount >= 10).length,
    largestGroupSize: summaries[0]?.boardCount || 0,
    topGroups: summaries.slice(0, top),
    allGroups: summaries,
  };
}

export const READINESS_THRESHOLDS = Object.freeze({
  exact: "insufficient <50 boards; exploratory <200 or <5 repeated groups; low confidence <500 or <10 groups of 3+; usable <2000 or <25 groups of 5+; otherwise strong",
  relaxed: "insufficient <50 boards; exploratory <200 or <10 repeated unit/core/carry groups; low confidence <500 or <10 groups of 3+; usable <2000 or <25 groups of 5+; otherwise strong",
  nearestNeighbor: "insufficient <50 boards; exploratory when <25 diagnostics or <25% neighbors score >=0.70; low confidence when <50% score >=0.70; usable when <75% score >=0.70; otherwise strong",
});

function groupReadiness(total, stats, repeatedMinimum = 5) {
  if (total < 50) return "insufficient";
  if (total < 200 || stats.atLeast2 < repeatedMinimum) return "exploratory only";
  if (total < 500 || stats.atLeast3 < 10) return "usable with low confidence";
  if (total < 2000 || stats.atLeast5 < 25) return "usable";
  return "strong";
}

export function classifyReadiness(total, stats) {
  return groupReadiness(total, stats);
}

function nearestReadiness(total, diagnostics) {
  if (total < 50) return "insufficient";
  const coverage = diagnostics.length ? diagnostics.filter((entry) => entry.similarity >= 0.7).length / diagnostics.length : 0;
  if (diagnostics.length < 25 || coverage < 0.25) return "exploratory only";
  if (coverage < 0.5) return "usable with low confidence";
  if (coverage < 0.75) return "usable";
  return "strong";
}

function similarityDiagnostics(samples, metadata) {
  const ordered = [...samples].sort((a, b) => String(a.signature).localeCompare(String(b.signature)));
  const chosen = ordered.slice(0, 25);
  return chosen.map((sample) => {
    const core = new Set(sample.coreUnits);
    let candidates = ordered.filter((candidate) => candidate !== sample && candidate.board.setNumber === sample.board.setNumber && (
      candidate.coreUnits.some((unit) => core.has(unit)) || candidate.traits.some((trait) => sample.traits.includes(trait))
    ));
    if (!candidates.length) candidates = ordered.filter((candidate) => candidate !== sample && candidate.board.setNumber === sample.board.setNumber).slice(0, 200);
    let best = null;
    for (const candidate of candidates) {
      const comparison = compareBoardsRelaxed(sample.board, candidate.board, metadata);
      if (!best || comparison.score > best.similarity || (comparison.score === best.similarity && candidate.signature < best.neighborSignature)) {
        best = {
          boardSignature: sample.signature,
          neighborSignature: candidate.signature,
          similarity: comparison.score,
          components: comparison.components,
          samePlacement: Number(sample.placement) === Number(candidate.placement),
          patchRelationship: sample.patch === candidate.patch ? "same patch" : "cross-patch",
        };
      }
    }
    return best;
  }).filter(Boolean);
}

function similarityBuckets(diagnostics) {
  const buckets = { "0.90-1.00": 0, "0.80-0.90": 0, "0.70-0.80": 0, "0.60-0.70": 0, "below 0.60": 0 };
  for (const entry of diagnostics) {
    const score = entry.similarity;
    if (score >= 0.9) buckets["0.90-1.00"] += 1;
    else if (score >= 0.8) buckets["0.80-0.90"] += 1;
    else if (score >= 0.7) buckets["0.70-0.80"] += 1;
    else if (score >= 0.6) buckets["0.60-0.70"] += 1;
    else buckets["below 0.60"] += 1;
  }
  return buckets;
}

export function analyzeMatchData(store, options = {}) {
  if (!store || typeof store !== "object" || Array.isArray(store)) throw new Error("Match repository must contain a JSON object.");
  if (!Array.isArray(store.matches)) throw new Error('Match repository is malformed: expected a "matches" array.');
  const { minimumSamples = 3, top = 20, metadata = {}, similarityDiagnostics: diagnosticsEnabled = false } = options;
  const matches = store.matches.filter((match) => matchesFilters(match, options));
  const setGroups = new Map();
  const patchGroups = new Map();
  const signatureMaps = Object.fromEntries(["exact", "unit", "core", "trait", "carry"].map((name) => [name, new Map()]));
  const placementDistribution = Object.fromEntries(Array.from({ length: 8 }, (_, index) => [String(index + 1), 0]));
  const completeness = { missingAugments: 0, unitsWithNoItems: 0, missingItemArrays: 0, invalidItemIds: 0, unknownItemIds: 0, componentItems: 0, completedItems: 0, missingTraits: 0, missingSet: 0, missingPatch: 0, invalidParticipantCounts: 0 };
  const boardSamples = [];

  for (const match of matches) {
    const participants = Array.isArray(match?.participants) ? match.participants : [];
    const matchSet = match?.set ?? match?.setNumber ?? null;
    const matchPatch = match?.patch ?? null;
    groupIncrement(setGroups, matchSet, "matches");
    groupIncrement(patchGroups, matchPatch, "matches");
    if (participants.length !== 8) completeness.invalidParticipantCounts += 1;
    for (const participant of participants) {
      const board = participant?.board;
      if (!board || typeof board !== "object") continue;
      const contextualBoard = { ...board, setNumber: board.setNumber ?? matchSet, patch: board.patch ?? matchPatch };
      groupIncrement(setGroups, contextualBoard.setNumber, "boards");
      groupIncrement(patchGroups, contextualBoard.patch, "boards");
      if (contextualBoard.setNumber == null) completeness.missingSet += 1;
      if (!contextualBoard.patch) completeness.missingPatch += 1;
      if (participant.augments == null) completeness.missingAugments += 1;
      if (!Array.isArray(contextualBoard.activeTraits) || !contextualBoard.activeTraits.length) completeness.missingTraits += 1;
      for (const unit of Array.isArray(contextualBoard.units) ? contextualBoard.units : []) {
        if (!Array.isArray(unit.itemIds)) completeness.missingItemArrays += 1;
        else if (!unit.itemIds.length) completeness.unitsWithNoItems += 1;
        for (const itemId of Array.isArray(unit.itemIds) ? unit.itemIds : []) {
          const type = classifyBoardItem(itemId, metadata);
          if (type === "completed") completeness.completedItems += 1;
          else if (type === "component") completeness.componentItems += 1;
          else if (type === "invalid") completeness.invalidItemIds += 1;
          else completeness.unknownItemIds += 1;
        }
      }
      const placement = Number(participant.placement);
      if (Number.isInteger(placement) && placement >= 1 && placement <= 8) placementDistribution[String(placement)] += 1;
      const signatures = createBoardSignatures(contextualBoard, metadata);
      const coreUnits = selectCoreUnits(contextualBoard, metadata).map((unit) => unit.unitId);
      const traits = (contextualBoard.activeTraits || []).map((trait) => trait.traitId);
      const sample = { board: contextualBoard, placement: participant.placement, patch: contextualBoard.patch, metadata, signature: signatures.exact, coreUnits, traits };
      boardSamples.push(sample);
      for (const [type, signature] of Object.entries(signatures)) {
        if (!signature) continue;
        const groupingKey = `${contextualBoard.setNumber ?? "<missing>"}:${signature}`;
        const values = signatureMaps[type].get(groupingKey) || [];
        values.push({ ...sample, groupSignature: signature });
        signatureMaps[type].set(groupingKey, values);
      }
    }
  }

  const signatureStatistics = Object.fromEntries(Object.entries(signatureMaps).map(([type, groups]) => [type, summarizeSignatureGroups(groups, top)]));
  const exactGroups = signatureStatistics.exact;
  const diagnostics = diagnosticsEnabled ? similarityDiagnostics(boardSamples, metadata) : [];
  const repeatedRelaxed = {
    atLeast2: Math.max(signatureStatistics.unit.atLeast2, signatureStatistics.core.atLeast2, signatureStatistics.carry.atLeast2),
    atLeast3: Math.max(signatureStatistics.unit.atLeast3, signatureStatistics.core.atLeast3, signatureStatistics.carry.atLeast3),
    atLeast5: Math.max(signatureStatistics.unit.atLeast5, signatureStatistics.core.atLeast5, signatureStatistics.carry.atLeast5),
  };
  const sets = [...new Set(matches.map((match) => match?.set ?? match?.setNumber).filter((value) => value != null))];
  const publicSignatureStatistics = Object.fromEntries(
    Object.entries(signatureStatistics).map(([type, stats]) => {
      const { allGroups, ...publicStats } = stats;
      return [type, publicStats];
    }),
  );
  return {
    totalMatches: matches.length,
    totalParticipantBoardSamples: boardSamples.length,
    countsBySet: sortedGroups(setGroups),
    countsByPatch: sortedGroups(patchGroups),
    warnings: sets.length > 1 ? [`Multiple sets are present (${sets.sort((a, b) => Number(a) - Number(b)).join(", ")}); signatures remain set-separated.`] : [],
    signatureStatistics: publicSignatureStatistics,
    uniqueBoardFingerprints: exactGroups.uniqueCount,
    uniqueContextFingerprints: new Set(boardSamples.map((sample) => sample.board.contextFingerprint).filter(Boolean)).size,
    fingerprintFrequency: { once: exactGroups.once, atLeast2: exactGroups.atLeast2, atLeast3: exactGroups.atLeast3, atLeast5: exactGroups.atLeast5, atLeast10: exactGroups.atLeast10 },
    placementStatistics: exactGroups.allGroups.filter((entry) => entry.sampleSize >= minimumSamples),
    topCommonFingerprints: exactGroups.topGroups,
    topPerformingFingerprints: exactGroups.allGroups.filter((entry) => entry.sampleSize >= minimumSamples).sort((a, b) => a.averagePlacement - b.averagePlacement || a.signature.localeCompare(b.signature)).slice(0, top),
    completeness,
    placementDistribution,
    similarityDiagnostics: diagnostics,
    similarityDistribution: similarityBuckets(diagnostics),
    readiness: {
      exactSignatures: groupReadiness(boardSamples.length, exactGroups),
      relaxedSignatures: groupReadiness(boardSamples.length, repeatedRelaxed, 10),
      nearestNeighbor: nearestReadiness(boardSamples.length, diagnostics),
      thresholds: READINESS_THRESHOLDS,
    },
  };
}
