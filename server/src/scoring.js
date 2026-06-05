import {
  getBestActiveBreakpoint,
  getNextBreakpoint,
  isUniqueTraitConfig,
  normalizeBreakpoints,
  tierToScore,
} from "./rules.js";

import {
  getCarryTraitFitScore,
  getCarryItemPlan,
  explainCarryFit,
} from "./carryFit.js";

export function countTraits(units, virtualTraits = {}) {
  const counts = new Map();

  for (const unit of units) {
    for (const trait of unit.traits || []) {
      counts.set(trait, (counts.get(trait) || 0) + 1);
    }
  }

  for (const [trait, amountRaw] of Object.entries(virtualTraits || {})) {
    const amount = Number(amountRaw) || 0;

    if (amount > 0) {
      counts.set(trait, (counts.get(trait) || 0) + amount);
    }
  }

  return Object.fromEntries(counts.entries());
}

export function evaluateTraits(units, traitsConfig, virtualTraits = {}) {
  const counts = countTraits(units, virtualTraits);

  return Object.entries(counts)
    .map(([name, count]) => {
      const cfg = traitsConfig.find((t) => t.name === name) || {
        name,
        type: "Trait",
        breakpoints: [],
      };

      const breakpoints = normalizeBreakpoints(cfg);
      const isUnique = isUniqueTraitConfig(cfg);
      const virtualCount = Number(virtualTraits?.[name] || 0);
      const naturalCount = count - virtualCount;

      const activeAt = isUnique
        ? count >= 1
          ? 1
          : 0
        : getBestActiveBreakpoint(count, breakpoints);

      const nextBreakpoint = isUnique
        ? null
        : getNextBreakpoint(count, breakpoints);

      return {
        name,
        type: cfg.type || "Trait",
        count,
        naturalCount,
        virtualCount,
        displayCount: isUnique ? Math.min(count, 1) : count,
        activeAt,
        nextBreakpoint,
        isUnique,
        isActive: Boolean(activeAt),
      };
    })
    .sort((a, b) => {
      const activeDelta = Number(b.isActive) - Number(a.isActive);
      if (activeDelta) return activeDelta;

      const uniqueDelta = Number(b.isUnique) - Number(a.isUnique);
      if (uniqueDelta) return uniqueDelta;

      return (
        (b.activeAt || 0) - (a.activeAt || 0) ||
        b.count - a.count ||
        a.name.localeCompare(b.name)
      );
    });
}

function getChampionMetaScore(unit, championMeta = {}) {
  const meta = championMeta[unit.id] || {};
  const tierScore = tierToScore(meta.tier || unit.tier);
  const statScore = Number(meta.score || 0);

  return statScore > 0 ? statScore : tierScore;
}

function getTraitMetaScore(traitName, traitMeta = {}, traitProfiles = {}) {
  const meta = {
    ...(traitProfiles[traitName] || {}),
    ...(traitMeta[traitName] || {}),
  };

  const tierScore = tierToScore(meta.tier);
  const statScore = Number(meta.score || 0);

  return statScore > 0 ? statScore : tierScore * 0.6;
}

function getItemHolderScore(unit, itemStats = {}, itemSetStats = {}) {
  const sets = itemSetStats?.[unit.id] || itemSetStats?.[unit.apiName] || [];

  if (Array.isArray(sets) && sets.length) {
    const bestSet = [...sets]
      .filter((set) => Array.isArray(set.items) && set.items.length)
      .sort((a, b) => {
        const aScore =
          Number(a.score || 0) ||
          tierToScore(a.tier) +
            Number(a.winRate || 0) * 1.8 -
            Number(a.avgPlace || 4.5) * 10 +
            Math.min(Number(a.games || 0) / 100, 14);

        const bScore =
          Number(b.score || 0) ||
          tierToScore(b.tier) +
            Number(b.winRate || 0) * 1.8 -
            Number(b.avgPlace || 4.5) * 10 +
            Math.min(Number(b.games || 0) / 100, 14);

        return bScore - aScore;
      })[0];

    if (bestSet) {
      return Math.max(
        45,
        Math.min(
          110,
          (tierToScore(bestSet.tier) || 50) +
            Number(bestSet.winRate || 0) * 1.2 -
            Number(bestSet.avgPlace || 4.5) * 6 +
            Math.min(Number(bestSet.games || 0) / 120, 12),
        ),
      );
    }
  }

  const stats = itemStats[unit.id];

  if (Array.isArray(stats) && stats.length) {
    return (
      stats
        .slice(0, 3)
        .reduce(
          (sum, item) =>
            sum + (Number(item.score) || tierToScore(item.tier) || 50),
          0,
        ) / 3
    );
  }

  if (Array.isArray(unit.items) && unit.items.length) {
    return Math.min(90, 45 + unit.items.length * 12);
  }

  return 35;
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
  if (isCarryLikeUnit(unit) && getUnitRange(unit) > 1) return false;

  return getUnitRange(unit) <= 1 || getTankinessScore(unit) >= 42;
}

