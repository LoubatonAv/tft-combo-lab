import {
  compareBoardsRelaxed,
  createAnalysisMetadata,
  normalizedTraitBreakpoint,
  RELAXED_SIMILARITY_WEIGHTS,
  selectCarries,
  selectCoreUnits,
} from "./boardSignatures.js";
import path from "node:path";

export const HISTORICAL_EVALUATION_DEFAULTS = Object.freeze({
  minimumSimilarity: 0.65,
  maximumNeighbors: 50,
  minimumNeighbors: 3,
  expectedBoardSize: 8,
  fallbackScanLimit: 500,
  weightingMode: "similarity-squared",
  dominantWeightShare: 0.5,
});

export function calculateNeighborWeight(
  similarity,
  minimumSimilarity,
  mode = HISTORICAL_EVALUATION_DEFAULTS.weightingMode,
) {
  if (similarity < minimumSimilarity) return 0;
  if (mode === "threshold-relative-squared") {
    return ((similarity - minimumSimilarity) / (1 - minimumSimilarity)) ** 2;
  }
  return similarity ** 2;
}

export function resolveMatchRepositoryPath(env, defaultPath) {
  return path.resolve(env?.TFT_MATCH_DATA_PATH || defaultPath);
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function patchDistance(left, right) {
  const parts = (value) => {
    const match = String(value || "").match(/^(\d+)\.(\d+)/);
    return match ? [Number(match[1]), Number(match[2])] : null;
  };
  const a = parts(left);
  const b = parts(right);
  if (!a || !b) return Number.MAX_SAFE_INTEGER;
  return Math.abs((a[0] - b[0]) * 1000 + a[1] - b[1]);
}

function addPosting(map, key, index) {
  if (!key) return;
  const values = map.get(key) || new Set();
  values.add(index);
  map.set(key, values);
}

function containment(query, historical) {
  if (!query.length) return 1;
  const counts = new Map();
  for (const value of historical) counts.set(value, (counts.get(value) || 0) + 1);
  let found = 0;
  for (const value of query) {
    const available = counts.get(value) || 0;
    if (available) {
      found += 1;
      counts.set(value, available - 1);
    }
  }
  return found / query.length;
}

export function compareBoardsForHistoricalEvaluation(candidate, historical, metadata, context = {}) {
  const base = compareBoardsRelaxed(candidate, historical, metadata);
  if (base.score === 0 && Number(candidate?.setNumber) !== Number(historical?.setNumber)) return base;
  const isPartialBoard = context.isPartialBoard === true;
  const hasIncompleteContext = context.hasIncompleteContext === true;
  const candidateCore = selectCoreUnits(candidate, metadata).map((unit) => unit.unitId);
  const historicalCore = selectCoreUnits(historical, metadata).map((unit) => unit.unitId);
  const candidateTraits = (candidate.activeTraits || []).map((trait) => `${trait.traitId}:${normalizedTraitBreakpoint(trait, metadata)}`);
  const historicalTraits = (historical.activeTraits || []).map((trait) => `${trait.traitId}:${normalizedTraitBreakpoint(trait, metadata)}`);
  const candidateCarries = selectCarries(candidate, metadata).map((unit) => unit.unitId);
  const historicalCarries = selectCarries(historical, metadata).map((unit) => unit.unitId);
  const components = { ...base.components };
  if (isPartialBoard) {
    components.unitOverlap = containment((candidate.units || []).map((unit) => unit.unitId), (historical.units || []).map((unit) => unit.unitId));
    components.weightedCoreUnitOverlap = containment(candidateCore, historicalCore);
    components.activeTraitSimilarity = containment(candidateTraits, historicalTraits);
    components.carrySimilarity = containment(candidateCarries, historicalCarries);
  }
  const availableWeights = Object.entries(RELAXED_SIMILARITY_WEIGHTS).filter(([key]) =>
    !hasIncompleteContext || !["carrySimilarity", "completedItemSimilarity", "starLevelSimilarity"].includes(key),
  );
  const weightTotal = availableWeights.reduce((sum, [, weight]) => sum + weight, 0);
  return {
    score: round(availableWeights.reduce((sum, [key, weight]) => sum + components[key] * weight, 0) / weightTotal),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value)])),
  };
}

function unavailable(setNumber, patch, reason) {
  return {
    status: "unavailable",
    set: setNumber ?? null,
    requestedPatch: patch || null,
    reason,
    rawNeighborCount: 0,
    effectiveSampleSize: 0,
    confidence: 0,
    confidenceClassification: "insufficient",
    reliabilityStatus: "insufficient-effective-sample",
    largestNeighborWeightShare: 0,
    dominantNeighbor: false,
    distinctOutcomeCount: 0,
    distinctExactBoardCount: 0,
    selfRecordExcluded: false,
    neighbors: [],
  };
}

