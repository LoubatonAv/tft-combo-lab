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
  const sets =
    itemSetStats?.[champ?.id] || itemSetStats?.[champ?.apiName] || [];

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

  return Math.max(
    0,
    Math.min(
      110,
      (tierToScore(best.tier) || 50) +
        Number(best.winRate || 0) * 1.2 -
        Number(best.avgPlace || 4.5) * 5 +
        Math.min(Number(best.games || 0) / 150, 10),
    ),
  );
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

  const isTargetTraitUnit = Boolean(
    targetTrait && champ.traits.includes(targetTrait),
  );
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

function getCarryStarMultiplier(starLevel) {
  if (starLevel === 3) return 2.25;
  if (starLevel === 2) return 1.55;
  return 1;
}

function scoreMetaBuild(build = {}) {
  const tierBase = tierToScore(build.tier || "C");
  const avgPlace = Number(build.avgPlace || 0);
  const winRate = Number(build.winRate || 0);
  const games = Number(build.games || 0);

  let score = Number(build.score || 0) || tierBase;

  if (avgPlace > 0) score += (4.5 - avgPlace) * 15;
  if (winRate > 0) score += winRate * 0.85;
  if (games > 0) score += Math.min(games / 180, 14);

  return Math.max(0, Math.min(125, score));
}

function getUnitBuildMetaEntry(unit, unitBuildMeta = {}) {
  return unitBuildMeta?.[unit.id] || unitBuildMeta?.[unit.apiName] || null;
}

function getBestBuildForStar(unit, starLevel, unitBuildMeta = {}) {
  const entry = getUnitBuildMetaEntry(unit, unitBuildMeta);
  const builds =
    entry?.byStar?.[starLevel] || entry?.byStar?.[String(starLevel)] || [];

  return (
    [...builds].sort((a, b) => scoreMetaBuild(b) - scoreMetaBuild(a))[0] || null
  );
}

function getBestOverallMetaBuild(unit, unitBuildMeta = {}) {
  const entry = getUnitBuildMetaEntry(unit, unitBuildMeta);
  const builds = [
    ...(entry?.allBuilds || []),
    ...Object.values(entry?.byStar || {}).flat(),
  ];

  return (
    [...builds].sort((a, b) => scoreMetaBuild(b) - scoreMetaBuild(a))[0] || null
  );
}

function hasPremiumCarryCandidate(units) {
  return units.some((unit) => {
    const cost = Number(unit.cost || 1);
    const carryScore = Number(unit.carryScore || 0);

    return (
      isCarryCandidateUnit(unit) &&
      (cost >= 4 || (cost === 3 && carryScore >= 80))
    );
  });
}

function getBestCarryStarPlan(unit, context = {}) {
  const {
    targetTrait,
    itemSetStats = {},
    championMeta = {},
    unitBuildMeta = {},
    hasPremiumCarry = false,
  } = context;

  const cost = Number(unit.cost || 1);
  const carryScore = Number(unit.carryScore || 0);
  const metaScore = getMetaScore(unit, championMeta);
  const itemSetScore = getItemSetScore(unit, itemSetStats);
  const isTargetUnit = Boolean(
    targetTrait && unit.traits?.includes(targetTrait),
  );

  const best1 = getBestBuildForStar(unit, 1, unitBuildMeta);
  const best2 = getBestBuildForStar(unit, 2, unitBuildMeta);
  const best3 = getBestBuildForStar(unit, 3, unitBuildMeta);
  const best1Score = best1 ? scoreMetaBuild(best1) : 0;
  const best2Score = best2 ? scoreMetaBuild(best2) : 0;
  const best3Score = best3 ? scoreMetaBuild(best3) : 0;

  if (cost === 1) {
    const isRealRerollCarry =
      best3Score >= Math.max(78, best2Score + 8) ||
      (!hasPremiumCarry &&
        carryScore >= 60 &&
        (metaScore >= 70 || itemSetScore >= 78 || isTargetUnit));

    if (isRealRerollCarry) {
      return {
        starLevel: 3,
        realism: hasPremiumCarry ? 0.78 : 0.95,
        label: best3 ? "3★ MetaTFT reroll carry" : "3★ reroll carry",
        build: best3 || getBestOverallMetaBuild(unit, unitBuildMeta),
      };
    }

    return {
      starLevel: 2,
      realism: 1,
      label: "2★ trait/filler",
      build: best2 || getBestOverallMetaBuild(unit, unitBuildMeta),
    };
  }

  if (cost === 2) {
    const isRealRerollCarry =
      best3Score >= Math.max(76, best2Score + 6) ||
      (!hasPremiumCarry &&
        carryScore >= 70 &&
        (metaScore >= 68 || itemSetScore >= 74 || isTargetUnit));

    if (isRealRerollCarry) {
      return {
        starLevel: 3,
        realism: hasPremiumCarry ? 0.68 : 0.82,
        label: best3 ? "3★ MetaTFT viable reroll" : "3★ viable reroll carry",
        build: best3 || getBestOverallMetaBuild(unit, unitBuildMeta),
      };
    }

    return {
      starLevel: 2,
      realism: 1,
      label: "2★ expected",
      build: best2 || getBestOverallMetaBuild(unit, unitBuildMeta),
    };
  }

  if (cost === 3) {
    const isRealRerollCarry =
      best3Score >= Math.max(80, best2Score + 8) ||
      (carryScore >= 80 &&
        (metaScore >= 74 || itemSetScore >= 80 || !hasPremiumCarry));

    if (isRealRerollCarry) {
      return {
        starLevel: 3,
        realism: hasPremiumCarry ? 0.45 : 0.55,
        label: best3 ? "3★ MetaTFT possible carry" : "3★ possible carry",
        build: best3 || getBestOverallMetaBuild(unit, unitBuildMeta),
      };
    }

    return {
      starLevel: 2,
      realism: 0.95,
      label: "2★ expected",
      build: best2 || getBestOverallMetaBuild(unit, unitBuildMeta),
    };
  }

  if (cost === 4) {
    return {
      starLevel: 2,
      realism: 0.9,
      label: best2
        ? "2★ MetaTFT late-game carry"
        : "2★ realistic late-game carry",
      build: best2 || getBestOverallMetaBuild(unit, unitBuildMeta),
    };
  }

  if (cost === 5) {
    return {
      starLevel: 2,
      realism: 0.5,
      label: best2 ? "2★ MetaTFT luxury carry" : "2★ luxury late-game carry",
      build: best2 || getBestOverallMetaBuild(unit, unitBuildMeta),
    };
  }

  return {
    starLevel: 1,
    realism: 1,
    label: "1★ expected",
    build: best1 || getBestOverallMetaBuild(unit, unitBuildMeta),
  };
}

