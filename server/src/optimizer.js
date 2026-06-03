import { scoreComp } from "./scoring.js";
import { getSpecialTraitPlan } from "./specialSources.js";
import { getAllowedMaxCost, getGameMode, tierToScore } from "./rules.js";
import { getChampionFitToCarry, getCarryProfile } from "./carryFit.js";

function combinations(arr, size, hardLimit = 120000) {
  const output = [];
  const combo = [];
  let produced = 0;

  function walk(start) {
    if (produced >= hardLimit) return;

    if (combo.length === size) {
      output.push([...combo]);
      produced += 1;
      return;
    }

    const needed = size - combo.length;

    for (let i = start; i <= arr.length - needed; i += 1) {
      combo.push(arr[i]);
      walk(i + 1);
      combo.pop();

      if (produced >= hardLimit) return;
    }
  }

  walk(0);
  return output;
}

function getMetaScore(champ, championMeta = {}) {
  const meta = championMeta[champ.id] || {};

  if (Number(meta.score) > 0) {
    return Number(meta.score);
  }

  if (meta.tier) {
    return tierToScore(meta.tier);
  }

  return tierToScore(champ.tier || "C");
}

function getItemSetScore(champ, itemSetStats = {}) {
  const sets = itemSetStats?.[champ?.id] || itemSetStats?.[champ?.apiName] || [];

  if (!Array.isArray(sets) || !sets.length) return 0;

  const best = [...sets]
    .filter((set) => Array.isArray(set.items) && set.items.length)
    .sort((a, b) => {
      const aScore =
        Number(a.score || 0) ||
        tierToScore(a.tier) +
          Number(a.winRate || 0) * 1.5 -
          Number(a.avgPlace || 4.5) * 8 +
          Math.min(Number(a.games || 0) / 150, 10);

      const bScore =
        Number(b.score || 0) ||
        tierToScore(b.tier) +
          Number(b.winRate || 0) * 1.5 -
          Number(b.avgPlace || 4.5) * 8 +
          Math.min(Number(b.games || 0) / 150, 10);

      return bScore - aScore;
    })[0];

  if (!best) return 0;

  return Math.max(0, Math.min(110,
    (tierToScore(best.tier) || 50) +
      Number(best.winRate || 0) * 1.2 -
      Number(best.avgPlace || 4.5) * 5 +
      Math.min(Number(best.games || 0) / 150, 10),
  ));
}

function getUsefulTraitNamesForCarry({
  carry,
  lockedUnits,
  targetTrait,
  carryProfiles,
  traitProfiles,
}) {
  const profile = getCarryProfile(carry, carryProfiles);
  const names = new Set();

  if (targetTrait) names.add(targetTrait);

  for (const unit of lockedUnits || []) {
    for (const trait of unit.traits || []) {
      names.add(trait);
    }
  }

  if (profile?.preferredTraits?.length) {
    for (const trait of profile.preferredTraits) {
      names.add(trait);
    }
  }

  for (const [traitName, traitProfile] of Object.entries(traitProfiles || {})) {
    const tags = traitProfile.tags || [];
    const scalesWith = profile?.scalesWith || [];
    const needs = profile?.needs || [];

    const helpsCarry =
      tags.some((tag) => scalesWith.includes(tag)) ||
      tags.some((tag) => needs.includes(tag));

    if (
      helpsCarry &&
      ["S", "A"].includes(String(traitProfile.tier || "").toUpperCase())
    ) {
      names.add(traitName);
    }
  }

  return names;
}