function getRoleBalanceScore(units) {
  const frontlineCount = units.filter(isFrontlineUnit).length;
  const damageCount = units.filter(isCarryLikeUnit).length;
  const hasSupport = units.some((u) => /support|utility/i.test(u.role || ""));

  let score = 0;

  score += frontlineCount > 0 ? 22 : -42;
  score += frontlineCount >= 2 ? 14 : -12;
  score += frontlineCount >= 3 ? 10 : 0;
  score += damageCount > 0 ? 24 : -30;
  score += damageCount > 3 ? -Math.min((damageCount - 3) * 10, 28) : 0;
  score += hasSupport ? 8 : 0;

  const roles = new Set(units.map((u) => u.role).filter(Boolean));
  score += Math.min(roles.size * 4, 18);

  return score;
}

function getTraitOverlapCount(unit, traitNames) {
  return (unit.traits || []).filter((trait) => traitNames.has(trait)).length;
}

function getNonTargetCarryPenalty({ units, targetTrait, activeTraits }) {
  if (!targetTrait) return 0;

  const usefulTraits = new Set(
    activeTraits
      .filter(
        (trait) => trait.isActive && !trait.isUnique && trait.activeAt >= 2,
      )
      .map((trait) => trait.name),
  );

  return units.reduce((penalty, unit) => {
    const isTargetUnit = unit.traits?.includes(targetTrait);
    const sharedUsefulTraits = getTraitOverlapCount(unit, usefulTraits);
    const isCarry = isCarryLikeUnit(unit);

    if (isTargetUnit) return penalty;

    // יחידה שלא קשורה ל-target אבל כן מפעילה טרייט משלה בלבד
    if (sharedUsefulTraits <= 1) {
      return penalty + (isCarry ? 95 : 55);
    }

    // יחידה שלא target אבל באמת מחזקת כמה traits פעילים
    return penalty + (isCarry ? 35 : 15);
  }, 0);
}

function getStageFitScore(units, gameMode) {
  if (!gameMode) return 0;

  let score = 0;

  for (const unit of units) {
    if (unit.cost > gameMode.maxUnitCost) {
      score -= gameMode.expensiveUnitPenalty || 10;
    }

    if (unit.cost === 5 && gameMode.legendaryPenalty) {
      score -= gameMode.legendaryPenalty;
    }
  }

  return score;
}

function getTargetTraitScore({
  primaryCount,
  naturalPrimaryCount,
  targetCount,
  primaryActiveAt,
  isPrimaryUnique,
  specialPlan,
}) {
  if (!targetCount) return 0;

  let score = 0;

  const progressRatio = Math.min(primaryCount / targetCount, 1);

  score += progressRatio * 140;

  if (primaryCount >= targetCount) {
    score += 100;
  } else {
    score -= (targetCount - primaryCount) * 65;
  }

  if (primaryActiveAt) {
    score += isPrimaryUnique ? 20 : primaryActiveAt * 10;
  }

  if (naturalPrimaryCount > 0) {
    score += Math.min(naturalPrimaryCount * 8, 40);
  }

  if (specialPlan?.specialSources?.length) {
    score -= specialPlan.specialSources.length * 4;
  }

  if (specialPlan && specialPlan.isPossible === false) {
    score -= 999;
  }

  return score;
}

function getUnitRawCombatScore(unit) {
  const stats = unit.stats || {};

  return (
    Number(unit.carryScore || 0) * 0.9 +
    Number(unit.cost || 1) * 10 +
    Number(stats.hp || 0) / 45 +
    Number(stats.damage || 0) * 0.7 +
    Number(stats.attackSpeed || 0) * 18 +
    Number(stats.armor || 0) * 0.25 +
    Number(stats.magicResist || 0) * 0.25
  );
}

function getStarMultiplier(starLevel) {
  if (starLevel === 3) return 2.25;
  if (starLevel === 2) return 1.55;
  return 1;
}

function getThreeStarRealismMultiplier(unit) {
  const cost = Number(unit.cost || 1);

  if (cost === 1) return 1.0;
  if (cost === 2) return 0.82;
  if (cost === 3) return 0.55;
  if (cost === 4) return 0.08;
  return 0.02;
}