function getAutoCarryCombatPower(unit, carryPlan) {
  const stats = unit.stats || {};
  const cost = Number(unit.cost || 1);

  const raw =
    Number(unit.carryScore || 0) * 1.4 +
    cost * 22 +
    Number(stats.damage || 0) * 0.85 +
    Number(stats.attackSpeed || 0) * 26 +
    Number(stats.hp || 0) / 72 +
    Number(stats.armor || 0) * 0.22 +
    Number(stats.magicResist || 0) * 0.22;

  const buildScore = carryPlan.build ? scoreMetaBuild(carryPlan.build) : 0;

  return (
    raw *
      getCarryStarMultiplier(carryPlan.starLevel) *
      Number(carryPlan.realism || 1) +
    buildScore * 1.25
  );
}

function getAutoCarryPenalty(unit, carryPlan, targetTrait) {
  const cost = Number(unit.cost || 1);
  const isTargetUnit = Boolean(
    targetTrait && unit.traits?.includes(targetTrait),
  );
  let penalty = 0;

  if (cost === 1 && carryPlan.starLevel < 3) penalty += 85;
  if (cost === 2 && carryPlan.starLevel < 3) penalty += 42;
  if (cost <= 2 && isTargetUnit && carryPlan.starLevel < 3) penalty += 16;

  return penalty;
}

function getActiveTraitNamesForCarry(units) {
  const counts = new Map();

  for (const unit of units || []) {
    for (const trait of unit.traits || []) {
      counts.set(trait, (counts.get(trait) || 0) + 1);
    }
  }

  return new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([trait]) => trait),
  );
}

function getCarryShellFitScore(unit, activeTraitNames, targetTrait) {
  const traits = unit.traits || [];
  const sharedActiveTraits = traits.filter((trait) =>
    activeTraitNames.has(trait),
  ).length;

  let score = 0;

  if (targetTrait) {
    if (traits.includes(targetTrait)) {
      score += 45;
    } else {
      score -= 65;
    }
  }

  if (sharedActiveTraits >= 2) {
    score += 45;
  } else if (sharedActiveTraits === 1) {
    score += 12;
  } else {
    score -= 90;
  }

  return score;
}