function championPriority({
  champ,
  targetTrait,
  carry,
  carryId,
  lockedTraitNames,
  usefulTraitNames,
  championMeta = {},
  itemSetStats = {},
  carryProfiles = {},
  traitProfiles = {},
  traitMeta = {},
}) {
  let score = 0;

  if (carryId && carryId !== "auto" && champ.id === carryId) score += 500;

  const isTargetTraitUnit = Boolean(targetTrait && champ.traits.includes(targetTrait));
  let usefulTraitOverlap = 0;

  if (isTargetTraitUnit) score += 120;

  for (const trait of champ.traits || []) {
    if (lockedTraitNames.has(trait)) score += 75;
    if (usefulTraitNames.has(trait)) {
      usefulTraitOverlap += 1;
      score += 95;
    }
  }

  if (
    targetTrait &&
    !isTargetTraitUnit &&
    isCarryLikeUnit(champ) &&
    usefulTraitOverlap === 0 &&
    (!carryId || carryId === "auto" || champ.id !== carryId)
  ) {
    score -= 80;
  }

  if (targetTrait && !isTargetTraitUnit && usefulTraitOverlap === 0) {
    score -= 24;
  }

  score += getMetaScore(champ, championMeta) * 2.2;
  score += getItemSetScore(champ, itemSetStats) * 0.42;
  score += (champ.carryScore || 0) * 0.45;
  score += champ.cost * 2;
  score += champ.traits.length * 3;

  if (carry) {
    score +=
      getChampionFitToCarry({
        champion: champ,
        carry,
        carryProfiles,
        traitProfiles,
        traitMeta,
      }) * 1.8;
  }

  return score;
}

function chooseCarry({ units, targetTrait, carryId, championMeta, itemStats, itemSetStats }) {
  if (carryId && carryId !== "auto") {
    return units.find((unit) => unit.id === carryId) || null;
  }

  const candidates = units.filter((unit) => {
    return /carry|caster|assassin|damage|ad|ap/i.test(unit.role || "");
  });

  const pool = candidates.length ? candidates : units;

  return (
    [...pool].sort((a, b) => {
      const aItemSets = Array.isArray(itemSetStats?.[a.id]) ? itemSetStats[a.id].length : 0;
      const bItemSets = Array.isArray(itemSetStats?.[b.id]) ? itemSetStats[b.id].length : 0;
      const aItems = Array.isArray(itemStats[a.id])
        ? itemStats[a.id].length
        : a.items?.length || 0;
      const bItems = Array.isArray(itemStats[b.id])
        ? itemStats[b.id].length
        : b.items?.length || 0;

      const aScore =
        (targetTrait && a.traits.includes(targetTrait) ? 35 : 0) +
        getMetaScore(a, championMeta) +
        getItemSetScore(a, itemSetStats) * 0.55 +
        (a.carryScore || 0) +
        aItemSets * 10 +
        aItems * 7 +
        a.cost * 5;

      const bScore =
        (targetTrait && b.traits.includes(targetTrait) ? 35 : 0) +
        getMetaScore(b, championMeta) +
        getItemSetScore(b, itemSetStats) * 0.55 +
        (b.carryScore || 0) +
        bItemSets * 10 +
        bItems * 7 +
        b.cost * 5;

      return bScore - aScore;
    })[0] || null
  );
}

function buildCandidatePool({
  champions,
  lockedUnits,
  targetTrait,
  carry,
  carryId,
  boardSize,
  championMeta,
  itemSetStats,
  carryProfiles,
  traitProfiles,
  traitMeta,
}) {
  const lockedTraitNames = new Set(
    lockedUnits.flatMap((unit) => unit.traits || []),
  );

  const usefulTraitNames = getUsefulTraitNamesForCarry({
    carry,
    lockedUnits,
    targetTrait,
    carryProfiles,
    traitProfiles,
  });

  const targetUnits = targetTrait
    ? champions.filter((champ) => champ.traits.includes(targetTrait))
    : [];

  const helpfulUnits = champions.filter((champ) => {
    return champ.traits.some((trait) => usefulTraitNames.has(trait));
  });

  const lockedLinkedUnits = champions.filter((champ) => {
    return champ.traits.some((trait) => lockedTraitNames.has(trait));
  });

  const premiumUnits = champions.filter((champ) => {
    const meta = championMeta[champ.id] || {};
    const tier = String(meta.tier || champ.tier || "").toUpperCase();

    return tier === "S" || tier === "A" || champ.cost >= 4;
  });

  const frontlineUnits = champions.filter((champ) => isFrontlineUnit(champ));

  const byId = new Map(
    [
      ...lockedUnits,
      ...targetUnits,
      ...helpfulUnits,
      ...lockedLinkedUnits,
      ...premiumUnits,
      ...frontlineUnits,
      ...(carry ? [carry] : []),
    ].map((champ) => [champ.id, champ]),
  );

  const pool = [...byId.values()].sort((a, b) => {
    const args = {
      targetTrait,
      carry,
      carryId,
      lockedTraitNames,
      usefulTraitNames,
      championMeta,
      itemSetStats,
      carryProfiles,
      traitProfiles,
      traitMeta,
    };

    return (
      championPriority({ champ: b, ...args }) -
      championPriority({ champ: a, ...args })
    );
  });

  return pool.slice(0, Math.min(36, Math.max(boardSize + 20, 28)));
}

