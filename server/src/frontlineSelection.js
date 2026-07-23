export function parseFrontlineSelection(body = {}, boardSize = 8) {
  const raw = body.frontlineCount ?? body.minFrontline ?? 0;
  if (raw === "flex") {
    const requestedMinimum = Math.min(boardSize, boardSize <= 6 ? 2 : 3);
    const requestedMaximum = Math.max(requestedMinimum, boardSize - 2);
    return {
      mode: "flex",
      minFrontline: requestedMinimum,
      maxFrontline: requestedMaximum,
    };
  }
  if (typeof raw === "string" && raw.trim() === "") {
    throw new Error("frontlineCount must be a number or flex.");
  }
  const requestedCount = Number(raw);
  if (!Number.isInteger(requestedCount) || requestedCount < 0 || requestedCount > boardSize) {
    throw new Error(`frontlineCount must be flex or an integer from 0 to ${boardSize}.`);
  }
  return {
    mode: "fixed",
    minFrontline: requestedCount,
    maxFrontline: null,
  };
}

export function frontlineCountAllowed(count, selection) {
  if (count < selection.minFrontline) return false;
  return selection.mode !== "flex" || count <= selection.maxFrontline;
}

export function frontlineSelectionMetadata(count, selection) {
  return selection.mode === "flex"
    ? {
        mode: "flex",
        selectedCount: count,
        requestedMinimum: selection.minFrontline,
        requestedMaximum: selection.maxFrontline,
        exploredCounts: Array.from(
          { length: selection.maxFrontline - selection.minFrontline + 1 },
          (_, index) => selection.minFrontline + index,
        ),
      }
    : {
        mode: "fixed",
        selectedCount: count,
        requestedCount: selection.minFrontline,
      };
}
