import { createHash } from "node:crypto";

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function canonicalizeIdentifier(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/");

  return normalized || null;
}

export function normalizePatch(gameVersion) {
  const value = String(gameVersion ?? "").trim();
  const match = value.match(/(?:version\s*)?(\d+)\.(\d+)/i);
  return match ? `${Number(match[1])}.${Number(match[2])}` : null;
}

export function createChampionIndex(champions = []) {
  const index = new Map();

  for (const champion of champions) {
    const canonical = canonicalizeIdentifier(
      champion.apiName || champion.characterName || champion.id,
    );
    if (!canonical) continue;

    const entry = {
      unitId: canonical,
      cost: finiteNumber(champion.cost),
    };

    for (const alias of [
      champion.id,
      champion.apiName,
      champion.characterName,
      champion.character_id,
    ]) {
      const key = canonicalizeIdentifier(alias);
      if (key) index.set(key, entry);
    }
  }

  return index;
}

export function createTraitIndex(traits = []) {
  const index = new Map();

  for (const trait of traits) {
    const canonical = canonicalizeIdentifier(trait.apiName || trait.name);
    if (!canonical) continue;

    for (const alias of [trait.name, trait.apiName, trait.id]) {
      const key = canonicalizeIdentifier(alias);
      if (key) index.set(key, canonical);
    }
  }

  return index;
}

function normalizeItems(unit) {
  const values = Array.isArray(unit?.itemNames)
    ? unit.itemNames
    : Array.isArray(unit?.items)
      ? unit.items
      : Array.isArray(unit?.itemIds)
        ? unit.itemIds
      : Array.isArray(unit?.item_ids)
        ? unit.item_ids
        : [];

  return values
    .map((item) =>
      canonicalizeIdentifier(
        typeof item === "object"
          ? item.apiName || item.id || item.name
          : item,
      ),
    )
    .filter(Boolean)
    .sort();
}

function normalizeUnit(unit, championIndex, starPlans = {}) {
  const rawId = canonicalizeIdentifier(
    unit?.character_id ||
      unit?.characterId ||
      unit?.apiName ||
      unit?.characterName ||
      unit?.unitId ||
      unit?.id,
  );

  if (!rawId) return null;

  const catalogEntry = championIndex.get(rawId);
  const starLevel = finiteNumber(
    unit?.tier ??
      unit?.starLevel ??
      unit?.stars ??
      starPlans?.[unit?.id]?.starLevel ??
      starPlans?.[rawId]?.starLevel,
  );

  return {
    unitId: catalogEntry?.unitId || rawId,
    starLevel:
      starLevel === null ? null : Math.max(1, Math.min(4, starLevel)),
    itemIds: normalizeItems(unit),
    cost: finiteNumber(unit?.cost, catalogEntry?.cost ?? null),
  };
}

function normalizeTrait(trait, traitIndex) {
  const rawId = canonicalizeIdentifier(
    trait?.name || trait?.apiName || trait?.traitId || trait?.id,
  );
  if (!rawId) return null;

  const activeTier = finiteNumber(
    trait?.tier_current ??
      trait?.tierCurrent ??
      trait?.activeTier ??
      trait?.activeAt ??
      trait?.style,
  );
  const explicitlyActive = trait?.isActive === true;

  if (!explicitlyActive && (activeTier === null || activeTier <= 0)) {
    return null;
  }

  return {
    traitId: traitIndex.get(rawId) || rawId,
    unitCount: finiteNumber(
      trait?.num_units ?? trait?.numUnits ?? trait?.count,
    ),
    activeTier: activeTier === null ? null : Math.max(1, activeTier),
  };
}

export function createBoardFingerprint(board) {
  const stableValue = {
    units: board.units.map((unit) => ({
      unitId: unit.unitId,
      starLevel: unit.starLevel,
      itemIds: [...unit.itemIds].sort(),
    })),
    activeTraits: board.activeTraits.map((trait) => ({
      traitId: trait.traitId,
      activeTier: trait.activeTier,
      unitCount: trait.unitCount,
    })),
  };

  return createHash("sha256")
    .update(JSON.stringify(stableValue))
    .digest("hex");
}

export function createContextFingerprint(
  boardFingerprint,
  setNumber,
  patch,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        boardFingerprint,
        setNumber: setNumber ?? null,
        patch: patch ?? null,
      }),
    )
    .digest("hex");
}

/** @returns {import("./models.js").NormalizedFinalBoard} */
export function normalizeFinalBoard(input = {}, options = {}) {
  const championIndex =
    options.championIndex || createChampionIndex(options.champions || []);
  const traitIndex = options.traitIndex || createTraitIndex(options.traits || []);
  const gameVersion = input.gameVersion || input.game_version || null;
  const patch = input.patch || normalizePatch(gameVersion);
  const setNumber = finiteNumber(
    input.setNumber ?? input.tft_set_number ?? input.set,
  );

  const units = (Array.isArray(input.units) ? input.units : [])
    .map((unit) => normalizeUnit(unit, championIndex, input.starPlans || {}))
    .filter(Boolean)
    .sort((a, b) =>
      a.unitId.localeCompare(b.unitId) ||
      Number(a.starLevel || 0) - Number(b.starLevel || 0) ||
      a.itemIds.join("|").localeCompare(b.itemIds.join("|")),
    );

  const traitSource = Array.isArray(input.activeTraits)
    ? input.activeTraits
    : Array.isArray(input.traits)
      ? input.traits
      : [];
  const activeTraits = traitSource
    .map((trait) => normalizeTrait(trait, traitIndex))
    .filter(Boolean)
    .sort((a, b) => a.traitId.localeCompare(b.traitId));

  const knownCosts = units.map((unit) => unit.cost).filter(Number.isFinite);
  const totalUnitCost =
    units.length > 0 && knownCosts.length === units.length
      ? knownCosts.reduce((sum, cost) => sum + cost, 0)
      : null;

  const board = {
    setNumber,
    patch,
    gameVersion: gameVersion ? String(gameVersion) : null,
    boardSize: units.length,
    totalUnitCost,
    units,
    activeTraits,
  };

  const boardFingerprint = createBoardFingerprint(board);

  return {
    ...board,
    boardFingerprint,
    contextFingerprint: createContextFingerprint(
      boardFingerprint,
      setNumber,
      patch,
    ),
  };
}
