export function formatHistoricalPercent(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? `${Math.round(Number(value) * 100)}%`
    : "—";
}

export function formatHistoricalPlacement(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value).toFixed(2)
    : "—";
}

export function historicalObservationViewModel(evaluation) {
  if (!evaluation || evaluation.status === "unavailable") {
    return { state: "unavailable", title: "Historical data (observational)", warning: "Historical dataset unavailable." };
  }
  const warnings = [];
  if (evaluation.status === "insufficient") warnings.push("Insufficient comparable boards.");
  if (evaluation.reliabilityStatus === "insufficient-effective-sample") warnings.push("Insufficient effective sample.");
  if (evaluation.reliabilityStatus === "neighbor-dominated") warnings.push("One neighbor dominates this estimate.");
  if (evaluation.reliabilityStatus === "low-dispersion-confidence") warnings.push("Limited placement-outcome diversity.");
  if (evaluation.isPartialBoard) warnings.push("Partial board comparison.");
  return {
    state: evaluation.status,
    title: "Historical data (observational)",
    warning: warnings.join(" "),
    averagePlacement: formatHistoricalPlacement(evaluation.weightedAveragePlacement),
    top4Rate: formatHistoricalPercent(evaluation.weightedTop4Rate),
    winRate: formatHistoricalPercent(evaluation.weightedWinRate),
    confidence: String(evaluation.confidenceClassification || "insufficient").replace(/^./, (letter) => letter.toUpperCase()),
    reliability: String(evaluation.reliabilityStatus || "unknown").replaceAll("-", " ").replace(/^./, (letter) => letter.toUpperCase()),
    effectiveSampleSize: Number.isFinite(Number(evaluation.effectiveSampleSize)) ? Number(evaluation.effectiveSampleSize).toFixed(1) : "0.0",
    rawNeighborCount: Number(evaluation.rawNeighborCount || 0),
    averageSimilarity: formatHistoricalPercent(evaluation.averageSimilarity),
    lowConfidence: ["insufficient", "very low", "low"].includes(String(evaluation.confidenceClassification || "").toLowerCase()),
  };
}