function getUpgradeValueScore({
  unit,
  targetTrait,
  carry,
  itemStats = {},
  itemSetStats = {},
  championMeta = {},
  unitUpgradeMeta = {},
}) {
  const cost = Number(unit.cost || 1);

  if (cost > 3) {
    return 0;
  }

  const isTargetUnit = targetTrait && unit.traits?.includes(targetTrait);
  const isChosenCarry = carry?.id === unit.id;
  const isCarryUnit = isCarryLikeUnit(unit);

  if (!isTargetUnit && !isChosenCarry && !isCarryUnit) {
    return 0;
  }

  const baseCombat = getUnitRawCombatScore(unit);
  const metaScore = getChampionMetaScore(unit, championMeta);
  const itemScore = getItemHolderScore(unit, itemStats, itemSetStats);

  const oneStarPower = baseCombat + metaScore * 0.5 + itemScore * 0.35;
  const threeStarPower = oneStarPower * getStarMultiplier(3);
  const realism = getThreeStarRealismMultiplier(unit);

  let score = threeStarPower * realism * 0.08;

  if (isChosenCarry) score += 24;
  if (isTargetUnit) score += 14;
  if (cost === 1) score += 10;
  if (cost === 2) score += 6;
  if (cost === 3) score -= 4;

  const meta = unitUpgradeMeta?.[unit.id] || unitUpgradeMeta?.[unit.apiName];

  if (meta) {
    score += Number(meta.scoreBonus || 0);

    if (Number(meta.recommendedStarLevel || 0) >= 3 && cost <= 3) {
      score += 10;
    }
  }

  return Math.round(score);
}

function scoreMetaBuild(build = {}) {
  const tierScore = tierToScore(build.tier || "C");
  const avgPlace = Number(build.avgPlace || 0);
  const winRate = Number(build.winRate || 0);
  const games = Number(build.games || 0);

  let score = Number(build.score || 0) || tierScore;
  if (avgPlace > 0) score += (4.5 - avgPlace) * 15;
  if (winRate > 0) score += winRate * 0.85;
  if (games > 0) score += Math.min(games / 180, 14);

  return Math.max(0, Math.min(125, score));
}

function getUnitBuildMetaEntry(unit, unitBuildMeta = {}) {
  return unitBuildMeta?.[unit.id] || unitBuildMeta?.[unit.apiName] || null;
}

