import fs from "fs/promises";
import path from "path";
import { scoreComp } from "../server/src/scoring.js";

const ROOT = process.cwd();

async function readJson(relativePath, fallback) {
  try {
    const raw = await fs.readFile(path.join(ROOT, relativePath), "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/['’`.\s_-]/g, "")
    .trim();
}

function findChampion(champions, name) {
  const wanted = normalize(name);

  return champions.find((champion) => {
    return (
      normalize(champion.name) === wanted ||
      normalize(champion.id) === wanted ||
      normalize(champion.apiName) === wanted ||
      normalize(champion.characterName) === wanted
    );
  });
}

function bestItemSet(unit, itemSetStats = {}) {
  const sets = itemSetStats?.[unit.id] || itemSetStats?.[unit.apiName] || [];

  if (!Array.isArray(sets) || !sets.length) return null;

  return sets[0];
}

function summarizeComp(result) {
  return {
    score: result.score,
    carry: result.itemPlan?.carryName || result.carryFit?.carryName,
    primaryTrait: result.primaryTrait,
    boardSlotsUsed: result.boardSlotsUsed,
    activeTraits: result.activeTraits
      .filter((trait) => trait.isActive)
      .map((trait) => ({
        name: trait.name,
        count: trait.count,
        activeAt: trait.activeAt,
        next: trait.nextBreakpoint,
      })),
    warnings: result.warnings,
    reasons: result.reasons,
  };
}

async function main() {
  const champions = await readJson("server/data/champions.json", []);
  const traits = await readJson("server/data/traits.json", []);
  const metaComps = await readJson("server/data/metaComps.json", []);
  const championMeta = await readJson("server/data/championMeta.json", {});
  const traitMeta = await readJson("server/data/traitMeta.json", {});
  const itemStats = await readJson("server/data/itemStats.json", {});
  const itemSetStats = await readJson("server/data/itemSetStats.json", {});
  const unitUpgradeMeta = await readJson(
    "server/data/unitUpgradeMeta.json",
    {},
  );
  const unitBuildMeta = await readJson("server/data/unitBuildMeta.json", {});
  const carryProfiles = await readJson("server/data/carryProfiles.json", {});
  const traitProfiles = await readJson("server/data/traitProfiles.json", {});

  const baseNames = [
    "Riven",
    "Ezreal",
    "Milio",
    "Kai'Sa",
    "Pantheon",
    "Tahm Kench",
    "Cho'Gath",
  ];

  const compareNames = ["Urgot", "Maokai"];

  const baseUnits = baseNames.map((name) => {
    const unit = findChampion(champions, name);
    if (!unit) throw new Error(`Could not find base unit: ${name}`);
    return unit;
  });

  const carry = findChampion(champions, "Riven");
  if (!carry) throw new Error("Could not find carry: Riven");

  const results = [];

  for (const compareName of compareNames) {
    const compareUnit = findChampion(champions, compareName);

    if (!compareUnit) {
      console.log(`Missing unit: ${compareName}`);
      continue;
    }

    const units = [...baseUnits, compareUnit];

    const result = scoreComp(units, traits, metaComps, "Timebreaker", carry, {
      targetCount: 4,
      minFrontline: 4,
      gameMode: {
        id: "capped",
        label: "Capped",
        maxUnitCost: 5,
      },
      championMeta,
      traitMeta,
      itemStats,
      itemSetStats,
      unitUpgradeMeta,
      unitBuildMeta,
      carryProfiles,
      traitProfiles,
    });

    results.push({
      name: compareName,
      unit: {
        cost: compareUnit.cost,
        tier: compareUnit.tier,
        role: compareUnit.role,
        carryScore: compareUnit.carryScore,
        traits: compareUnit.traits,
        stats: compareUnit.stats,
        championMeta: championMeta[compareUnit.id] || null,
        bestItemSet: bestItemSet(compareUnit, itemSetStats),
      },
      result: summarizeComp(result),
    });
  }

  results.sort((a, b) => b.result.score - a.result.score);

  console.dir(results, { depth: null });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
