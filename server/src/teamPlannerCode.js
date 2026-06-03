import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const TEAM_PLANNER_DATA_URL =
  "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/tftchampions-teamplanner.json";

const CACHE_TTL_MS = 30 * 60 * 1000;

let cachedTeamPlannerData = null;
let cachedTeamPlannerDataAt = 0;

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’`.\s_-]/g, "")
    .trim();
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeCharacterId(value) {
  return String(value || "").trim().toLowerCase();
}

function extractSetNumber(setId) {
  return Number(String(setId || "").match(/\d+/)?.[0] || 0);
}

function getValidSetIds(data) {
  return Object.keys(data || {}).filter(
    (setId) => /^TFTSet\d+/i.test(setId) && Array.isArray(data[setId]),
  );
}

function getLatestSetId(data) {
  const setIds = getValidSetIds(data).sort(
    (a, b) => extractSetNumber(b) - extractSetNumber(a),
  );

  if (!setIds[0]) {
    throw new Error("Could not find a valid TFT set in the team planner data.");
  }

  return setIds[0];
}

function toTeamPlannerHex(value) {
  return Number(value).toString(16).padStart(3, "0").toLowerCase();
}

function toLegacyHex(value) {
  return Number(value).toString(16).padStart(2, "0").toLowerCase();
}

function getUnitCharacterIds(unit) {
  if (typeof unit === "string") return [];

  return [
    unit.character_id,
    unit.characterId,
    unit.characterName,
    unit.apiName,
  ].filter(Boolean);
}

function getUnitName(unit) {
  if (typeof unit === "string") return unit;

  return (
    unit.display_name ||
    unit.displayName ||
    unit.name ||
    unit.character_id ||
    unit.characterId ||
    unit.characterName ||
    unit.apiName ||
    unit.id ||
    ""
  );
}

function inferSetIdFromCharacterIds(characterIds) {
  const setNumbers = characterIds
    .map((characterId) => String(characterId || "").match(/^TFT(\d+)_/i)?.[1])
    .filter(Boolean)
    .map(Number);

  const latestSetNumber = Math.max(...setNumbers);

  return Number.isFinite(latestSetNumber) && latestSetNumber > 0
    ? `TFTSet${latestSetNumber}`
    : "TFTSet17";
}

async function loadLocalTeamPlannerFallback() {
  const raw = await fs.readFile(path.join(root, "data/champions.json"), "utf8");
  const localChampions = JSON.parse(raw);

  const championRows = localChampions
    .map((champion) => ({
      character_id:
        champion.character_id || champion.characterId || champion.characterName || champion.apiName,
      display_name: champion.display_name || champion.displayName || champion.name,
      team_planner_code: champion.team_planner_code,
    }))
    .filter((champion) => champion.character_id && champion.display_name);

  const setId = inferSetIdFromCharacterIds(
    championRows.map((champion) => champion.character_id),
  );

  return {
    [setId]: championRows,
  };
}

async function loadTeamPlannerData() {
  const now = Date.now();

  if (cachedTeamPlannerData && now - cachedTeamPlannerDataAt < CACHE_TTL_MS) {
    return cachedTeamPlannerData;
  }

  try {
    const response = await fetch(TEAM_PLANNER_DATA_URL);

    if (!response.ok) {
      throw new Error(
        `CommunityDragon returned ${response.status} for TFT team planner data.`,
      );
    }

    cachedTeamPlannerData = await response.json();
  } catch (error) {
    console.warn(
      "Falling back to local champion snapshot for TFT team planner codes:",
      error.message || error,
    );

    cachedTeamPlannerData = await loadLocalTeamPlannerFallback();
  }

  cachedTeamPlannerDataAt = now;

  return cachedTeamPlannerData;
}

function buildSetIndex(champions) {
  const byCharacterId = new Map();
  const byName = new Map();
  const byTeamPlannerCode = new Map();
  const byLegacyCode = new Map();
  let hasTeamPlannerCodes = false;

  const sortedChampions = [...champions].sort((a, b) =>
    String(a.character_id || "").localeCompare(String(b.character_id || "")),
  );

  sortedChampions.forEach((champion, index) => {
    const fallbackCode = index + 1;
    const legacyHex = toLegacyHex(fallbackCode);

    byLegacyCode.set(legacyHex, champion);

    if (champion.team_planner_code === undefined || champion.team_planner_code === null) {
      return;
    }

    hasTeamPlannerCodes = true;

    const modernHex = toTeamPlannerHex(Number(champion.team_planner_code));

    if (champion.character_id) {
      byCharacterId.set(normalizeCharacterId(champion.character_id), modernHex);
    }

    if (champion.display_name) {
      byName.set(normalizeName(champion.display_name), modernHex);
    }

    byTeamPlannerCode.set(modernHex, champion);
  });

  return {
    byCharacterId,
    byName,
    byTeamPlannerCode,
    byLegacyCode,
    hasTeamPlannerCodes,
  };
}

function scoreSetForUnits(champions, units) {
  const index = buildSetIndex(champions);
  let score = 0;

  for (const unit of units) {
    const characterIds = getUnitCharacterIds(unit).map(normalizeCharacterId);
    const name = normalizeName(getUnitName(unit));

    if (characterIds.some((characterId) => index.byCharacterId.has(characterId))) {
      score += 3;
      continue;
    }

    if (name && index.byName.has(name)) {
      score += 1;
    }
  }

  return score;
}

function chooseBestSetId(data, units, preferredSetId) {
  if (preferredSetId && Array.isArray(data?.[preferredSetId])) {
    return preferredSetId;
  }

  const setIds = getValidSetIds(data);

  const scoredSets = setIds
    .map((setId) => ({
      setId,
      score: scoreSetForUnits(data[setId], units),
      setNumber: extractSetNumber(setId),
    }))
    .sort((a, b) => b.score - a.score || b.setNumber - a.setNumber);

  return scoredSets[0]?.setId || getLatestSetId(data);
}

function getSetIdFromCode(code) {
  return String(code || "").match(/(TFTSet\d+)$/i)?.[1] || null;
}

function getCodeBody(code, setId) {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(new RegExp(`${setId}$`, "i"), "");
}

function normalizeTeamPlannerCode(code) {
  return String(code || "").trim().replace(/\s+/g, "");
}

function findLocalChampion(row, localChampions = []) {
  const rowCharacterId = normalizeCharacterId(row.character_id);
  const rowName = normalizeName(row.display_name);
  const rowSlug = slugify(row.display_name);

  return (
    localChampions.find((champion) =>
      [champion.character_id, champion.characterId, champion.characterName, champion.apiName]
        .filter(Boolean)
        .map(normalizeCharacterId)
        .includes(rowCharacterId),
    ) ||
    localChampions.find((champion) => normalizeName(champion.name) === rowName) ||
    localChampions.find((champion) => champion.id === rowSlug) ||
    null
  );
}

export async function buildTeamPlannerCode({ units = [], setId } = {}) {
  const selectedUnits = Array.isArray(units) ? units.filter(Boolean).slice(0, 10) : [];

  if (!selectedUnits.length) {
    throw new Error("No units were provided for the team planner code.");
  }

  const data = await loadTeamPlannerData();
  const chosenSetId = chooseBestSetId(data, selectedUnits, setId);
  const index = buildSetIndex(data[chosenSetId]);

  if (!index.hasTeamPlannerCodes) {
    throw new Error(
      `Could not load modern Team Planner codes for ${chosenSetId}. Check your internet connection or update the local champion data.`,
    );
  }

  const hexSlots = [];
  const unresolved = [];

  for (const unit of selectedUnits) {
    const characterIds = getUnitCharacterIds(unit).map(normalizeCharacterId);
    const name = getUnitName(unit);
    const normalizedName = normalizeName(name);

    const byCharacterId = characterIds
      .map((characterId) => index.byCharacterId.get(characterId))
      .find(Boolean);
    const byName = normalizedName ? index.byName.get(normalizedName) : null;
    const hex = byCharacterId || byName;

    if (!hex) {
      unresolved.push(name || "Unknown unit");
      continue;
    }

    hexSlots.push(hex);
  }

  if (unresolved.length) {
    throw new Error(
      `Could not resolve these units for TFT Team Planner: ${unresolved.join(", ")}.`,
    );
  }

  while (hexSlots.length < 10) {
    hexSlots.push("000");
  }

  return {
    code: `02${hexSlots.join("")}${chosenSetId}`,
    setId: chosenSetId,
  };
}

export async function parseTeamPlannerCode({ code, localChampions = [] } = {}) {
  const normalizedCode = normalizeTeamPlannerCode(code);
  const setId = getSetIdFromCode(normalizedCode);

  if (!setId) {
    throw new Error("Team Planner code must end with a TFTSet id, for example TFTSet17.");
  }

  const data = await loadTeamPlannerData();
  const setChampions = data?.[setId];

  if (!Array.isArray(setChampions)) {
    throw new Error(`Could not find ${setId} in the Team Planner data.`);
  }

  const body = getCodeBody(normalizedCode, setId);
  const prefix = body.slice(0, 2).toLowerCase();
  const payload = body.slice(2).toLowerCase();
  const index = buildSetIndex(setChampions);

  let chunkSize = 0;
  let lookup = null;

  if (prefix === "02") {
    if (!index.hasTeamPlannerCodes) {
      throw new Error(
        `Could not load modern Team Planner codes for ${setId}. Check your internet connection or update the local champion data.`,
      );
    }

    chunkSize = 3;
    lookup = index.byTeamPlannerCode;
  } else if (prefix === "01") {
    chunkSize = 2;
    lookup = index.byLegacyCode;
  } else {
    throw new Error("Unsupported Team Planner code prefix. Expected 02 or legacy 01.");
  }

  if (payload.length < chunkSize) {
    throw new Error("Team Planner code payload is empty or malformed.");
  }

  const chunks = [];

  for (let i = 0; i < payload.length; i += chunkSize) {
    const chunk = payload.slice(i, i + chunkSize);
    if (chunk.length === chunkSize) chunks.push(chunk);
  }

  const emptyChunk = "0".repeat(chunkSize);
  const units = [];
  const unresolvedCodes = [];

  for (const chunk of chunks.slice(0, 10)) {
    if (chunk === emptyChunk) continue;

    const row = lookup.get(chunk);

    if (!row) {
      unresolvedCodes.push(chunk);
      continue;
    }

    const local = findLocalChampion(row, localChampions);

    if (local) {
      units.push(local);
    } else {
      unresolvedCodes.push(`${chunk}:${row.display_name || row.character_id}`);
    }
  }

  if (!units.length) {
    throw new Error("No champions could be resolved from this Team Planner code.");
  }

  const seenIds = new Set();
  const duplicateUnits = [];
  const uniqueUnits = [];

  for (const unit of units) {
    if (seenIds.has(unit.id)) {
      duplicateUnits.push(unit);
      continue;
    }

    seenIds.add(unit.id);
    uniqueUnits.push(unit);
  }

  return {
    setId,
    prefix,
    units: uniqueUnits,
    unitIds: uniqueUnits.map((unit) => unit.id),
    duplicateUnits: duplicateUnits.map((unit) => ({ id: unit.id, name: unit.name })),
    unresolvedCodes,
    rawUnitCount: units.length,
    uniqueUnitCount: uniqueUnits.length,
  };
}