function chooseCarry({
  units,
  targetTrait,
  carryId,
  championMeta,
  itemStats,
  itemSetStats,
  unitBuildMeta = {},
}) {
  if (carryId && carryId !== "auto") {
    return units.find((unit) => unit.id === carryId) || null;
  }

  const candidates = units.filter((unit) => isCarryCandidateUnit(unit));
  const pool = candidates.length ? candidates : units;
  const hasPremiumCarry = pool.some((unit) => {
    const cost = Number(unit.cost || 1);
    const carryScore = Number(unit.carryScore || 0);

    return cost >= 3 && carryScore >= 65;
  });

  const activeTraitNames = getActiveTraitNamesForCarry(units);

  const scored = [...pool].map((unit) => {
    const itemSets = Array.isArray(itemSetStats?.[unit.id])
      ? itemSetStats[unit.id].length
      : 0;
    const items = Array.isArray(itemStats?.[unit.id])
      ? itemStats[unit.id].length
      : unit.items?.length || 0;
    const carryPlan = getBestCarryStarPlan(unit, {
      targetTrait,
      itemSetStats,
      championMeta,
      unitBuildMeta,
      hasPremiumCarry,
    });
    const targetBonus =
      targetTrait && unit.traits?.includes(targetTrait) ? 6 : 0;
    const shellFitScore = getCarryShellFitScore(
      unit,
      activeTraitNames,
      targetTrait,
    );
    const score =
      getAutoCarryCombatPower(unit, carryPlan) +
      getMetaScore(unit, championMeta) * 1.2 +
      getItemSetScore(unit, itemSetStats) * 0.65 +
      shellFitScore +
      itemSets * 3 +
      items * 1.5 +
      targetBonus -
      getAutoCarryPenalty(unit, carryPlan, targetTrait);

    return { unit, score, carryPlan };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.unit || null;
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

  const targetLinkedTraitNames = new Set(
    targetUnits.flatMap((unit) =>
      (unit.traits || []).filter((trait) => trait !== targetTrait),
    ),
  );

  for (const trait of targetLinkedTraitNames) {
    usefulTraitNames.add(trait);
  }

  const targetLinkedUnits = champions.filter((champ) => {
    return champ.traits?.some((trait) => targetLinkedTraitNames.has(trait));
  });

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

  function getActiveTraitNamesForCarry(units) {
    const counts = new Map();

    for (const unit of units || []) {
      for (const trait of unit.traits || []) {
        counts.set(trait, (counts.get(trait) || 0) + 1);
      }
    }

    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([trait]) => trait),
    );
  }

  function getCarryShellFitScore(unit, activeTraitNames, targetTrait) {
    const traits = unit.traits || [];
    const sharedActiveTraits = traits.filter((trait) =>
      activeTraitNames.has(trait),
    ).length;

    let score = 0;

    if (targetTrait) {
      if (traits.includes(targetTrait)) {
        score += 45;
      } else {
        score -= 65;
      }
    }

    if (sharedActiveTraits >= 2) {
      score += 45;
    } else if (sharedActiveTraits === 1) {
      score += 12;
    } else {
      score -= 90;
    }

    return score;
  }

  const frontlineUnits = champions.filter((champ) => isFrontlineUnit(champ));

  const byId = new Map(
    [
      ...lockedUnits,
      ...targetUnits,
      ...targetLinkedUnits,
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

function abilityMentionsDamage(unit) {
  const desc = String(unit?.ability?.desc || "").toLowerCase();

  return (
    desc.includes("physicaldamage") ||
    desc.includes("magicdamage") ||
    desc.includes("truedamage") ||
    /\bdeal\b.*\bdamage\b/i.test(desc)
  );
}

function isCarryCandidateUnit(unit) {
  const role = String(unit?.role || "").toLowerCase();
  const carryScore = Number(unit?.carryScore || 0);
  const cost = Number(unit?.cost || 1);
  const stats = unit?.stats || {};
  const range = Number(stats.range ?? unit?.range ?? 1);
  const damage = Number(stats.damage || 0);
  const attackSpeed = Number(stats.attackSpeed || 0);

  if (/carry|caster|assassin|damage|sniper|marksman|ad|ap/i.test(role)) {
    return true;
  }

  if (role.includes("flex") && carryScore >= 55) {
    return true;
  }

  if (carryScore >= 65) {
    return true;
  }

  if (abilityMentionsDamage(unit) && carryScore >= 50) {
    return true;
  }

  if (cost >= 3 && abilityMentionsDamage(unit)) {
    return true;
  }

  if (range >= 3 && damage > 0 && attackSpeed >= 0.65) {
    return true;
  }

  return false;
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
  unitBuildMeta = {},
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

  const availableFrontlineCount = champions.filter((unit) =>
    isFrontlineUnit(unit),
  ).length;

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

  // Do NOT greedily lock frontline units.
  // Frontline is a hard constraint, but the optimizer should decide
  // which frontline units fit the whole comp best.
  const requiredFrontlineUnits = [];

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
      unitBuildMeta,
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
        minFrontline,
        championMeta,
        traitMeta,
        itemStats,
        itemSetStats,
        unitUpgradeMeta,
        unitBuildMeta,
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
