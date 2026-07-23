import { createHash } from "node:crypto";
import { canonicalizeIdentifier } from "./boardNormalizer.js";

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function compactItemId(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\.png.*$/, "")
    .replace(/^.*\//, "")
    .replace(/^tft_item_/, "")
    .replace(/[^a-z0-9]/g, "");
}

export function createAnalysisMetadata({ itemCatalog = {}, champions = [], traits = [] } = {}) {
  const completedItems = new Set();
  const componentItems = new Set();
  for (const [name, item] of Object.entries(itemCatalog || {})) {
    if (item?.iconUrl) completedItems.add(compactItemId(item.iconUrl));
    completedItems.add(compactItemId(name));
    for (const component of Array.isArray(item?.components) ? item.components : []) {
      if (!/item$/i.test(component)) componentItems.add(compactItemId(component));
    }
  }
  const traitAliases = new Map();
  for (const trait of traits) {
    const apiName = canonicalizeIdentifier(trait.apiName || trait.name);
    for (const alias of [trait.name, trait.apiName]) {
      const key = canonicalizeIdentifier(alias);
      if (key && apiName) traitAliases.set(key, apiName);
    }
  }
  const unitTraits = new Map();
  for (const champion of champions) {
    const unitId = canonicalizeIdentifier(champion.apiName || champion.characterName || champion.id);
    if (!unitId) continue;
    unitTraits.set(
      unitId,
      new Set((champion.traits || []).map((trait) => traitAliases.get(canonicalizeIdentifier(trait)) || canonicalizeIdentifier(trait)).filter(Boolean)),
    );
  }
  return { completedItems, componentItems, unitTraits };
}

export function classifyBoardItem(itemId, metadata = {}) {
  if (!itemId || typeof itemId !== "string") return "invalid";
  const compact = compactItemId(itemId);
  if (metadata.componentItems?.has(compact)) return "component";
  if (metadata.completedItems?.has(compact)) return "completed";
  return "unknown";
}

export function completedItemsForUnit(unit, metadata) {
  return (Array.isArray(unit?.itemIds) ? unit.itemIds : [])
    .filter((itemId) => classifyBoardItem(itemId, metadata) === "completed")
    .sort();
}

export function selectCarries(board, metadata) {
  return (board?.units || [])
    .map((unit) => ({ ...unit, completedItemIds: completedItemsForUnit(unit, metadata) }))
    .filter((unit) => unit.completedItemIds.length > 0)
    .sort(
      (a, b) =>
        b.completedItemIds.length - a.completedItemIds.length ||
        Number(b.cost || 0) - Number(a.cost || 0) ||
        Number(b.starLevel || 0) - Number(a.starLevel || 0) ||
        a.unitId.localeCompare(b.unitId),
    )
    .slice(0, 2);
}

// Core selection is order-independent: retain every 4/5-cost, 3-star, or
// 2+-completed-item unit; then add the strongest catalog-known contributor
// for each major active trait not represented. If nothing qualifies, retain
// the two strongest units by completed items, cost, stars, then unit ID.
export function selectCoreUnits(board, metadata) {
  const units = board?.units || [];
  const selected = new Map();
  for (const unit of units) {
    const completed = completedItemsForUnit(unit, metadata).length;
    if (Number(unit.cost) >= 4 || completed >= 2 || Number(unit.starLevel) >= 3) {
      selected.set(unit.unitId, unit);
    }
  }
  const majorTraits = new Set(
    (board?.activeTraits || [])
      .filter((trait) => Number(trait.activeTier) >= 2 || Number(trait.unitCount) >= 4)
      .map((trait) => trait.traitId),
  );
  for (const traitId of [...majorTraits].sort()) {
    if ([...selected.values()].some((unit) => metadata.unitTraits?.get(unit.unitId)?.has(traitId))) continue;
    const contributor = units
      .filter((unit) => metadata.unitTraits?.get(unit.unitId)?.has(traitId))
      .sort((a, b) => Number(b.cost || 0) - Number(a.cost || 0) || Number(b.starLevel || 0) - Number(a.starLevel || 0) || a.unitId.localeCompare(b.unitId))[0];
    if (contributor) selected.set(contributor.unitId, contributor);
  }
  if (!selected.size) {
    for (const unit of [...units]
      .sort(
        (a, b) =>
          completedItemsForUnit(b, metadata).length - completedItemsForUnit(a, metadata).length ||
          Number(b.cost || 0) - Number(a.cost || 0) ||
          Number(b.starLevel || 0) - Number(a.starLevel || 0) ||
          a.unitId.localeCompare(b.unitId),
      )
      .slice(0, 2)) {
      selected.set(unit.unitId, unit);
    }
  }
  return [...selected.values()].sort((a, b) => a.unitId.localeCompare(b.unitId));
}

