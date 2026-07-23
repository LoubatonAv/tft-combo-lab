export function formatFrontlineSelection(selection, boardSize) {
  if (!selection) return null;
  return selection.mode === "flex"
    ? `Frontline: Flex → ${selection.selectedCount}/${boardSize}`
    : `Frontline: ${selection.selectedCount}/${boardSize}`;
}

export function flexFrontlineMinimum(boardSize) {
  const size = Number(boardSize || 0);
  return Math.min(size, size <= 6 ? 2 : 3);
}
