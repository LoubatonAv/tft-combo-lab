import { tierToScore } from "./rules.js";

function asSet(values = []) {
  return new Set(values || []);
}

function intersectCount(a = [], b = []) {
  const bSet = asSet(b);
  return (a || []).filter((x) => bSet.has(x)).length;
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferCarryProfile(carry) {
  if (!carry) return null;

  const role = String(carry.role || "").toLowerCase();
  const items = (carry.items || []).join(" ").toLowerCase();
  const traits = carry.traits || [];

  const isCaster =
    /ap|caster|mage|magic|spell/.test(role) ||
    /shojin|blue buff|jeweled|rabadon|archangel|nashor/.test(items);

  const isAd =
    /ad|physical|sniper|marksman|ranged/.test(role) ||
    /infinity|last whisper|deathblade|guinsoo/.test(items);

  const isMelee =
    /melee|fighter|bruiser|duelist|assassin/.test(role) ||
    /bloodthirster|titan|sterak|hand of justice/.test(items);

  const isTank =
    /tank|front|brawler|bastion|vanguard/.test(role) ||
    /warmog|gargoyle|dragon|bramble/.test(items);

  if (isTank) {
    return {
      archetype: "frontline-tank",
      damageType: "utility",
      scalesWith: ["health", "tank", "survivability", "frontline"],
      needs: ["teamAmp"],
      preferredTraits: uniq([...traits, "Brawler", "Bastion", "Vanguard"]),
      preferredItems: carry.items || [
        "Warmog's Armor",
        "Gargoyle Stoneplate",
        "Dragon's Claw",
      ],
      badTraitTags: [],
    };
  }

  if (isCaster) {
    return {
      archetype: "mana-caster",
      damageType: "magic",
      scalesWith: [
        "mana",
        "abilityPower",
        "spellDamage",
        "castFrequency",
        "magic",
      ],
      needs: ["frontline", "timeToCast", "survivability"],
      preferredTraits: uniq([
        ...traits,
        "Conduit",
        "Oracle",
        "Voyager",
        "Dark Star",
        "Brawler",
      ]),
      preferredItems: carry.items || [
        "Spear of Shojin",
        "Jeweled Gauntlet",
        "Rabadon's Deathcap",
      ],
      badTraitTags: ["physicalOnly", "attackDamageOnly"],
    };
  }

  if (isAd || isMelee) {
    return {
      archetype: isMelee ? "melee-ad-carry" : "ad-ranged-carry",
      damageType: "physical",
      scalesWith: [
        "attackDamage",
        "attackSpeed",
        "crit",
        "physicalDamage",
        "damageAmp",
      ],
      needs: isMelee
        ? ["survivability", "frontline", "dueling"]
        : ["frontline", "timeToCast"],
      preferredTraits: uniq([
        ...traits,
        "Sniper",
        "Marauder",
        "Rogue",
        "Challenger",
        "Brawler",
      ]),
      preferredItems: carry.items || [
        "Infinity Edge",
        "Last Whisper",
        "Bloodthirster",
      ],
      badTraitTags: ["manaOnly"],
    };
  }

  return {
    archetype: "generic-carry",
    damageType: "mixed",
    scalesWith: ["damageAmp", "teamAmp", "tempo"],
    needs: ["frontline", "timeToCast"],
    preferredTraits: uniq([...traits]),
    preferredItems: carry.items || [],
    badTraitTags: [],
  };
}

export function getCarryProfile(carry, carryProfiles = {}) {
  if (!carry) return null;

  return (
    carryProfiles[carry.id] || carry.carryProfile || inferCarryProfile(carry)
  );
}

export function getTraitProfile(traitName, traitProfiles = {}, traitMeta = {}) {
  return {
    ...(traitProfiles[traitName] || {}),
    ...(traitMeta[traitName] || {}),
  };
}

export function getTraitHelpScoreForCarry({
  traitName,
  activeAt = 0,
  isUnique = false,
  carry,
  carryProfiles = {},
  traitProfiles = {},
  traitMeta = {},
}) {
  const profile = getCarryProfile(carry, carryProfiles);
  const traitProfile = getTraitProfile(traitName, traitProfiles, traitMeta);

  if (!profile) return 0;

  const tags = traitProfile.tags || [];
  const scalesWith = profile.scalesWith || [];
  const needs = profile.needs || [];
  const preferredTraits = profile.preferredTraits || [];
  const badTraitTags = profile.badTraitTags || [];

  let score = 0;

  const scaleMatches = intersectCount(tags, scalesWith);
  const needMatches = intersectCount(tags, needs);
  const badMatches = intersectCount(tags, badTraitTags);

  score += scaleMatches * 24;
  score += needMatches * 18;

  if (preferredTraits.includes(traitName)) {
    score += 40;
  }

  if (traitProfile.tier) {
    score += tierToScore(traitProfile.tier) * 0.28;
  }

  if (traitProfile.score) {
    score += Number(traitProfile.score) * 0.32;
  }

  if (activeAt >= 6) score += 32;
  else if (activeAt >= 4) score += 22;
  else if (activeAt >= 3) score += 16;
  else if (activeAt >= 2) score += 9;

  if (isUnique && !preferredTraits.includes(traitName)) {
    score -= 20;
  }

  score -= badMatches * 35;

  return Math.round(score);
}

export function getCarryTraitFitScore({
  carry,
  activeTraits,
  carryProfiles = {},
  traitProfiles = {},
  traitMeta = {},
}) {
  if (!carry) {
    return {
      score: 0,
      helpfulTraits: [],
      badFits: [],
    };
  }

  const helpfulTraits = [];
  const badFits = [];

  let score = 0;

  for (const trait of activeTraits || []) {
    if (!trait.isActive) continue;

    const traitScore = getTraitHelpScoreForCarry({
      traitName: trait.name,
      activeAt: trait.activeAt,
      isUnique: trait.isUnique,
      carry,
      carryProfiles,
      traitProfiles,
      traitMeta,
    });

    score += traitScore;

    if (traitScore >= 35) {
      helpfulTraits.push({
        name: trait.name,
        score: traitScore,
        activeAt: trait.activeAt,
        isUnique: trait.isUnique,
      });
    }

    if (traitScore < -5) {
      badFits.push({
        name: trait.name,
        score: traitScore,
      });
    }
  }

  helpfulTraits.sort((a, b) => b.score - a.score);

  return {
    score: Math.round(score),
    helpfulTraits,
    badFits,
  };
}

export function getChampionFitToCarry({
  champion,
  carry,
  carryProfiles = {},
  traitProfiles = {},
  traitMeta = {},
}) {
  if (!champion || !carry) return 0;

  const profile = getCarryProfile(carry, carryProfiles);

  if (!profile) return 0;

  let score = 0;

  for (const traitName of champion.traits || []) {
    score +=
      getTraitHelpScoreForCarry({
        traitName,
        activeAt: 2,
        isUnique: false,
        carry,
        carryProfiles,
        traitProfiles,
        traitMeta,
      }) * 0.5;
  }

  if (champion.id === carry.id) {
    score += 120;
  }

  return Math.round(score);
}

function getBestItemSetForCarry(carry, itemSetStats = {}) {
  const sets = itemSetStats?.[carry?.id] || itemSetStats?.[carry?.apiName] || [];

  if (!Array.isArray(sets) || !sets.length) return null;

  return [...sets]
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
}

export function getCarryItemPlan({
  carry,
  carryProfiles = {},
  itemStats = {},
  itemSetStats = {},
}) {
  if (!carry) {
    return {
      items: [],
      source: "none",
      score: 0,
    };
  }

  const bestSet = getBestItemSetForCarry(carry, itemSetStats);

  if (bestSet) {
    const score =
      Number(bestSet.score || 0) ||
      tierToScore(bestSet.tier) +
        Number(bestSet.winRate || 0) * 1.8 -
        Number(bestSet.avgPlace || 4.5) * 10 +
        Math.min(Number(bestSet.games || 0) / 100, 14);

    return {
      items: bestSet.items.slice(0, 3),
      source: bestSet.source || "itemSetStats",
      score,
      winRate: bestSet.winRate ?? null,
      avgPlace: bestSet.avgPlace ?? null,
      games: bestSet.games ?? null,
      tier: bestSet.tier || null,
    };
  }

  const stats = itemStats[carry.id];

  if (Array.isArray(stats) && stats.length) {
    const sorted = [...stats].sort((a, b) => {
      return (
        Number(b.score || 0) - Number(a.score || 0) ||
        tierToScore(b.tier) - tierToScore(a.tier)
      );
    });

    return {
      items: sorted.slice(0, 3).map((item) => item.item || item.name),
      source: "itemStats",
      score: sorted
        .slice(0, 3)
        .reduce(
          (sum, item) => sum + Number(item.score || tierToScore(item.tier)),
          0,
        ),
    };
  }

  const profile = getCarryProfile(carry, carryProfiles);

  if (profile?.preferredItems?.length) {
    return {
      items: profile.preferredItems.slice(0, 3),
      source: "carryProfile",
      score: 75,
    };
  }

  if (carry.items?.length) {
    return {
      items: carry.items.slice(0, 3),
      source: "champions.json",
      score: 55,
    };
  }

  return {
    items: [],
    source: "missing",
    score: 0,
  };
}

export function explainCarryFit({ carry, carryFit, itemPlan }) {
  const lines = [];

  if (!carry) return lines;

  if (carryFit?.helpfulTraits?.length) {
    lines.push(
      `${carry.name} is supported by ${carryFit.helpfulTraits
        .slice(0, 5)
        .map((t) => `${t.name}${t.activeAt ? ` ${t.activeAt}` : ""}`)
        .join(", ")}.`,
    );
  }

  if (itemPlan?.items?.length) {
    const statsText =
      itemPlan.winRate != null
        ? ` (${Number(itemPlan.winRate).toFixed(2)}% win rate${
            itemPlan.avgPlace != null ? `, ${Number(itemPlan.avgPlace).toFixed(2)} avg place` : ""
          })`
        : "";

    lines.push(
      `${carry.name}'s suggested build: ${itemPlan.items.join(", ")}${statsText}.`,
    );
  }

  return lines;
}
