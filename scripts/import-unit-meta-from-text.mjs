import fs from "fs/promises";
import path from "path";

const INPUT = path.resolve("server/data/unitTiers.txt");
const CHAMPIONS = path.resolve("server/data/champions.json");
const OUTPUT = path.resolve("server/data/championMeta.json");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tierToScore(tier) {
  return {
    S: 95,
    A: 82,
    B: 68,
    C: 52,
    D: 35,
  }[String(tier || "").toUpperCase()] || 50;
}

function parseUnitTiers(text, champions) {
  const championByName = new Map(
    champions.map((champ) => [champ.name.toLowerCase(), champ])
  );

  const championBySlug = new Map(
    champions.map((champ) => [champ.id, champ])
  );

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const result = {};
  let currentTier = null;

  for (const line of lines) {
    const tierMatch = line.match(/^(S|A|B|C|D)\s*(Tier)?$/i);

    if (tierMatch) {
      currentTier = tierMatch[1].toUpperCase();
      continue;
    }

    if (!currentTier) continue;

    const cleanLine = line
      .replace(/\s+/g, " ")
      .replace(/^\d+\.\s*/, "")
      .trim();

    const slug = slugify(cleanLine);

    const champ =
      championByName.get(cleanLine.toLowerCase()) ||
      championBySlug.get(slug);

    if (!champ) continue;

    result[champ.id] = {
      tier: currentTier,
      score: tierToScore(currentTier),
      source: "manual/metatft-units-text",
    };
  }

  return result;
}

async function main() {
  const [text, championsRaw] = await Promise.all([
    fs.readFile(INPUT, "utf8"),
    fs.readFile(CHAMPIONS, "utf8"),
  ]);

  const champions = JSON.parse(championsRaw);
  const meta = parseUnitTiers(text, champions);

  await fs.writeFile(OUTPUT, JSON.stringify(meta, null, 2));

  console.log(`Wrote ${OUTPUT}`);
  console.log(`Imported ${Object.keys(meta).length} unit meta entries.`);

  const missingCount = champions.length - Object.keys(meta).length;
  console.log(`Champions without meta tier: ${missingCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});