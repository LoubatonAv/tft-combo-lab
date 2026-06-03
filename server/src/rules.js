export const GAME_MODES = {
  early: {
    id: "early",
    label: "Early",
    defaultBoardSize: 5,
    maxUnitCost: 2,
    legendaryPenalty: 999,
    expensiveUnitPenalty: 14,
    description: "Cheap realistic board. Prioritizes 1-2 cost units.",
  },
  mid: {
    id: "mid",
    label: "Mid",
    defaultBoardSize: 7,
    maxUnitCost: 3,
    legendaryPenalty: 999,
    expensiveUnitPenalty: 8,
    description: "Midgame board. Mostly 1-3 cost units.",
  },
  late: {
    id: "late",
    label: "Late",
    defaultBoardSize: 8,
    maxUnitCost: 4,
    legendaryPenalty: 18,
    expensiveUnitPenalty: 4,
    description: "Late board. Allows 4-cost carries, limits 5-costs.",
  },
  capped: {
    id: "capped",
    label: "Capped",
    defaultBoardSize: 10,
    maxUnitCost: 5,
    legendaryPenalty: 0,
    expensiveUnitPenalty: 0,
    description: "Best possible capped board. Allows 5-costs.",
  },
};

export function getGameMode(modeId = "capped") {
  return GAME_MODES[modeId] || GAME_MODES.capped;
}

export function getAllowedMaxCost(modeId, explicitMaxUnitCost) {
  if (explicitMaxUnitCost) return Number(explicitMaxUnitCost);

  return getGameMode(modeId).maxUnitCost;
}

export function normalizeTier(tier) {
  return String(tier || "C").toUpperCase();
}

export function tierToScore(tier) {
  return (
    {
      S: 100,
      A: 82,
      B: 64,
      C: 45,
      D: 25,
    }[normalizeTier(tier)] || 45
  );
}

export function isUniqueTraitConfig(cfg) {
  const breakpoints = [...(cfg?.breakpoints || [])].sort((a, b) => a - b);

  return (
    Boolean(cfg?.isUnique) ||
    String(cfg?.type || "").toLowerCase() === "unique" ||
    (breakpoints.length === 1 &&
      breakpoints[0] === 1 &&
      String(cfg?.type || "").toLowerCase() === "unique")
  );
}

export function normalizeBreakpoints(cfg) {
  return [...(cfg?.breakpoints || [])].filter(Boolean).sort((a, b) => a - b);
}

export function getBestActiveBreakpoint(count, breakpoints) {
  return [...breakpoints].reverse().find((bp) => count >= bp) || 0;
}

export function getNextBreakpoint(count, breakpoints) {
  return breakpoints.find((bp) => count < bp) || null;
}