function makeLabel({ targetTrait, evaluation }) {
  const activeCount = evaluation.activeTraits.filter(
    (t) => t.isActive && !t.isUnique,
  ).length;

  if (targetTrait) {
    return `${targetTrait} ${evaluation.primaryTrait.count}${evaluation.primaryTrait.specialCount ? ` (+${evaluation.primaryTrait.specialCount})` : ""} · ${activeCount} active traits`;
  }

  const topTraits = evaluation.activeTraits
    .filter((t) => t.isActive && !t.isUnique)
    .slice(0, 3)
    .map((t) => `${t.name} ${t.count}`)
    .join(" · ");

  return `${topTraits || "Custom board"} · ${activeCount} active traits`;
}

function countNaturalTrait(units, traitName) {
  if (!traitName) return 0;

  return units.filter((unit) => unit.traits?.includes(traitName)).length;
}

function getRequiredNaturalTargetCount({
  targetTrait,
  targetCount,
  maxEmblems = 0,
  boardSize,
  allowMechaTransformer = false,
}) {
  if (!targetTrait || !targetCount) return 0;

  // Mecha is special: Mecha Transformer can make each Mecha unit count as 2.
  // Do not force targetCount - maxEmblems natural Mecha units in that case.
  if (targetTrait === "Mecha" && allowMechaTransformer) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(Number(targetCount), Number(boardSize)) - Number(maxEmblems || 0),
  );
}

function pickBestNaturalTraitUnits({
  champions,
  lockedUnits,
  targetTrait,
  requiredNaturalCount,
  championMeta = {},
  carry = null,
  carryProfiles = {},
  traitProfiles = {},
  traitMeta = {},
}) {
  if (!targetTrait || requiredNaturalCount <= 0) return [];

  const lockedIds = new Set(lockedUnits.map((unit) => unit.id));

  const lockedTargetUnits = lockedUnits.filter((unit) =>
    unit.traits?.includes(targetTrait),
  );

  const missing = Math.max(0, requiredNaturalCount - lockedTargetUnits.length);

  if (missing <= 0) {
    return lockedTargetUnits;
  }

  const candidates = champions
    .filter((unit) => unit.traits?.includes(targetTrait))
    .filter((unit) => !lockedIds.has(unit.id))
    .sort((a, b) => {
      const aMeta = getMetaScore(a, championMeta);
      const bMeta = getMetaScore(b, championMeta);

      const aCarryFit = carry
        ? getChampionFitToCarry({
            champion: a,
            carry,
            carryProfiles,
            traitProfiles,
            traitMeta,
          })
        : 0;

      const bCarryFit = carry
        ? getChampionFitToCarry({
            champion: b,
            carry,
            carryProfiles,
            traitProfiles,
            traitMeta,
          })
        : 0;

      return (
        bMeta - aMeta ||
        bCarryFit - aCarryFit ||
        b.cost - a.cost ||
        a.name.localeCompare(b.name)
      );
    });

  return [...lockedTargetUnits, ...candidates.slice(0, missing)];
}

const FRONTLINE_TRAITS = new Set([
  "Brawler",
  "Vanguard",
  "Bastion",
  "Bruiser",
  "Defender",
  "Protector",
  "Warden",
  "Guardian",
  "Sentinel",
  "Juggernaut",
  "Tank",
]);

function getUnitRange(unit) {
  return Number(unit?.stats?.range ?? unit?.range ?? 1);
}

function isCarryLikeUnit(unit) {
  return /carry|caster|assassin|damage|sniper|marksman|ad|ap/i.test(
    unit?.role || "",
  );
}

function getTankinessScore(unit) {
  const stats = unit?.stats || {};

  return (
    Number(stats.hp || 0) / 80 +
    Number(stats.armor || 0) / 3 +
    Number(stats.magicResist || 0) / 3
  );
}