function getBestMetaBuildForStar(unit, starLevel, unitBuildMeta = {}) {
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

function getRecommendedStarPlan(
  unit,
  { carry, targetTrait, unitUpgradeMeta = {}, unitBuildMeta = {} },
) {
  const cost = Number(unit.cost || 1);
  const meta = unitUpgradeMeta?.[unit.id] || unitUpgradeMeta?.[unit.apiName];

  const best2 = getBestMetaBuildForStar(unit, 2, unitBuildMeta);
  const best3 = getBestMetaBuildForStar(unit, 3, unitBuildMeta);
  const bestOverall = getBestOverallMetaBuild(unit, unitBuildMeta);

  if (meta?.recommendedStarLevel) {
    const starLevel = Math.max(
      1,
      Math.min(Number(meta.recommendedStarLevel), 3),
    );
    const build =
      starLevel === 3
        ? best3 || bestOverall
        : starLevel === 2
          ? best2 || bestOverall
          : bestOverall;

    return {
      starLevel,
      label: meta.label || meta.reason || "Meta recommendation",
      realism: Number(meta.realism ?? 1),
      source: meta.source || "unitUpgradeMeta",
      build,
      buildScore: build ? scoreMetaBuild(build) : Number(meta.buildScore || 0),
    };
  }

  const isCarry = carry?.id === unit.id;
  const isTargetUnit = targetTrait && unit.traits?.includes(targetTrait);
  const carryLike = isCarryLikeUnit(unit);

  if (cost === 1) {
    const useReroll = isCarry && best3 && scoreMetaBuild(best3) >= 78;
    return useReroll || (!best2 && (isCarry || isTargetUnit || carryLike))
      ? {
          starLevel: 3,
          label: "3★ reroll possible",
          realism: 0.95,
          source: "rules",
          build: best3 || bestOverall,
        }
      : {
          starLevel: 2,
          label: "2★ expected",
          realism: 1,
          source: "rules",
          build: best2 || bestOverall,
        };
  }

  if (cost === 2) {
    const useReroll = isCarry && best3 && scoreMetaBuild(best3) >= 76;
    return useReroll || (!best2 && (isCarry || isTargetUnit || carryLike))
      ? {
          starLevel: 3,
          label: "3★ viable reroll",
          realism: 0.82,
          source: "rules",
          build: best3 || bestOverall,
        }
      : {
          starLevel: 2,
          label: "2★ expected",
          realism: 1,
          source: "rules",
          build: best2 || bestOverall,
        };
  }

  if (cost === 3) {
    const useReroll = isCarry && best3 && scoreMetaBuild(best3) >= 80;
    return useReroll
      ? {
          starLevel: 3,
          label: "3★ possible carry",
          realism: 0.55,
          source: "rules",
          build: best3 || bestOverall,
        }
      : {
          starLevel: 2,
          label: "2★ expected",
          realism: 0.95,
          source: "rules",
          build: best2 || bestOverall,
        };
  }

  if (cost === 4) {
    return {
      starLevel: 2,
      label: best2 ? "2★ MetaTFT late-game" : "2★ realistic late-game",
      realism: 0.9,
      source: "rules",
      build: best2 || bestOverall,
    };
  }

  if (cost === 5) {
    return {
      starLevel: 2,
      label: best2 ? "2★ MetaTFT luxury" : "2★ luxury late-game",
      realism: 0.5,
      source: "rules",
      build: best2 || bestOverall,
    };
  }

  return {
    starLevel: 1,
    label: "1★ expected",
    realism: 1,
    source: "rules",
    build: bestOverall,
  };
}

function getStarPlanScore(unit, plan) {
  const base = getUnitRawCombatScore(unit);
  const starPower = base * getStarMultiplier(Number(plan.starLevel || 1));
  const buildScore = plan.build ? scoreMetaBuild(plan.build) * 0.24 : 0;

  return Math.round(starPower * Number(plan.realism || 1) * 0.06 + buildScore);
}

function buildStarPlans(
  units,
  { carry, targetTrait, unitUpgradeMeta = {}, unitBuildMeta = {} },
) {
  return Object.fromEntries(
    units.map((unit) => {
      const plan = getRecommendedStarPlan(unit, {
        carry,
        targetTrait,
        unitUpgradeMeta,
        unitBuildMeta,
      });

      return [
        unit.id,
        {
          ...plan,
          score:
            getStarPlanScore(unit, plan) +
            Number(unitUpgradeMeta?.[unit.id]?.scoreBonus || 0),
        },
      ];
    }),
  );
}

function getCompUnitKey(units = []) {
  return units
    .map((unit) => unit.id || unit.name)
    .filter(Boolean)
    .sort()
    .join("|");
}

function getPersonalHistoryScore(units, carry, matchHistory = []) {
  if (!Array.isArray(matchHistory) || !matchHistory.length) return 0;

  const key = getCompUnitKey(units);
  const carryId = carry?.id || null;

  const matchingEntries = matchHistory.filter((entry) => {
    const entryKey = getCompUnitKey(entry.units || []);
    if (!entryKey || entryKey !== key) return false;

    if (!carryId || !entry.carryId) return true;
    return entry.carryId === carryId;
  });

  if (!matchingEntries.length) return 0;

  const avgPlacement =
    matchingEntries.reduce(
      (sum, entry) => sum + Number(entry.placement || 8),
      0,
    ) / matchingEntries.length;
  const top4Rate =
    matchingEntries.filter((entry) => Number(entry.placement || 8) <= 4)
      .length / matchingEntries.length;
  const gamesWeight = Math.min(matchingEntries.length / 6, 1);

  const placementScore = (4.5 - avgPlacement) * 18;
  const top4Score = (top4Rate - 0.5) * 36;

  return Math.round((placementScore + top4Score) * gamesWeight);
}

function getFrontlineConstraintScore({ units, minFrontline = 0 }) {
  const required = Number(minFrontline || 0);
  const frontlineCount = units.filter((unit) => isFrontlineUnit(unit)).length;

  if (!required) {
    return Math.min(frontlineCount, 3) * 8;
  }

  const missing = Math.max(0, required - frontlineCount);
  const extra = Math.max(0, frontlineCount - required);

  let score = 0;

  // Hard reward for meeting the requested frontline.
  if (missing === 0) {
    score += 55;
  } else {
    score -= missing * 95;
  }

  // One extra front can be okay.
  // Too much extra frontline often means the comp loses damage/synergy.
  if (extra === 1) {
    score += 6;
  } else if (extra > 1) {
    score -= (extra - 1) * 34;
  }

  return score;
}

function getCarryTraitActivationScore({ carry, activeTraits, targetTrait }) {
  if (!carry) return 0;

  const carryTraits = carry.traits || [];
  let score = 0;

  for (const traitName of carryTraits) {
    const trait = activeTraits.find(
      (candidate) => candidate.name === traitName,
    );

    if (!trait || trait.isUnique) {
      continue;
    }

    const isTargetTrait = traitName === targetTrait;

    if (isTargetTrait) {
      if (trait.isActive) score += 18;
      continue;
    }

    // Secondary carry trait, e.g. Riven's Rogue.
    if (trait.isActive) {
      if (trait.activeAt >= 4) {
        score += 115;
      } else if (trait.activeAt >= 3) {
        score += 88;
      } else if (trait.activeAt >= 2) {
        score += 70;
      } else {
        score += 18;
      }
    } else {
      score -= 45;
    }
  }

  return score;
}

function getBreakpointWastePenalty({ activeTraits, targetTrait, carry }) {
  const carryTraitNames = new Set(carry?.traits || []);

  return activeTraits.reduce((penalty, trait) => {
    if (trait.isUnique) return penalty;
    if (!trait.isActive) return penalty;
    if (!trait.nextBreakpoint) return penalty;

    const count = Number(trait.count || 0);
    const activeAt = Number(trait.activeAt || 0);
    const next = Number(trait.nextBreakpoint || 0);

    if (!activeAt || !next) return penalty;

    // Example: Brawler 3 when activeAt is 2 and next is 4.
    // That 1 extra count currently gives no breakpoint value.
    const wastedCount = count > activeAt && count < next ? count - activeAt : 0;

    if (wastedCount <= 0) return penalty;

    if (trait.name === targetTrait) {
      return penalty + wastedCount * 4;
    }

    if (carryTraitNames.has(trait.name)) {
      return penalty + wastedCount * 8;
    }

    return penalty + wastedCount * 26;
  }, 0);
}

function getLateGameLowCostPenalty({
  units,
  carry,
  targetTrait,
  activeTraits,
  gameMode,
  minFrontline = 0,
}) {
  if (!gameMode || Number(gameMode.maxUnitCost || 0) < 4) {
    return 0;
  }

  const usefulTraits = new Set(
    activeTraits
      .filter(
        (trait) => trait.isActive && !trait.isUnique && trait.activeAt >= 2,
      )
      .map((trait) => trait.name),
  );

  const carryTraitNames = new Set(carry?.traits || []);
  const frontlineUnits = units.filter((unit) => isFrontlineUnit(unit));
  const frontlineNeeded = Number(minFrontline || 0);

  return units.reduce((penalty, unit) => {
    const cost = Number(unit.cost || 1);

    if (cost > 2) return penalty;
    if (carry?.id === unit.id) return penalty;

    const isTargetUnit = targetTrait && unit.traits?.includes(targetTrait);
    const isCarryTraitActivator = (unit.traits || []).some(
      (trait) => carryTraitNames.has(trait) && trait !== targetTrait,
    );
    const isFrontline = isFrontlineUnit(unit);
    const sharedUsefulTraits = getTraitOverlapCount(unit, usefulTraits);

    let unitPenalty = cost === 1 ? 42 : 18;

    // Target units may be required to hit the requested trait.
    if (isTargetUnit) unitPenalty -= 26;

    // Carry secondary activators are useful, but 1-cost activators should
    // still lose to stronger activators if available.
    if (isCarryTraitActivator) unitPenalty -= 14;

    // Frontline is useful only until the requested amount is met.
    if (isFrontline && frontlineUnits.length <= frontlineNeeded) {
      unitPenalty -= 18;
    }

    // Do not reward random soup too much.
    if (sharedUsefulTraits >= 2) unitPenalty -= 6;

    return penalty + Math.max(0, unitPenalty);
  }, 0);
}

function getLateGameTraitBotPenalty({
  units,
  carry,
  targetTrait,
  activeTraits,
  gameMode,
}) {
  if (!gameMode || Number(gameMode.maxUnitCost || 0) < 4) {
    return 0;
  }

  const carryTraitNames = new Set(carry?.traits || []);

  const activeTraitNames = new Set(
    activeTraits
      .filter((trait) => trait.isActive && !trait.isUnique)
      .map((trait) => trait.name),
  );

  return units.reduce((penalty, unit) => {
    const cost = Number(unit.cost || 1);

    if (cost > 2) return penalty;
    if (carry?.id === unit.id) return penalty;

    const traits = unit.traits || [];
    const isTargetUnit = targetTrait && traits.includes(targetTrait);

    const supportsCarryTrait = traits.some((trait) => {
      return trait !== targetTrait && carryTraitNames.has(trait);
    });

    const isFront = isFrontlineUnit(unit);

    const activeTraitLinks = traits.filter((trait) =>
      activeTraitNames.has(trait),
    ).length;

    /*
      Late board rule:
      Low-cost units are allowed if they are essential:
      - target trait unit
      - carry secondary trait activator, e.g. Rogue for Riven
      - real frontline
      Otherwise, they are trait bots.
    */
    const isEssential = isTargetUnit || supportsCarryTrait || isFront;

    if (isEssential) {
      return penalty;
    }

    let unitPenalty = cost === 1 ? 70 : 34;

    // If a 1-cost is opening multiple random 2-piece traits,
    // that is exactly trait soup, not real late-game power.
    if (activeTraitLinks >= 2) {
      unitPenalty += cost === 1 ? 35 : 18;
    }

    return penalty + unitPenalty;
  }, 0);
}

export function scoreComp(
  units,
  traitsConfig,
  metaComps,
  targetTrait,
  carry,
  options = {},
) {
  const {
    targetCount = null,
    specialPlan = {
      virtualTraits: {},
      extraBoardSlots: 0,
      specialSources: [],
      isPossible: true,
    },
    gameMode = null,
    minFrontline = 0,
    championMeta = {},
    traitMeta = {},
    itemStats = {},
    itemSetStats = {},
    unitUpgradeMeta = {},
    unitBuildMeta = {},
    matchHistory = [],
    carryProfiles = {},
    traitProfiles = {},
  } = options;

  const virtualTraits = specialPlan.virtualTraits || {};
  const activeTraits = evaluateTraits(units, traitsConfig, virtualTraits);

  const naturalCounts = countTraits(units);
  const fullCounts = countTraits(units, virtualTraits);

  const naturalPrimaryCount = targetTrait ? naturalCounts[targetTrait] || 0 : 0;
  const primaryCount = targetTrait ? fullCounts[targetTrait] || 0 : 0;

  const primaryTraitConfig = targetTrait
    ? traitsConfig.find((t) => t.name === targetTrait) || {
        name: targetTrait,
        breakpoints: [],
      }
    : {
        name: null,
        breakpoints: [],
      };

  const primaryBreakpoints = normalizeBreakpoints(primaryTraitConfig);
  const isPrimaryUnique = isUniqueTraitConfig(primaryTraitConfig);

  const primaryActiveAt = isPrimaryUnique
    ? primaryCount >= 1
      ? 1
      : 0
    : getBestActiveBreakpoint(primaryCount, primaryBreakpoints);

  const primaryNext = isPrimaryUnique
    ? null
    : getNextBreakpoint(primaryCount, primaryBreakpoints);

  const boardSlotsUsed =
    units.length + Number(specialPlan.extraBoardSlots || 0);

  const starPlans = buildStarPlans(units, {
    carry,
    targetTrait,
    unitUpgradeMeta,
    unitBuildMeta,
  });

  const targetTraitScore = getTargetTraitScore({
    primaryCount,
    naturalPrimaryCount,
    targetCount,
    primaryActiveAt,
    isPrimaryUnique,
    specialPlan,
  });

  const activeNonUniqueTraits = activeTraits.filter((trait) => {
    return trait.isActive && !trait.isUnique;
  });

  const carryTraitNamesForBonus = new Set(carry?.traits || []);

  const activeTraitCountBonus = activeNonUniqueTraits.reduce((sum, trait) => {
    if (trait.name === targetTrait) return sum + 8;
    if (carryTraitNamesForBonus.has(trait.name)) return sum + 12;

    // Random 2-piece traits are nice, but should not drive the comp.
    if (trait.activeAt >= 4) return sum + 10;
    if (trait.activeAt >= 3) return sum + 7;
    if (trait.activeAt >= 2) return sum + 3;

    return sum;
  }, 0);

  const meaningfulBreakpointBonus = activeNonUniqueTraits.reduce(
    (sum, trait) => {
      if (trait.name === targetTrait) return sum;

      const isCarryTrait = carry?.traits?.includes(trait.name);

      if (isCarryTrait) {
        if (trait.activeAt >= 4) return sum + 50;
        if (trait.activeAt >= 3) return sum + 38;
        if (trait.activeAt >= 2) return sum + 28;
      }

      // Non-carry random traits should help only a little.
      if (trait.activeAt >= 4) return sum + 18;
      if (trait.activeAt >= 3) return sum + 10;
      if (trait.activeAt >= 2) return sum + 4;

      return sum;
    },
    0,
  );

  const activatedTraitsScore = activeTraits.reduce((sum, trait) => {
    if (!trait.isActive) return sum;

    const depthScore = trait.isUnique
      ? 10
      : trait.activeAt >= 9
        ? 70
        : trait.activeAt >= 8
          ? 58
          : trait.activeAt >= 6
            ? 45
            : trait.activeAt >= 4
              ? 28
              : trait.activeAt >= 3
                ? 18
                : 10;

    const metaScore =
      getTraitMetaScore(trait.name, traitMeta, traitProfiles) * 0.34;
    const targetBonus = trait.name === targetTrait ? 45 : 0;

    const isCarryTrait = carry?.traits?.includes(trait.name);

    const secondaryTraitBonus =
      trait.name !== targetTrait && !trait.isUnique
        ? isCarryTrait
          ? trait.activeAt >= 3
            ? 26
            : trait.activeAt >= 2
              ? 18
              : 0
          : trait.activeAt >= 4
            ? 12
            : trait.activeAt >= 3
              ? 7
              : trait.activeAt >= 2
                ? 3
                : 0
        : 0;

    const nonTargetUniquePenalty =
      trait.isUnique && trait.name !== targetTrait ? 18 : 0;

    return (
      sum +
      depthScore +
      metaScore +
      targetBonus +
      secondaryTraitBonus -
      nonTargetUniquePenalty
    );
  }, 0);

  const championMetaScore = units.reduce((sum, unit) => {
    return sum + getChampionMetaScore(unit, championMeta) * 0.55;
  }, 0);

  const itemHolderScore = units.reduce((sum, unit) => {
    const carryMultiplier = carry?.id === unit.id ? 1.45 : 0.06;
    return (
      sum + getItemHolderScore(unit, itemStats, itemSetStats) * carryMultiplier
    );
  }, 0);

  const upgradeValueScore = units.reduce((sum, unit) => {
    return (
      sum +
      getUpgradeValueScore({
        unit,
        targetTrait,
        carry,
        itemStats,
        itemSetStats,
        championMeta,
        unitUpgradeMeta,
      })
    );
  }, 0);

  const starPlanScore = Object.values(starPlans).reduce((sum, plan) => {
    return sum + Number(plan.score || 0);
  }, 0);

  const personalHistoryScore = getPersonalHistoryScore(
    units,
    carry,
    matchHistory,
  );

  const itemPlan = getCarryItemPlan({
    carry,
    carryProfiles,
    itemStats,
    itemSetStats,
  });

  const carryScore = carry
    ? getChampionMetaScore(carry, championMeta) * 1.0 +
      (carry.carryScore || 0) * 0.6 +
      itemPlan.score * 0.55
    : 0;

  const carryFit = getCarryTraitFitScore({
    carry,
    activeTraits,
    carryProfiles,
    traitProfiles,
    traitMeta,
  });

  const carryTraitFitScore = carryFit.score * 1.65;
  const carryTraitActivationScore = getCarryTraitActivationScore({
    carry,
    activeTraits,
    targetTrait,
  });
  const roleBalanceScore = getRoleBalanceScore(units);
  const frontlineConstraintScore = getFrontlineConstraintScore({
    units,
    minFrontline,
  });
  const lateGameLowCostPenalty = getLateGameLowCostPenalty({
    units,
    carry,
    targetTrait,
    activeTraits,
    gameMode,
    minFrontline,
  });

  const lateGameTraitBotPenalty = getLateGameTraitBotPenalty({
    units,
    carry,
    targetTrait,
    activeTraits,
    gameMode,
  });

  const breakpointWastePenalty = getBreakpointWastePenalty({
    activeTraits,
    targetTrait,
    carry,
  });

  const stageFitScore = getStageFitScore(units, gameMode);

  const unitIds = new Set(units.map((unit) => unit.id));

  const metaShellScore = (metaComps || []).reduce((best, comp) => {
    const overlap = (comp.units || []).filter((id) => unitIds.has(id)).length;
    const ratio = overlap / Math.max((comp.units || []).length, 1);
    const compTier = tierToScore(comp.tier || "B");
    const shellBonus = ratio >= 0.75 ? 34 : ratio >= 0.55 ? 18 : 0;

    return Math.max(best, ratio * compTier * 0.48 + shellBonus);
  }, 0);

  const deadTraitPenalty = activeTraits
    .filter((t) => !t.isActive && t.count === 1)
    .reduce((sum, trait) => {
      if (trait.name === targetTrait) return sum;
      return sum + (trait.isUnique ? 12 : 8);
    }, 0);

  const uniqueTraitNoisePenalty =
    activeTraits.filter((trait) => {
      return trait.isUnique && trait.name !== targetTrait;
    }).length * 18;

  const tooManyFiveCostPenalty =
    units.filter((u) => u.cost === 5).length > 3 ? 18 : 0;
  const nonTargetCarryPenalty = getNonTargetCarryPenalty({
    units,
    targetTrait,
    activeTraits,
  });
  const impossiblePenalty = boardSlotsUsed > 10 ? 999 : 0;

  const score = Math.round(
    targetTraitScore +
      activatedTraitsScore +
      activeTraitCountBonus +
      meaningfulBreakpointBonus +
      championMetaScore +
      itemHolderScore +
      upgradeValueScore +
      starPlanScore +
      carryScore +
      carryTraitFitScore +
      carryTraitActivationScore +
      roleBalanceScore +
      frontlineConstraintScore +
      stageFitScore +
      metaShellScore +
      personalHistoryScore -
      breakpointWastePenalty -
      lateGameLowCostPenalty -
      lateGameTraitBotPenalty -
      uniqueTraitNoisePenalty -
      deadTraitPenalty -
      tooManyFiveCostPenalty -
      nonTargetCarryPenalty -
      impossiblePenalty,
  );

  const reasons = [];

  const warnings = [];

  if (lateGameTraitBotPenalty > 0) {
    warnings.push(
      `Late-game trait-bot penalty applied: ${lateGameTraitBotPenalty} points. Low-cost units that only open random small traits are being discounted.`,
    );
  }

  if (lateGameLowCostPenalty > 0) {
    warnings.push(
      `Late-game low-cost filler penalty applied: ${lateGameLowCostPenalty} points. The solver is discounting weak 1/2-cost units unless they are required.`,
    );
  }

  if (breakpointWastePenalty > 0) {
    warnings.push(
      "Some traits have extra units that do not reach the next breakpoint, so the score penalized wasted trait count.",
    );
  }

  if (targetCount) {
    reasons.push(
      `${targetTrait} target is ${targetCount}; this board reaches ${primaryCount}.`,
    );
  }

  if (primaryActiveAt) {
    reasons.push(
      isPrimaryUnique
        ? `${targetTrait} unique trait is active.`
        : `${targetTrait} is active at ${primaryActiveAt} with ${primaryCount} total count.`,
    );
  }

  if (carry) {
    reasons.push(`${carry.name} is the item focus.`);
  }

  if (carryTraitActivationScore > 0 && carry) {
    reasons.push(
      `${carry.name}'s own traits are supported, increasing carry value.`,
    );
  }

  if (upgradeValueScore > 0) {
    reasons.push(
      "Low-cost upgrade value is included, so strong 1/2/3-cost units can beat random expensive goodstuff when they are realistic reroll candidates.",
    );
  }

  if (starPlanScore > 0) {
    reasons.push(
      "Star plans are included in the score, so realistic 2★/3★ upgrade paths affect board strength.",
    );
  }

  if (personalHistoryScore !== 0) {
    reasons.push(
      `Personal match history adjusted this comp by ${personalHistoryScore > 0 ? "+" : ""}${personalHistoryScore} points.`,
    );
  }
  reasons.push(
    ...explainCarryFit({
      carry,
      carryFit,
      itemPlan,
    }),
  );

  if (activeNonUniqueTraits.length >= 5) {
    reasons.push(
      `${activeNonUniqueTraits.length} non-unique active traits are enabled, giving this board strong synergy density.`,
    );
  }

  if (meaningfulBreakpointBonus > 0) {
    reasons.push(
      "The board has meaningful secondary breakpoints instead of relying on random one-off traits.",
    );
  }

  if (nonTargetCarryPenalty > 0) {
    reasons.push(
      "The solver now discounts off-trait filler carries unless they share useful active traits.",
    );
  }

  if (specialPlan.specialSources?.length) {
    reasons.push(
      `${specialPlan.specialSources.length} special source${specialPlan.specialSources.length > 1 ? "s" : ""} used.`,
    );
  }

  if (carryTraitActivationScore < 0 && carry) {
    const unsupported = (carry.traits || [])
      .filter((trait) => trait !== targetTrait)
      .join(" / ");

    if (unsupported) {
      warnings.push(
        `${carry.name} has an unsupported secondary trait; consider activating ${unsupported} if possible.`,
      );
    }
  }

  if (boardSlotsUsed > 10) {
    warnings.push(`Illegal board: uses ${boardSlotsUsed}/10 slots.`);
  }

  if (specialPlan.isPossible === false) {
    warnings.push(
      `${targetTrait} ${targetCount} is not reachable with the current units and allowed special sources.`,
    );
  }

  if (specialPlan.extraBoardSlots > 0) {
    warnings.push(
      `Special sources consume ${specialPlan.extraBoardSlots} extra board slot${specialPlan.extraBoardSlots > 1 ? "s" : ""}.`,
    );
  }

  if (gameMode && units.some((u) => u.cost > gameMode.maxUnitCost)) {
    warnings.push(
      `${gameMode.label} mode prefers max ${gameMode.maxUnitCost}-cost units.`,
    );
  }

  if (!units.some((u) => isFrontlineUnit(u))) {
    warnings.push(
      "Low frontline count; consider adding a real tank/frontline unit.",
    );
  }

  if (nonTargetCarryPenalty > 0) {
    warnings.push(
      "One or more carry-like filler units do not directly support the selected trait goal.",
    );
  }

  if (primaryNext) {
    warnings.push(
      `${targetTrait} next breakpoint is ${primaryNext}; current count is ${primaryCount}.`,
    );
  }

  if (carryFit.badFits?.length) {
    warnings.push(
      `Some active traits are weak fits for ${carry?.name}: ${carryFit.badFits.map((t) => t.name).join(", ")}.`,
    );
  }

  return {
    score,
    starPlans,
    personalHistoryScore,
    activeTraits,
    boardSlotsUsed,
    specialSources: specialPlan.specialSources || [],
    carryFit,
    itemPlan,
    primaryTrait: {
      name: targetTrait,
      count: primaryCount,
      naturalCount: naturalPrimaryCount,
      specialCount: Number(virtualTraits[targetTrait] || 0),
      targetCount,
      activeAt: primaryActiveAt,
      nextBreakpoint: primaryNext,
      isUnique: isPrimaryUnique,
    },
    emblemPlan: specialPlan.specialSources?.some((s) => s.type === "EMBLEM")
      ? {
          trait: targetTrait,
          count: specialPlan.specialSources.filter((s) => s.type === "EMBLEM")
            .length,
        }
      : null,
    reasons,
    warnings,
  };
}