function confidenceClassification(value, sufficient) {
  if (!sufficient) return "insufficient";
  if (value < 0.25) return "very low";
  if (value < 0.45) return "low";
  if (value < 0.65) return "medium";
  return "high";
}

export class HistoricalBoardEvaluationService {
  constructor({ repository, loadMetadata }) {
    this.repository = repository;
    this.loadMetadata = loadMetadata;
    this.cachedSignature = null;
    this.cachedIndex = null;
  }

  async buildIndex() {
    const signature = await this.repository.fileSignature();
    if (this.cachedIndex && signature === this.cachedSignature) return this.cachedIndex;
    const source = await this.loadMetadata();
    const metadata = createAnalysisMetadata(source);
    const entries = await this.repository.queryNormalizedBoards();
    const records = [];
    const sets = new Map();
    const participantIndexes = new Map();
    let unresolvedHistoricalUnitCount = 0;

    for (const entry of entries) {
      const board = entry?.board;
      const setNumber = board?.setNumber ?? entry?.setNumber;
      if (!board || !Number.isInteger(Number(setNumber))) continue;
      const participantIndex = participantIndexes.get(entry.matchId) || 0;
      participantIndexes.set(entry.matchId, participantIndex + 1);
      const record = { ...entry, participantIndex, board: { ...board, setNumber: Number(setNumber) } };
      unresolvedHistoricalUnitCount += (record.board.units || []).filter((unit) => !metadata.unitTraits.has(unit.unitId)).length;
      const index = records.push(record) - 1;
      const setIndex = sets.get(Number(setNumber)) || {
        all: new Set(), coreUnits: new Map(), traits: new Map(), carries: new Map(),
      };
      setIndex.all.add(index);
      for (const unit of selectCoreUnits(record.board, metadata)) addPosting(setIndex.coreUnits, unit.unitId, index);
      for (const trait of record.board.activeTraits || []) addPosting(setIndex.traits, trait.traitId, index);
      for (const carry of selectCarries(record.board, metadata)) addPosting(setIndex.carries, carry.unitId, index);
      sets.set(Number(setNumber), setIndex);
    }
    this.cachedSignature = signature;
    this.cachedIndex = { records, sets, metadata, signature, unresolvedHistoricalUnitCount };
    return this.cachedIndex;
  }