export function createBoardSignatures(board, metadata = {}) {
  const setNumber = board?.setNumber ?? null;
  const units = (board?.units || []).map((unit) => unit.unitId).sort();
  const core = selectCoreUnits(board, metadata).map((unit) => unit.unitId);
  const traits = (board?.activeTraits || [])
    .filter((trait) => Number(trait.activeTier) > 0)
    .map((trait) => [trait.traitId, Number(trait.activeTier) || null])
    .sort((a, b) => a[0].localeCompare(b[0]) || Number(a[1]) - Number(b[1]));
  const carries = selectCarries(board, metadata).map((unit) => [unit.unitId, unit.completedItemIds]);
  return {
    exact: board?.boardFingerprint || null,
    unit: hash({ setNumber, units }),
    core: hash({ setNumber, units: core }),
    trait: hash({ setNumber, traits }),
    carry: hash({ setNumber, carries }),
  };
}

function multisetJaccard(left, right) {
  const counts = (values) => values.reduce((map, value) => map.set(value, (map.get(value) || 0) + 1), new Map());
  const a = counts(left);
  const b = counts(right);
  const keys = new Set([...a.keys(), ...b.keys()]);
  if (!keys.size) return 1;
  let intersection = 0;
  let union = 0;
  for (const key of keys) {
    intersection += Math.min(a.get(key) || 0, b.get(key) || 0);
    union += Math.max(a.get(key) || 0, b.get(key) || 0);
  }
  return intersection / union;
}

export const RELAXED_SIMILARITY_WEIGHTS = Object.freeze({
  unitOverlap: 0.3,
  weightedCoreUnitOverlap: 0.25,
  activeTraitSimilarity: 0.2,
  carrySimilarity: 0.13,
  completedItemSimilarity: 0.1,
  starLevelSimilarity: 0.02,
});

export function compareBoardsRelaxed(left, right, metadata = {}) {
  const zero = { unitOverlap: 0, weightedCoreUnitOverlap: 0, activeTraitSimilarity: 0, carrySimilarity: 0, completedItemSimilarity: 0, starLevelSimilarity: 0 };
  if (Number(left?.setNumber) !== Number(right?.setNumber)) return { score: 0, components: zero };
  const leftUnits = left?.units || [];
  const rightUnits = right?.units || [];
  const unitOverlap = multisetJaccard(leftUnits.map((unit) => unit.unitId), rightUnits.map((unit) => unit.unitId));
  const weighted = (board) => selectCoreUnits(board, metadata).flatMap((unit) => Array(Math.max(1, Number(unit.cost) || 1)).fill(unit.unitId));
  const weightedCoreUnitOverlap = multisetJaccard(weighted(left), weighted(right));
  const traitTokens = (board) => (board?.activeTraits || []).map((trait) => `${trait.traitId}:${Number(trait.activeTier) || 0}`);
  const activeTraitSimilarity = multisetJaccard(traitTokens(left), traitTokens(right));
  const carries = (board) => selectCarries(board, metadata).map((unit) => unit.unitId);
  const carrySimilarity = multisetJaccard(carries(left), carries(right));
  const items = (board) => (board?.units || []).flatMap((unit) => completedItemsForUnit(unit, metadata));
  const completedItemSimilarity = multisetJaccard(items(left), items(right));
  const rightStars = new Map(rightUnits.map((unit) => [unit.unitId, unit.starLevel]));
  const sharedStars = leftUnits.filter((unit) => rightStars.has(unit.unitId));
  const starLevelSimilarity = sharedStars.length
    ? sharedStars.reduce((sum, unit) => sum + Math.max(0, 1 - Math.abs(Number(unit.starLevel || 0) - Number(rightStars.get(unit.unitId) || 0)) / 3), 0) / sharedStars.length
    : 0;
  const components = { unitOverlap, weightedCoreUnitOverlap, activeTraitSimilarity, carrySimilarity, completedItemSimilarity, starLevelSimilarity };
  const score = Object.entries(RELAXED_SIMILARITY_WEIGHTS).reduce((sum, [key, weight]) => sum + components[key] * weight, 0);
  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Number(value.toFixed(4))])),
  };
}