function isFrontlineUnit(unit) {
  const role = String(unit?.role || "").toLowerCase();

  if (/tank|front|defender|bruiser|fighter/.test(role)) return true;

  const hasFrontlineTrait = (unit?.traits || []).some((trait) =>
    FRONTLINE_TRAITS.has(trait),
  );

  if (!hasFrontlineTrait) return false;

  // Traits like Brawler can appear on ranged damage units. Do not let those
  // satisfy the hard frontline constraint unless they are actually durable/front.
  if (isCarryLikeUnit(unit) && getUnitRange(unit) > 1) return false;

  return getUnitRange(unit) <= 1 || getTankinessScore(unit) >= 42;
}

function countFrontlineUnits(units) {
  return units.filter((unit) => isFrontlineUnit(unit)).length;
}

function pickBestFrontlineUnits({
  champions,
  baseUnits,
  minFrontline = 0,
  championMeta = {},
}) {
  const required = Math.max(0, Number(minFrontline || 0));

  if (!required) return [];

  const baseIds = new Set(baseUnits.map((unit) => unit.id));
  const currentFrontlineCount = countFrontlineUnits(baseUnits);
  const missing = Math.max(0, required - currentFrontlineCount);

  if (missing <= 0) return [];

  const candidates = champions
    .filter((unit) => isFrontlineUnit(unit))
    .filter((unit) => !baseIds.has(unit.id))
    .sort((a, b) => {
      return (
        getMetaScore(b, championMeta) - getMetaScore(a, championMeta) ||
        getTankinessScore(b) - getTankinessScore(a) ||
        b.cost - a.cost ||
        a.name.localeCompare(b.name)
      );
    });

  return candidates.slice(0, missing);
}

