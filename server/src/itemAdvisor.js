import { getCarryProfile } from "./carryFit.js";

const BASE_COMPONENTS = new Set([
  "B.F. Sword",
  "Recurve Bow",
  "Needlessly Large Rod",
  "Tear of the Goddess",
  "Chain Vest",
  "Negatron Cloak",
  "Giant's Belt",
  "Sparring Gloves",
  "Spatula",
  "Frying Pan",
]);

function normalizeKey(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function countValues(values = []) {
  return values.reduce((map, value) => {
    map[value] = (map[value] || 0) + 1;
    return map;
  }, {});
}

function canCraftWithCounts(components = [], selectedCounts = {}) {
  const needed = countValues(components);

  return Object.entries(needed).every(([component, count]) => {
    return (selectedCounts[component] || 0) >= count;
  });
}

function hasOnlyNormalComponents(components = []) {
  return components.length === 2 && components.every((component) => BASE_COMPONENTS.has(component));
}

function itemText(name = "", details = {}) {
  return `${name} ${details.description || ""} ${(details.tags || []).join(" ")}`.toLowerCase();
}

function classifyItem(name = "", details = {}) {
  const text = itemText(name, details);
  const components = details.components || [];
  const tags = new Set();

  if (/rabadon|jeweled|archangel|blue buff|shojin|nashor|morello|ionic|adaptive|crownguard|hextech gunblade/.test(text)) tags.add("ap");
  if (/blue buff|shojin|archangel|adaptive|mana/.test(text) || components.includes("Tear of the Goddess")) tags.add("mana");
  if (/infinity|last whisper|deathblade|giant slayer|guinsoo|runaan|red buff|edge of night|bloodthirster|sterak|titan|hand of justice|quicksilver/.test(text)) tags.add("ad");
  if (/attack speed|guinsoo|runaan|red buff|nashor|statikk/.test(text) || components.includes("Recurve Bow")) tags.add("attackSpeed");
  if (/crit|infinity|jeweled|hand of justice|guardbreaker/.test(text) || components.includes("Sparring Gloves")) tags.add("crit");
  if (/warmog|gargoyle|dragon|bramble|redemption|protector|steadfast|sunfire|evenshroud|adaptive|crownguard|vow|cloak|armor|health|shield/.test(text)) tags.add("tank");
  if (/bloodthirster|hand of justice|edge of night|sterak|titan|quicksilver|omnivamp|shield/.test(text)) tags.add("survivability");
  if (/last whisper|statikk|shiv|ionic|evenshroud|sunfire|red buff|morello|guardbreaker|shred|sunder|burn|wound/.test(text)) tags.add("utility");
  if (/emblem/.test(text) || components.includes("Spatula") || components.includes("Frying Pan")) tags.add("emblem");

  if (components.includes("B.F. Sword")) tags.add("ad");
  if (components.includes("Needlessly Large Rod")) tags.add("ap");
  if (components.includes("Chain Vest") || components.includes("Negatron Cloak") || components.includes("Giant's Belt")) tags.add("tank");

  return [...tags];
}

function scoreItemSet(set = {}, itemName = "", orderIndex = 0) {
  const items = Array.isArray(set.items) ? set.items.filter(Boolean) : [];
  if (!items.includes(itemName)) return 0;

  const avgPlace = Number(set.avgPlace ?? set.averagePlacement ?? 0);
  const winRate = Number(set.winRate ?? set.winrate ?? 0);
  const games = Number(set.games ?? set.count ?? 0);
  const tier = String(set.tier || "").toUpperCase();

  let score = 48;
  if (avgPlace > 0) score += Math.max(0, 5 - avgPlace) * 14;
  if (winRate > 0) score += winRate * 0.45;
  if (games > 0) score += Math.min(14, Math.log10(games + 1) * 4);
  if (tier === "S") score += 18;
  if (tier === "A") score += 10;
  if (tier === "B") score += 4;
  score += Math.max(0, 14 - orderIndex * 3);

  return score;
}

function getItemSetFitForUnit(unit, itemName, itemSetStats = {}) {
  if (!unit) return { score: 0, bestSet: null };

  const sets = [
    ...(Array.isArray(itemSetStats?.[unit.id]) ? itemSetStats[unit.id] : []),
    ...(Array.isArray(itemSetStats?.[unit.apiName]) ? itemSetStats[unit.apiName] : []),
  ];

  let bestScore = 0;
  let bestSet = null;

  sets.forEach((set, index) => {
    const score = scoreItemSet(set, itemName, index);
    if (score > bestScore) {
      bestScore = score;
      bestSet = set;
    }
  });

  return { score: bestScore, bestSet };
}

function getUnitText(unit = {}) {
  return `${unit.name || ""} ${unit.role || ""} ${(unit.traits || []).join(" ")} ${unit.ability?.desc || ""}`.toLowerCase();
}

function isFrontlineUnit(unit = {}) {
  const text = getUnitText(unit);
  const range = Number(unit?.stats?.range ?? unit?.range ?? 1);

  if (/tank|front|brawler|bastion|bruiser|vanguard|warden|guardian|sentinel|juggernaut|defender/.test(text)) return true;
  return range <= 1 && Number(unit?.stats?.hp || 0) >= 650;
}

function getBestFrontlineHolder(units = []) {
  const frontliners = units.filter(isFrontlineUnit);
  if (!frontliners.length) return null;

  return [...frontliners].sort((a, b) => {
    const aHp = Number(a?.stats?.hp || 0);
    const bHp = Number(b?.stats?.hp || 0);
    return Number(b.cost || 0) - Number(a.cost || 0) || bHp - aHp || String(a.name).localeCompare(String(b.name));
  })[0];
}

function getBestUtilityHolder(units = [], carry) {
  const nonCarryBackline = units.filter((unit) => unit?.id !== carry?.id && Number(unit?.stats?.range ?? unit?.range ?? 1) >= 3);
  return nonCarryBackline[0] || carry || units[0] || null;
}

function getCarryBestItems(carry, itemSetStats = {}, itemStats = {}) {
  if (!carry) return [];

  const sets = [
    ...(Array.isArray(itemSetStats?.[carry.id]) ? itemSetStats[carry.id] : []),
    ...(Array.isArray(itemSetStats?.[carry.apiName]) ? itemSetStats[carry.apiName] : []),
  ];

  const itemScores = new Map();

  sets.slice(0, 8).forEach((set, setIndex) => {
    for (const item of set.items || []) {
      const current = itemScores.get(item) || { item, score: 0, sets: 0 };
      current.score += scoreItemSet(set, item, setIndex);
      current.sets += 1;
      itemScores.set(item, current);
    }
  });

  const legacy = itemStats?.[carry.id] || itemStats?.[carry.apiName] || [];
  legacy.forEach((entry, index) => {
    const name = typeof entry === "string" ? entry : entry.name || entry.item || entry.itemName;
    if (!name) return;
    const current = itemScores.get(name) || { item: name, score: 0, sets: 0 };
    current.score += Number(entry.score || 60) + Math.max(0, 10 - index * 2);
    current.sets += 1;
    itemScores.set(name, current);
  });

  if (!itemScores.size && Array.isArray(carry.items)) {
    carry.items.forEach((item, index) => {
      itemScores.set(item, { item, score: 70 - index * 5, sets: 1 });
    });
  }

  return [...itemScores.values()].sort((a, b) => b.score - a.score).slice(0, 9);
}

function chooseTargetHolder({ itemTags = [], carry, units = [] }) {
  const tags = new Set(itemTags);

  if (tags.has("tank") && !tags.has("ap") && !tags.has("ad")) {
    return { unit: getBestFrontlineHolder(units), role: "frontline" };
  }

  if (tags.has("utility") && !tags.has("ad") && !tags.has("ap")) {
    return { unit: getBestUtilityHolder(units, carry), role: "utility" };
  }

  return { unit: carry || units[0] || null, role: "carry" };
}

function addReason(reasons, condition, text) {
  if (condition) reasons.push(text);
}

function scoreCraftableItem({
  itemName,
  details,
  units,
  carry,
  carryProfiles,
  itemSetStats,
  itemStats,
  minFrontline,
}) {
  const itemTags = classifyItem(itemName, details);
  const tags = new Set(itemTags);
  const profile = getCarryProfile(carry, carryProfiles) || {};
  const profileText = `${profile.archetype || ""} ${profile.damageType || ""} ${(profile.scalesWith || []).join(" ")} ${(profile.needs || []).join(" ")}`.toLowerCase();
  const reasons = [];
  let score = 45;

  const carryItemFit = getItemSetFitForUnit(carry, itemName, itemSetStats);
  if (carryItemFit.score > 0) {
    score += Math.min(95, carryItemFit.score * 0.95);
    reasons.push(`${itemName} appears in ${carry?.name || "the carry"}'s best item data.`);
  }

  if (tags.has("ap") && /magic|caster|abilitypower|spelldamage|mana/.test(profileText)) {
    score += 38;
    reasons.push("Fits an AP/caster carry profile.");
  }

  if ((tags.has("ad") || tags.has("attackSpeed") || tags.has("crit")) && /physical|ad|attackdamage|attackspeed|crit/.test(profileText)) {
    score += 38;
    reasons.push("Fits an AD/attack-speed carry profile.");
  }

  if (tags.has("mana") && /caster|mana|castfrequency|spell/.test(profileText)) {
    score += 25;
    reasons.push("Mana item helps the carry cast more often.");
  }

  if (tags.has("survivability") && /melee|dueling|survivability/.test(profileText)) {
    score += 28;
    reasons.push("Melee/survivability scaling makes this safer to slam.");
  }

  const frontlineCount = units.filter(isFrontlineUnit).length;
  if (tags.has("tank")) {
    score += 18;
    addReason(reasons, frontlineCount <= Number(minFrontline || 2), "Tank item helps your frontline buy time for the carry.");
  }

  if (tags.has("utility")) {
    score += 18;
    reasons.push("Utility shred/burn/anti-heal is rarely wasted and helps the whole board.");
  }

  if (tags.has("emblem")) {
    score += 8;
    reasons.push("Emblem item can be strong only if it activates a meaningful breakpoint.");
  }

  const { unit: holder, role } = chooseTargetHolder({ itemTags, carry, units });

  if (holder?.id === carry?.id) {
    score += 10;
  }

  if (score < 72 && tags.has("emblem")) {
    reasons.push("Do not slam this blindly; check if it completes your target trait breakpoint.");
  }

  return {
    item: {
      name: itemName,
      iconUrl: details.iconUrl,
      components: details.components || [],
      tags: itemTags,
    },
    score: Math.round(score),
    holder: holder
      ? {
          id: holder.id,
          name: holder.name,
          role,
        }
      : null,
    priority: score >= 120 ? "Slam now" : score >= 95 ? "Strong build" : score >= 76 ? "Playable" : "Low priority",
    reasons: reasons.slice(0, 4),
  };
}

export function getItemBuildAdvice({
  itemCatalog = {},
  components = [],
  units = [],
  carry = null,
  carryProfiles = {},
  itemSetStats = {},
  itemStats = {},
  minFrontline = 0,
} = {}) {
  const selectedCounts = countValues(components);
  const carryBestItems = getCarryBestItems(carry, itemSetStats, itemStats).map((entry) => {
    const details = itemCatalog?.[entry.item] || {};
    const needed = details.components || [];

    return {
      name: entry.item,
      score: Math.round(entry.score),
      iconUrl: details.iconUrl,
      components: needed,
      canBuildNow: needed.length > 0 && canCraftWithCounts(needed, selectedCounts),
    };
  });

  const craftable = Object.entries(itemCatalog || {})
    .filter(([, details]) => hasOnlyNormalComponents(details.components || []))
    .filter(([, details]) => canCraftWithCounts(details.components || [], selectedCounts))
    .map(([itemName, details]) => scoreCraftableItem({
      itemName,
      details,
      units,
      carry,
      carryProfiles,
      itemSetStats,
      itemStats,
      minFrontline,
    }))
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));

  const byName = new Map();
  for (const entry of craftable) {
    const key = normalizeKey(entry.item.name);
    if (!byName.has(key) || entry.score > byName.get(key).score) {
      byName.set(key, entry);
    }
  }

  const recommendations = [...byName.values()].slice(0, 8);
  const best = recommendations[0] || null;
  const notes = [];

  if (!components.length) {
    notes.push("Click your components first; then this card will show what to slam for the selected comp.");
  } else if (!recommendations.length) {
    notes.push("Your selected components do not complete a normal item yet.");
  } else if (best) {
    notes.push(`Best build from current components: ${best.item.name}${best.holder?.name ? ` on ${best.holder.name}` : ""}.`);
  }

  const buildableCarryItems = carryBestItems.filter((item) => item.canBuildNow).slice(0, 3);
  if (buildableCarryItems.length) {
    notes.push(`You can build carry item data now: ${buildableCarryItems.map((item) => item.name).join(", ")}.`);
  }

  const awkwardComponents = Object.entries(selectedCounts)
    .filter(([component]) => BASE_COMPONENTS.has(component))
    .map(([component, count]) => `${component}${count > 1 ? ` x${count}` : ""}`);

  return {
    components: awkwardComponents,
    carry: carry ? { id: carry.id, name: carry.name } : null,
    carryBestItems,
    recommendations,
    notes,
  };
}
