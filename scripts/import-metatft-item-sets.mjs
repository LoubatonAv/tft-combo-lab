import fs from "fs/promises";
import path from "path";

const CHAMPIONS_PATH = path.resolve("server/data/champions.json");
const OUT_PATH = path.resolve("server/data/itemSetStats.json");
const DEBUG_PATH = path.resolve("server/data/metatft-item-sets-debug.json");
const BASE_URL = process.env.METATFT_ITEM_SOURCE || "https://meta-tft.com/en/units";
const MAX_SETS = Number(process.env.METATFT_MAX_ITEM_SETS || 3);
const DELAY_MS = Number(process.env.METATFT_DELAY_MS || 350);

const IGNORED_ITEM_NAMES = new Set([
  "image",
  "champion",
  "stats",
  "tier",
  "build",
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeLine(value) {
  return htmlDecode(value)
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlToLines(html) {
  return htmlDecode(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/div>|<\/p>|<\/li>|<\/tr>|<\/td>|<\/a>|<\/span>/gi, "\n")
    .replace(/<[^>]+alt=["']([^"']+)["'][^>]*>/gi, " Image: $1 ")
    .replace(/<[^>]+aria-label=["']([^"']+)["'][^>]*>/gi, " Image: $1 ")
    .replace(/<[^>]+title=["']([^"']+)["'][^>]*>/gi, " Image: $1 ")
    .replace(/<[^>]+>/g, " ")
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
}

function extractItemsFromLine(line) {
  const names = [];
  const imageRegex = /Image:\s*([^\n]+?)(?=\s+Image:|$)/gi;
  let match;

  while ((match = imageRegex.exec(line))) {
    const name = normalizeLine(match[1]).replace(/^Image:\s*/i, "");

    if (!name || IGNORED_ITEM_NAMES.has(name.toLowerCase())) continue;
    if (/^TFT17_|^Set\s*17$/i.test(name)) continue;

    names.push(name);
  }

  return names.slice(0, 3);
}

function parseStatLine(line) {
  const match = normalizeLine(line).match(
    /\b([SABCD])\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s*([\d,]+)\s*\((\d+(?:\.\d+)?)%\)/i,
  );

  if (!match) return null;

  return {
    tier: match[1].toUpperCase(),
    avgPlace: Number(match[2]),
    winRate: Number(match[3]),
    games: Number(match[4].replace(/,/g, "")),
    playRate: `${match[5]}%`,
  };
}

function scoreSet(set) {
  const tierScore = { S: 96, A: 84, B: 68, C: 50, D: 32 }[set.tier] || 55;

  return Math.round(
    tierScore +
      Number(set.winRate || 0) * 1.8 -
      Number(set.avgPlace || 4.5) * 9 +
      Math.min(Number(set.games || 0) / 130, 12),
  );
}

function parseItemSets(html, champion) {
  const lines = stripHtmlToLines(html);
  const sets = [];

  for (let i = 0; i < lines.length; i += 1) {
    const items = extractItemsFromLine(lines[i]);

    if (!items.length) continue;

    for (let j = i + 1; j < Math.min(lines.length, i + 5); j += 1) {
      const stats = parseStatLine(lines[j]);

      if (!stats) continue;

      const set = {
        id: `${champion.id}-metatft-${sets.length + 1}`,
        items,
        ...stats,
        source: `${BASE_URL}/${champion.apiName}`,
      };

      set.score = scoreSet(set);
      sets.push(set);
      break;
    }

    if (sets.length >= MAX_SETS) break;
  }

  return sets;
}

async function fetchUnitPage(champion) {
  const url = `${BASE_URL}/${champion.apiName}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 TFT Combo Lab importer",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function main() {
  const champions = JSON.parse(await fs.readFile(CHAMPIONS_PATH, "utf8"));
  const existing = JSON.parse(
    await fs.readFile(OUT_PATH, "utf8").catch(() => "{}"),
  );

  const output = { ...existing };
  const debug = [];

  for (const champion of champions) {
    try {
      const html = await fetchUnitPage(champion);
      const sets = parseItemSets(html, champion);

      if (sets.length) {
        output[champion.id] = sets;
      }

      debug.push({
        id: champion.id,
        name: champion.name,
        found: sets.length,
        sets,
      });

      console.log(`${champion.name}: ${sets.length} item sets`);
    } catch (error) {
      debug.push({
        id: champion.id,
        name: champion.name,
        error: error.message,
      });

      console.warn(`${champion.name}: ${error.message}`);
    }

    await sleep(DELAY_MS);
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(output, null, 2));
  await fs.writeFile(DEBUG_PATH, JSON.stringify(debug, null, 2));

  console.log(`Wrote ${OUT_PATH}`);
  console.log(`Debug: ${DEBUG_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
