export const DEFAULT_SIMILARITY_WEIGHTS = Object.freeze({
  sharedUnits: 0.42,
  unitSetSimilarity: 0.13,
  starLevels: 0.1,
  sharedTraits: 0.12,
  traitTiers: 0.06,
  sharedItems: 0.12,
  boardSize: 0.05,
});

function ratio(shared, total) {
  return total > 0 ? shared / total : 1;
}

function jaccard(left, right) {
  const union = new Set([...left, ...right]);
  if (!union.size) return null;
  const shared = [...left].filter((value) => right.has(value)).length;
  return shared / union.size;
}

function unitMap(board) {
  return new Map((board?.units || []).map((unit) => [unit.unitId, unit]));
}

function traitMap(board) {
  return new Map(
    (board?.activeTraits || []).map((trait) => [trait.traitId, trait]),
  );
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function compareNormalizedBoards(left, right, options = {}) {
  const weights = {
    ...DEFAULT_SIMILARITY_WEIGHTS,
    ...(options.weights || {}),
  };
  const leftUnits = unitMap(left);
  const rightUnits = unitMap(right);
  const leftUnitIds = new Set(leftUnits.keys());
  const rightUnitIds = new Set(rightUnits.keys());
  const sharedUnitIds = [...leftUnitIds].filter((id) => rightUnitIds.has(id));
  const missingUnitIds = [...leftUnitIds].filter((id) => !rightUnitIds.has(id));
  const additionalUnitIds = [...rightUnitIds].filter(
    (id) => !leftUnitIds.has(id),
  );
  const maxBoardUnits = Math.max(leftUnitIds.size, rightUnitIds.size, 1);

  const leftTraits = traitMap(left);
  const rightTraits = traitMap(right);
  const leftTraitIds = new Set(leftTraits.keys());
  const rightTraitIds = new Set(rightTraits.keys());
  const sharedTraitIds = [...leftTraitIds].filter((id) =>
    rightTraitIds.has(id),
  );

  const starLevels = sharedUnitIds.length
    ? sharedUnitIds.reduce((sum, id) => {
        const a = leftUnits.get(id).starLevel;
        const b = rightUnits.get(id).starLevel;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return sum + 0.5;
        return sum + Math.max(0, 1 - Math.abs(a - b) / 2);
      }, 0) / sharedUnitIds.length
    : 0;

  const itemComparableUnits = sharedUnitIds.filter((id) => {
    const a = leftUnits.get(id).itemIds || [];
    const b = rightUnits.get(id).itemIds || [];
    return a.length > 0 || b.length > 0;
  });
  const sharedItems = itemComparableUnits.length
    ? itemComparableUnits.reduce((sum, id) => {
        const a = new Set(leftUnits.get(id).itemIds || []);
        const b = new Set(rightUnits.get(id).itemIds || []);
        return sum + jaccard(a, b);
      }, 0) / itemComparableUnits.length
    : null;

  const traitTiers = sharedTraitIds.length
    ? sharedTraitIds.reduce((sum, id) => {
        const a = leftTraits.get(id).activeTier;
        const b = rightTraits.get(id).activeTier;
        if (!Number.isFinite(a) || !Number.isFinite(b)) return sum + 0.5;
        return sum + Math.max(0, 1 - Math.abs(a - b) / Math.max(a, b, 1));
      }, 0) / sharedTraitIds.length
    : leftTraitIds.size || rightTraitIds.size
      ? 0
      : null;

  const components = {
    sharedUnits: ratio(sharedUnitIds.length, maxBoardUnits),
    unitSetSimilarity: jaccard(leftUnitIds, rightUnitIds),
    starLevels,
    sharedTraits: jaccard(leftTraitIds, rightTraitIds),
    traitTiers,
    sharedItems,
    boardSize: Math.max(
      0,
      1 -
        Math.abs(Number(left?.boardSize || 0) - Number(right?.boardSize || 0)) /
          Math.max(Number(left?.boardSize || 0), Number(right?.boardSize || 0), 1),
    ),
  };

  let weightedTotal = 0;
  let appliedWeight = 0;

  for (const [name, value] of Object.entries(components)) {
    if (!Number.isFinite(value)) continue;
    const weight = Math.max(0, Number(weights[name] || 0));
    weightedTotal += value * weight;
    appliedWeight += weight;
  }

  const score = appliedWeight ? weightedTotal / appliedWeight : 0;
  const explanations = [
    `${sharedUnitIds.length}/${maxBoardUnits} units overlap.`,
    missingUnitIds.length
      ? `Missing from historical board: ${missingUnitIds.join(", ")}.`
      : "No candidate units are missing from the historical board.",
    additionalUnitIds.length
      ? `Historical board adds: ${additionalUnitIds.join(", ")}.`
      : "Historical board adds no different units.",
    `${sharedTraitIds.length} active traits overlap.`,
    itemComparableUnits.length
      ? `Item similarity was compared on ${itemComparableUnits.length} shared unit(s).`
      : "No item-bearing shared units were available for item comparison.",
  ];

  return {
    score: round(score),
    components: Object.fromEntries(
      Object.entries(components).map(([name, value]) => [
        name,
        Number.isFinite(value) ? round(value) : null,
      ]),
    ),
    sharedUnitIds,
    missingUnitIds,
    additionalUnitIds,
    sharedTraitIds,
    explanation: explanations.join(" "),
  };
}