export function optimize({
  champions,
  traits,
  metaComps,
  targetTrait = null,
  targetCount = null,
  lockedUnitIds = [],
  transformedMechaIds = [],
  boardSize = 8,
  minFrontline = 0,
  carryId = "auto",
  maxResults = 12,
  gameModeId = "capped",
  maxUnitCost = null,
  allowEmblems = false,
  maxEmblems = 0,
  allowMechaTransformer = false,
  championMeta = {},
  traitMeta = {},
  itemStats = {},
  itemSetStats = {},
  unitUpgradeMeta = {},
  matchHistory = [],
  carryProfiles = {},
  traitProfiles = {},
}) {
  boardSize = Math.max(2, Math.min(Number(boardSize || 8), 10));
  minFrontline = Math.max(0, Math.min(Number(minFrontline || 0), boardSize));

  const wantedCount = targetTrait
    ? Math.max(1, Number(targetCount || boardSize))
    : 0;

  const gameMode = getGameMode(gameModeId);
  const allowedMaxCost = getAllowedMaxCost(gameModeId, maxUnitCost);

  champions = champions.filter(
    (champ) => Number(champ.cost) <= Number(allowedMaxCost),
  );

  const lockedUnits = lockedUnitIds
    .map((id) => champions.find((champ) => champ.id === id))
    .filter(Boolean);

  if (lockedUnits.length > boardSize) {
    throw new Error(
      `You locked ${lockedUnits.length} units, but board size is ${boardSize}.`,
    );
  }

  const availableFrontlineCount = champions.filter((unit) => isFrontlineUnit(unit)).length;

  if (minFrontline > availableFrontlineCount) {
    throw new Error(
      `Frontline requirement is too high: requested ${minFrontline}, but only ${availableFrontlineCount} eligible frontline units are available with the current max-cost filter.`,
    );
  }

  if (carryId !== "auto") {
    const selectedCarry = champions.find((champ) => champ.id === carryId);

    if (!selectedCarry) {
      carryId = "auto";
    }
  }

  const carry =
    carryId && carryId !== "auto"
      ? champions.find((champ) => champ.id === carryId)
      : lockedUnits.find((unit) =>
          /carry|caster|assassin|damage|ad|ap/i.test(unit.role || ""),
        ) || null;

  const requiredNaturalTargetCount = getRequiredNaturalTargetCount({
    targetTrait,
    targetCount: wantedCount,
    maxEmblems: allowEmblems ? maxEmblems : 0,
    boardSize,
    allowMechaTransformer,
  });

  const requiredTargetUnits = pickBestNaturalTraitUnits({
    champions,
    lockedUnits,
    targetTrait,
    requiredNaturalCount: requiredNaturalTargetCount,
    championMeta,
    carry,
    carryProfiles,
    traitProfiles,
    traitMeta,
  });

  const requiredFrontlineUnits = pickBestFrontlineUnits({
    champions,
    baseUnits: [...lockedUnits, ...requiredTargetUnits],
    minFrontline,
    championMeta,
  });

  const candidatePool = buildCandidatePool({
    champions,
    lockedUnits,
    targetTrait,
    carry,
    carryId,
    boardSize,
    championMeta,
    itemSetStats,
    carryProfiles,
    traitProfiles,
    traitMeta,
  });

  const lockedIds = new Set([
    ...lockedUnits.map((unit) => unit.id),
    ...requiredTargetUnits.map((unit) => unit.id),
    ...requiredFrontlineUnits.map((unit) => unit.id),
  ]);

  if (carry) lockedIds.add(carry.id);

  const locked = champions.filter((champ) => lockedIds.has(champ.id));
  const available = candidatePool.filter((champ) => !lockedIds.has(champ.id));

  const transformedSet = new Set(transformedMechaIds);

  const lockedExtraSlots = locked.filter((unit) => {
    return unit.traits?.includes("Mecha") && transformedSet.has(unit.id);
  }).length;

  const remainingSlots = boardSize - locked.length - lockedExtraSlots;

  if (remainingSlots < 0) {
    throw new Error(
      `Your locked/transformed core already uses ${locked.length + lockedExtraSlots}/${boardSize} slots.`,
    );
  }
  const rawCombos =
    remainingSlots > 0 ? combinations(available, remainingSlots) : [[]];

  const seen = new Set();
  const results = [];

  for (const combo of rawCombos) {
    const units = [...locked, ...combo];
    const naturalTargetCount = countNaturalTrait(units, targetTrait);

    if (
      targetTrait &&
      wantedCount > 0 &&
      naturalTargetCount < requiredNaturalTargetCount
    ) {
      continue;
    }

    if (minFrontline > 0 && countFrontlineUnits(units) < minFrontline) {
      continue;
    }

    if (new Set(units.map((unit) => unit.id)).size !== units.length) continue;

    const hasManualMechaTransforms = transformedMechaIds.length > 0;

    const specialPlan =
      targetTrait || hasManualMechaTransforms
        ? getSpecialTraitPlan({
            targetTrait: targetTrait || "Mecha",
            targetCount: targetTrait ? wantedCount : 0,
            boardSize,
            selectedUnits: units,
            transformedMechaIds,
            allowEmblems,
            maxEmblems,
            allowMechaTransformer,
          })
        : {
            virtualTraits: {},
            extraBoardSlots: 0,
            specialSources: [],
            isPossible: true,
          };

    const boardSlotsUsed =
      units.length + Number(specialPlan.extraBoardSlots || 0);

    if (boardSlotsUsed !== boardSize) continue;
    if (boardSlotsUsed > 10) continue;

    const key = units
      .map((unit) => unit.id)
      .sort()
      .join("|");

    if (seen.has(key)) continue;
    seen.add(key);

    const chosenCarry = chooseCarry({
      units,
      targetTrait,
      carryId,
      championMeta,
      itemStats,
      itemSetStats,
    });

    const evaluation = scoreComp(
      units,
      traits,
      metaComps,
      targetTrait,
      chosenCarry,
      {
        targetCount: wantedCount,
        specialPlan,
        gameMode,
        championMeta,
        traitMeta,
        itemStats,
        itemSetStats,
        unitUpgradeMeta,
        matchHistory,
        carryProfiles,
        traitProfiles,
      },
    );

    results.push({
      id: key,
      label: makeLabel({ targetTrait, evaluation }),
      units: units.sort((a, b) => {
        const lockedDelta =
          Number(lockedIds.has(b.id)) - Number(lockedIds.has(a.id));
        if (lockedDelta) return lockedDelta;

        return (
          getMetaScore(b, championMeta) - getMetaScore(a, championMeta) ||
          b.cost - a.cost
        );
      }),
      carry: chosenCarry,
      gameMode,
      lockedUnitIds: [...lockedIds],
      ...evaluation,
    });
  }

  if (!results.length) {
    throw new Error(
      `No valid comps found for the selected requirements. Try lowering Frontline, Target Count, Max Unit Cost, or Max Emblems, or increase Board Size.`,
    );
  }

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, Number(maxResults || 12));
}
