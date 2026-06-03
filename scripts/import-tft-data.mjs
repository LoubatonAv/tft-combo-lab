import fs from "fs/promises";
import path from "path";

const URL = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json";

const OUT_CHAMPIONS = path.resolve("server/data/champions.json");
const OUT_TRAITS = path.resolve("server/data/traits.json");
const OUT_DEBUG = path.resolve("server/data/import-debug.json");

const SET_NUMBER = 17;

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cleanName(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function assetToUrl(assetPath) {
  if (!assetPath) return null;

  const clean = String(assetPath)
    .replace(/\\/g, "/")
    .replace(/^ASSETS\//i, "assets/")
    .replace(/\.tex$/i, ".png")
    .toLowerCase();

  return `https://raw.communitydragon.org/latest/game/${clean}`;
}

function getSetsArray(data) {
  const setsArray = Array.isArray(data.sets)
    ? data.sets
    : Object.values(data.sets || {});

  const setDataArray = Array.isArray(data.setData)
    ? data.setData
    : Object.values(data.setData || {});

  return [...setsArray, ...setDataArray];
}

function getSet(data) {
  const allSets = getSetsArray(data);

  const found = allSets.find((set) => {
    return (
      Number(set.number) === SET_NUMBER ||
      String(set.name || "").toLowerCase() === `set${SET_NUMBER}`.toLowerCase()
    );
  });

  if (!found) {
    throw new Error(`Could not find Set ${SET_NUMBER}.`);
  }

  return found;
}

function normalizeRole(role) {
  const value = String(role || "").toLowerCase();

  if (value.includes("tank")) return "tank";
  if (value.includes("ap")) return "ap carry";
  if (value.includes("ad")) return "ad carry";
  if (value.includes("magic")) return "ap carry";
  if (value.includes("attack")) return "ad carry";

  return "flex";
}

function defaultTierByCost(cost) {
  if (cost >= 5) return "S";
  if (cost === 4) return "A";
  if (cost === 3) return "B";
  return "C";
}

function defaultCarryScore(cost, role) {
  let score = 35 + Number(cost || 1) * 10;

  if (/carry|ap|ad|fighter/i.test(role)) score += 18;
  if (/tank/i.test(role)) score -= 8;

  return Math.max(20, Math.min(100, score));
}

function normalizeChampion(champ) {
  const name = cleanName(champ.name);
  const cost = Number(champ.cost || 1);
  const traits = (champ.traits || []).map(cleanName).filter(Boolean);
  const role = normalizeRole(champ.role);

  return {
    id: slugify(name),
    apiName: champ.apiName || champ.characterName || null,
    characterName: champ.characterName || null,
    name,
    cost,
    tier: defaultTierByCost(cost),
    role,
    traits,
    items: [],
    carryScore: defaultCarryScore(cost, role),
    icon: "",
    imageUrl: assetToUrl(champ.squareIcon || champ.icon || champ.tileIcon),
    splashUrl: assetToUrl(champ.icon),
    stats: champ.stats || {},
    ability: champ.ability
      ? {
          name: champ.ability.name,
          desc: champ.ability.desc,
          icon: assetToUrl(champ.ability.icon),
        }
      : null,
  };
}

function normalizeTrait(trait) {
  const breakpoints = [];

  for (const effect of trait.effects || []) {
    const min = Number(effect.minUnits);
    if (Number.isFinite(min) && min > 0) {
      breakpoints.push(min);
    }
  }

  const uniqueBreakpoints = [...new Set(breakpoints)].sort((a, b) => a - b);
  const isUnique = uniqueBreakpoints.length === 1 && uniqueBreakpoints[0] === 1;

  return {
    name: cleanName(trait.name),
    apiName: trait.apiName || null,
    type: isUnique ? "Unique" : "Trait",
    breakpoints: uniqueBreakpoints,
    isUnique,
    imageUrl: assetToUrl(trait.icon),
    desc: trait.desc || "",
  };
}

async function fetchJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }

  return res.json();
}

async function main() {
  console.log("Downloading CommunityDragon TFT data...");

  const data = await fetchJson(URL);
  const set = getSet(data);

  console.log(`Using ${set.name}`);
  console.log(`Raw champions: ${set.champions?.length || 0}`);
  console.log(`Raw traits: ${set.traits?.length || 0}`);

  const champions = (set.champions || [])
    .map(normalizeChampion)
    .filter((champ) => champ.name)
    .filter((champ) => champ.traits.length > 0)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));

  const usedTraitNames = new Set(champions.flatMap((champ) => champ.traits));

  const traitsByName = new Map();

  for (const rawTrait of set.traits || []) {
    const trait = normalizeTrait(rawTrait);

    if (!trait.name) continue;
    if (!usedTraitNames.has(trait.name)) continue;

    const existing = traitsByName.get(trait.name);

    if (!existing) {
      traitsByName.set(trait.name, trait);
      continue;
    }

    const existingBreakpointCount = existing.breakpoints?.length || 0;
    const nextBreakpointCount = trait.breakpoints?.length || 0;

    if (nextBreakpointCount > existingBreakpointCount) {
      traitsByName.set(trait.name, trait);
    }
  }

  const traits = [...traitsByName.values()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  await fs.mkdir(path.dirname(OUT_CHAMPIONS), { recursive: true });

  await fs.writeFile(OUT_CHAMPIONS, JSON.stringify(champions, null, 2));
  await fs.writeFile(OUT_TRAITS, JSON.stringify(traits, null, 2));

  await fs.writeFile(
    OUT_DEBUG,
    JSON.stringify(
      {
        source: URL,
        set: set.name,
        rawChampions: set.champions?.length || 0,
        rawTraits: set.traits?.length || 0,
        champions: champions.length,
        traits: traits.length,
        sampleChampion: champions[0],
        sampleTrait: traits[0],
      },
      null,
      2,
    ),
  );

  console.log(`Wrote ${OUT_CHAMPIONS}: ${champions.length}`);
  console.log(`Wrote ${OUT_TRAITS}: ${traits.length}`);
  console.log(`Wrote ${OUT_DEBUG}`);
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
