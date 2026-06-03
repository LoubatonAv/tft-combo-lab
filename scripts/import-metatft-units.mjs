import fs from "fs/promises";
import path from "path";
import { chromium } from "playwright";

const URL = "https://www.metatft.com/units";

const CHAMPIONS_PATH = path.resolve("server/data/champions.json");
const OUT_META = path.resolve("server/data/championMeta.json");
const OUT_DEBUG = path.resolve("server/data/metatft-units-debug.txt");
const OUT_DEBUG_JSON = path.resolve("server/data/metatft-units-debug.json");

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function tierToScore(tier) {
  return (
    {
      S: 95,
      A: 82,
      B: 68,
      C: 52,
      D: 35,
    }[String(tier || "").toUpperCase()] || 50
  );
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeChampionLookup(champions) {
  const byName = new Map();
  const byId = new Map();

  for (const champ of champions) {
    byName.set(String(champ.name).toLowerCase(), champ);
    byId.set(champ.id, champ);
  }

  return { byName, byId };
}

function findChampion(name, lookup) {
  const clean = normalizeText(name);
  const slug = slugify(clean);

  return (
    lookup.byName.get(clean.toLowerCase()) || lookup.byId.get(slug) || null
  );
}

function extractFromText(text, champions) {
  const lookup = makeChampionLookup(champions);
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const result = {};
  const matches = [];

  let currentTier = null;

  for (const line of lines) {
    const tierOnly = line.match(/^(S|A|B|C|D)\s*(Tier)?$/i);

    if (tierOnly) {
      currentTier = tierOnly[1].toUpperCase();
      continue;
    }

    if (!currentTier) continue;

    for (const champ of champions) {
      if (result[champ.id]) continue;

      const exact = line.toLowerCase() === champ.name.toLowerCase();
      const startsWithName = line
        .toLowerCase()
        .startsWith(`${champ.name.toLowerCase()} `);

      if (!exact && !startsWithName) continue;

      result[champ.id] = {
        tier: currentTier,
        score: tierToScore(currentTier),
        source: "metatft/units",
      };

      matches.push({
        id: champ.id,
        name: champ.name,
        tier: currentTier,
        line,
      });
    }
  }

  return { result, matches, lines };
}

async function extractCardsFromDom(page, champions) {
  const championNames = champions.map((champ) => champ.name);

  return page.evaluate((championNames) => {
    const tiers = new Set(["S", "A", "B", "C", "D"]);
    const found = [];

    function clean(value) {
      return String(value || "")
        .replace(/\s+/g, " ")
        .trim();
    }

    function findNearbyTier(node) {
      let current = node;

      for (let depth = 0; depth < 8 && current; depth += 1) {
        const parent = current.parentElement;
        if (!parent) break;

        const previousTexts = [];
        let sibling = parent.previousElementSibling;

        for (let i = 0; i < 6 && sibling; i += 1) {
          previousTexts.push(
            clean(sibling.innerText || sibling.textContent || ""),
          );
          sibling = sibling.previousElementSibling;
        }

        for (const text of previousTexts) {
          const parts = text.split(/\s+/);
          for (const part of parts) {
            if (tiers.has(part)) return part;
          }

          const match = text.match(/\b(S|A|B|C|D)\s*Tier\b/i);
          if (match) return match[1].toUpperCase();
        }

        current = parent;
      }

      return null;
    }

    const all = [...document.querySelectorAll("body *")];

    for (const name of championNames) {
      const node = all.find((el) => {
        const text = clean(el.innerText || el.textContent || "");
        return text === name;
      });

      if (!node) continue;

      const tier = findNearbyTier(node);

      if (tier) {
        found.push({ name, tier });
      }
    }

    return found;
  }, championNames);
}

async function main() {
  const champions = JSON.parse(await fs.readFile(CHAMPIONS_PATH, "utf8"));

  console.log(`Loading ${URL}`);

  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1600, height: 2400 },
  });

  await page.goto(URL, {
    waitUntil: "networkidle",
    timeout: 60000,
  });

  await page.waitForTimeout(4000);

  const bodyText = await page.locator("body").innerText({
    timeout: 30000,
  });

  await fs.writeFile(OUT_DEBUG, bodyText);

  const textResult = extractFromText(bodyText, champions);
  const domMatches = await extractCardsFromDom(page, champions);

  await browser.close();

  const lookup = makeChampionLookup(champions);

  const meta = { ...textResult.result };

  for (const match of domMatches) {
    const champ = findChampion(match.name, lookup);
    if (!champ) continue;

    meta[champ.id] = {
      tier: match.tier,
      score: tierToScore(match.tier),
      source: "metatft/units-dom",
    };
  }

  await fs.writeFile(OUT_META, JSON.stringify(meta, null, 2));

  await fs.writeFile(
    OUT_DEBUG_JSON,
    JSON.stringify(
      {
        url: URL,
        championsTotal: champions.length,
        importedTotal: Object.keys(meta).length,
        missing: champions
          .filter((champ) => !meta[champ.id])
          .map((champ) => ({
            id: champ.id,
            name: champ.name,
            cost: champ.cost,
            traits: champ.traits,
          })),
        textMatches: textResult.matches,
        domMatches,
      },
      null,
      2,
    ),
  );

  console.log(`Wrote ${OUT_META}`);
  console.log(
    `Imported ${Object.keys(meta).length}/${champions.length} unit tiers.`,
  );
  console.log(`Debug text: ${OUT_DEBUG}`);
  console.log(`Debug json: ${OUT_DEBUG_JSON}`);

  if (Object.keys(meta).length === 0) {
    console.log("");
    console.log(
      "No unit tiers were imported. Open server/data/metatft-units-debug.txt and check how the page text is structured.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