  async evaluate(candidateBoard, options = {}) {
    const setNumber = Number(options.setNumber ?? candidateBoard?.setNumber);
    const patch = options.patch ?? candidateBoard?.patch ?? null;
    if (!Number.isInteger(setNumber) || setNumber <= 0) return unavailable(null, patch, "A supported board set is required.");

    let index;
    try {
      index = await this.buildIndex();
    } catch {
      return unavailable(setNumber, patch, "Historical match data is unavailable.");
    }
    const setIndex = index.sets.get(setNumber);
    if (!setIndex) return unavailable(setNumber, patch, "No historical boards are available for this set.");

    const minimumSimilarity = Number(options.minimumSimilarity ?? HISTORICAL_EVALUATION_DEFAULTS.minimumSimilarity);
    const maximumNeighbors = Number(options.maximumNeighbors ?? HISTORICAL_EVALUATION_DEFAULTS.maximumNeighbors);
    const minimumNeighbors = Number(options.minimumNeighbors ?? HISTORICAL_EVALUATION_DEFAULTS.minimumNeighbors);
    const weightingMode = options.weightingMode || HISTORICAL_EVALUATION_DEFAULTS.weightingMode;
    const expectedBoardSize = Math.max(1, Number(options.expectedBoardSize ?? HISTORICAL_EVALUATION_DEFAULTS.expectedBoardSize));
    const actualBoardSize = (candidateBoard.units || []).length;
    const isPartialBoard = actualBoardSize < expectedBoardSize;
    const hasIncompleteContext = options.hasIncompleteContext ??
      (candidateBoard.units || []).some((unit) => !Number.isFinite(Number(unit.starLevel)));
    const unresolvedOptimizerUnitCount = Number(candidateBoard.normalizationDiagnostics?.unresolvedUnitCount || 0);
    const candidateIds = new Set();
    const coreTokens = selectCoreUnits(candidateBoard, index.metadata).map((unit) => unit.unitId);
    const traitTokens = (candidateBoard.activeTraits || []).map((trait) => trait.traitId);
    const carryTokens = selectCarries(candidateBoard, index.metadata).map((unit) => unit.unitId);
    const corePostingIds = new Set();
    const traitPostingIds = new Set();
    const carryPostingIds = new Set();
    for (const token of coreTokens) for (const id of setIndex.coreUnits.get(token) || []) corePostingIds.add(id);
    for (const token of traitTokens) for (const id of setIndex.traits.get(token) || []) traitPostingIds.add(id);
    for (const token of carryTokens) for (const id of setIndex.carries.get(token) || []) carryPostingIds.add(id);
    for (const id of [...corePostingIds, ...traitPostingIds, ...carryPostingIds]) candidateIds.add(id);

    const neighbors = [];
    let selfRecordExcluded = false;
    const scoreRecord = (id) => {
      const record = index.records[id];
      const sameSourceMatch = options.sourceMatchId && record.matchId === options.sourceMatchId;
      const sameSourceParticipant =
        (options.sourceParticipantId && record.participantId === options.sourceParticipantId) ||
        (Number.isInteger(options.sourceParticipantIndex) && record.participantIndex === options.sourceParticipantIndex);
      if (sameSourceMatch && sameSourceParticipant) {
        selfRecordExcluded = true;
        return null;
      }
      const similarity = compareBoardsForHistoricalEvaluation(candidateBoard, record.board, index.metadata, {
        isPartialBoard,
        hasIncompleteContext,
      });
      return { record, similarity };
    };
    const scoredBlocked = [...candidateIds].map(scoreRecord).filter(Boolean);
    for (const { record, similarity } of scoredBlocked) {
      if (similarity.score < minimumSimilarity) continue;
      const weight = calculateNeighborWeight(similarity.score, minimumSimilarity, weightingMode);
      if (!(weight > 0)) continue;
      neighbors.push({ record, similarity, weight });
    }
    let fallbackActivated = false;
    let fallbackScanned = 0;
    if (!neighbors.length) {
      fallbackActivated = true;
      const fallbackLimit = Math.max(0, Number(options.fallbackScanLimit ?? HISTORICAL_EVALUATION_DEFAULTS.fallbackScanLimit));
      for (const id of setIndex.all) {
        if (candidateIds.has(id) || fallbackScanned >= fallbackLimit) continue;
        fallbackScanned += 1;
        const row = scoreRecord(id);
        if (!row || row.similarity.score < minimumSimilarity) continue;
        const weight = calculateNeighborWeight(row.similarity.score, minimumSimilarity, weightingMode);
        if (weight > 0) neighbors.push({ ...row, weight });
      }
    }
    neighbors.sort((a, b) => {
      const aSame = patch && a.record.patch === patch ? 1 : 0;
      const bSame = patch && b.record.patch === patch ? 1 : 0;
      return bSame - aSame || patchDistance(a.record.patch, patch) - patchDistance(b.record.patch, patch) || b.similarity.score - a.similarity.score || String(a.record.board.boardFingerprint).localeCompare(String(b.record.board.boardFingerprint));
    });
    const selected = neighbors.slice(0, maximumNeighbors);
    const valid = selected.filter(({ record }) => Number.isInteger(Number(record.placement)) && Number(record.placement) >= 1 && Number(record.placement) <= 8);
    const sumWeight = valid.reduce((sum, row) => sum + row.weight, 0);
    const sumSquaredWeight = valid.reduce((sum, row) => sum + row.weight ** 2, 0);
    const effectiveSampleSize = sumSquaredWeight ? sumWeight ** 2 / sumSquaredWeight : 0;
    const weighted = (selector) => sumWeight ? valid.reduce((sum, row) => sum + selector(Number(row.record.placement)) * row.weight, 0) / sumWeight : null;
    for (const row of selected) row.normalizedWeight = sumWeight && valid.includes(row) ? row.weight / sumWeight : 0;
    const largestNeighborWeightShare = selected.length ? Math.max(...selected.map((row) => row.normalizedWeight)) : 0;
    const dominantNeighbor = largestNeighborWeightShare > HISTORICAL_EVALUATION_DEFAULTS.dominantWeightShare;
    const weightedAveragePlacement = weighted((placement) => placement);
    const weightedPlacementStandardDeviation = sumWeight
      ? Math.sqrt(valid.reduce((sum, row) => sum + row.weight * (Number(row.record.placement) - weightedAveragePlacement) ** 2, 0) / sumWeight)
      : null;
    const distinctOutcomeCount = new Set(valid.map((row) => Number(row.record.placement))).size;
    const distinctExactBoardCount = new Set(selected.map((row) => row.record.board.boardFingerprint).filter(Boolean)).size;
    const averageSimilarity = selected.length ? selected.reduce((sum, row) => sum + row.similarity.score, 0) / selected.length : 0;
    const maximumSimilarity = selected[0] ? Math.max(...selected.map((row) => row.similarity.score)) : 0;
    const patchCounts = new Map();
    for (const row of selected) patchCounts.set(row.record.patch || "unknown", (patchCounts.get(row.record.patch || "unknown") || 0) + 1);
    const patchesRepresented = [...patchCounts.entries()].map(([patchName, count]) => ({ patch: patchName, count })).sort((a, b) => b.count - a.count || a.patch.localeCompare(b.patch));
    const patchConcentration = selected.length ? (patch ? (patchCounts.get(patch) || 0) : patchesRepresented[0]?.count || 0) / selected.length : 0;
    const averageUnitOverlap = selected.length ? selected.reduce((sum, row) => sum + row.similarity.components.unitOverlap, 0) / selected.length : 0;
    const averageCoreOverlap = selected.length ? selected.reduce((sum, row) => sum + row.similarity.components.weightedCoreUnitOverlap, 0) / selected.length : 0;
    let confidence = Math.min(1, effectiveSampleSize / 10) * 0.3 + Math.min(1, selected.length / 20) * 0.15 + averageSimilarity * 0.2 + maximumSimilarity * 0.1 + patchConcentration * 0.1 + (isPartialBoard ? 0.5 : 1) * 0.15;
    if (isPartialBoard) confidence = Math.min(confidence * 0.75, 0.64);
    if (hasIncompleteContext) confidence = Math.min(confidence * 0.85, 0.64);
    if (averageUnitOverlap < 0.35 || averageCoreOverlap < 0.25) confidence = Math.min(confidence, 0.64);
    if (effectiveSampleSize < 2) confidence = Math.min(confidence, 0.24);
    else if (effectiveSampleSize < 3) confidence = Math.min(confidence, 0.44);
    else if (effectiveSampleSize < 5) confidence = Math.min(confidence, 0.64);
    if (dominantNeighbor) confidence = Math.min(confidence, 0.44);
    if (distinctOutcomeCount < 3) confidence = Math.min(confidence, 0.64);
    confidence = Math.max(0, Math.min(1, confidence));
    const sufficient = selected.length >= minimumNeighbors;
    const reliabilityStatus = effectiveSampleSize < 2
      ? "insufficient-effective-sample"
      : dominantNeighbor
        ? "neighbor-dominated"
        : distinctOutcomeCount < 3
          ? "low-dispersion-confidence"
          : "reliable";
    const distribution = { "0.90-1.00": 0, "0.80-0.90": 0, "0.70-0.80": 0, "0.65-0.70": 0 };
    for (const row of selected) {
      if (row.similarity.score >= 0.9) distribution["0.90-1.00"] += 1;
      else if (row.similarity.score >= 0.8) distribution["0.80-0.90"] += 1;
      else if (row.similarity.score >= 0.7) distribution["0.70-0.80"] += 1;
      else distribution["0.65-0.70"] += 1;
    }
    const result = {
      status: sufficient ? "available" : "insufficient",
      set: setNumber,
      requestedPatch: patch,
      rawNeighborCount: selected.length,
      effectiveSampleSize: round(effectiveSampleSize, 2),
      weightingMode,
      weightedAveragePlacement: round(weightedAveragePlacement, 3),
      weightedPlacementStandardDeviation: round(weightedPlacementStandardDeviation, 3),
      weightedTop4Rate: round(weighted((placement) => placement <= 4 ? 1 : 0)),
      weightedWinRate: round(weighted((placement) => placement === 1 ? 1 : 0)),
      unweightedAveragePlacement: valid.length ? round(valid.reduce((sum, row) => sum + Number(row.record.placement), 0) / valid.length, 3) : null,
      unweightedTop4Rate: valid.length ? round(valid.filter((row) => Number(row.record.placement) <= 4).length / valid.length) : null,
      unweightedWinRate: valid.length ? round(valid.filter((row) => Number(row.record.placement) === 1).length / valid.length) : null,
      averageSimilarity: round(averageSimilarity),
      maximumSimilarity: round(maximumSimilarity),
      similarityDistribution: distribution,
      confidence: round(confidence),
      confidenceClassification: confidenceClassification(confidence, sufficient),
      reliabilityStatus,
      largestNeighborWeightShare: round(largestNeighborWeightShare),
      dominantNeighbor,
      distinctOutcomeCount,
      distinctExactBoardCount,
      selfRecordExcluded,
      isPartialBoard,
      hasIncompleteContext,
      expectedBoardSize,
      actualBoardSize,
      resolvedUnitCount: actualBoardSize,
      unresolvedUnitCount: unresolvedOptimizerUnitCount,
      patchesRepresented,
      neighbors: options.debugNeighbors ? selected.map(({ record, similarity, weight, normalizedWeight }) => ({ similarity: similarity.score, rawWeight: round(weight), normalizedWeight: round(normalizedWeight), placement: record.placement, patch: record.patch, representativeUnits: (record.board.units || []).map((unit) => unit.unitId), representativeTraits: (record.board.activeTraits || []).map((trait) => trait.traitId), components: similarity.components })) : [],
    };
    if (options.debugDiagnostics) {
      const bruteForce = [...setIndex.all].map(scoreRecord).filter(Boolean).sort((a, b) => b.similarity.score - a.similarity.score);
      const indexedQualifying = scoredBlocked.filter((row) => row.similarity.score >= minimumSimilarity).map((row) => row.similarity.score).sort((a, b) => b - a);
      const bruteQualifying = bruteForce.filter((row) => row.similarity.score >= minimumSimilarity).map((row) => row.similarity.score).sort((a, b) => b - a);
      const allScored = bruteForce;
      result.diagnostics = {
        sameSetHistoricalBoardCount: setIndex.all.size,
        unresolvedOptimizerChampionIds: unresolvedOptimizerUnitCount,
        unresolvedHistoricalChampionIds: index.unresolvedHistoricalUnitCount,
        blockingTokenCounts: { core: coreTokens.length, traits: traitTokens.length, carries: carryTokens.length },
        candidatesFromCorePostings: corePostingIds.size,
        candidatesFromTraitPostings: traitPostingIds.size,
        candidatesFromCarryPostings: carryPostingIds.size,
        uniqueBlockedCandidateCount: candidateIds.size,
        fallbackActivated,
        fallbackScanned,
        similarityCounts: {
          atLeast050: allScored.filter((row) => row.similarity.score >= 0.5).length,
          atLeast060: allScored.filter((row) => row.similarity.score >= 0.6).length,
          atLeast065: allScored.filter((row) => row.similarity.score >= 0.65).length,
          atLeast070: allScored.filter((row) => row.similarity.score >= 0.7).length,
        },
        highestSimilarityBeforeThreshold: round(allScored[0]?.similarity.score || 0),
        topSimilarityComponents: allScored[0]?.similarity.components || null,
        indexedQualifyingCount: indexedQualifying.length,
        bruteForceQualifyingCount: bruteQualifying.length,
        indexedBruteForceHighestAgreement: round(indexedQualifying[0] || 0) === round(bruteQualifying[0] || 0),
        representationComparison: {
          candidate: {
            setNumber,
            patch,
            rawOptimizerUnitIds: candidateBoard.normalizationDiagnostics?.rawOptimizerUnitIds || [],
            normalizedUnitIds: (candidateBoard.units || []).map((unit) => unit.unitId),
            resolvedCatalogUnitIds: candidateBoard.normalizationDiagnostics?.resolvedCatalogUnitIds || [],
            starLevels: (candidateBoard.units || []).map((unit) => unit.starLevel),
            itemIds: (candidateBoard.units || []).map((unit) => unit.itemIds),
            activeTraits: (candidateBoard.activeTraits || []).map((trait) => ({
              traitId: trait.traitId,
              activeTier: trait.activeTier,
              normalizedBreakpoint: normalizedTraitBreakpoint(trait, index.metadata),
            })),
            carries: carryTokens,
            cores: coreTokens,
            blockingTokens: { core: coreTokens, traits: traitTokens, carries: carryTokens },
            isPartialBoard,
            hasIncompleteContext,
            expectedBoardSize,
            actualBoardSize,
          },
          nearestHistoricalBoard: bruteForce[0] ? {
            unitIds: (bruteForce[0].record.board.units || []).map((unit) => unit.unitId),
            starLevels: (bruteForce[0].record.board.units || []).map((unit) => unit.starLevel),
            itemIds: (bruteForce[0].record.board.units || []).map((unit) => unit.itemIds),
            activeTraits: (bruteForce[0].record.board.activeTraits || []).map((trait) => ({
              traitId: trait.traitId,
              activeTier: trait.activeTier,
              normalizedBreakpoint: normalizedTraitBreakpoint(trait, index.metadata),
            })),
            carries: selectCarries(bruteForce[0].record.board, index.metadata).map((unit) => unit.unitId),
            cores: selectCoreUnits(bruteForce[0].record.board, index.metadata).map((unit) => unit.unitId),
            similarity: bruteForce[0].similarity.score,
            components: bruteForce[0].similarity.components,
          } : null,
        },
      };
    }
    return result;
  }
}
