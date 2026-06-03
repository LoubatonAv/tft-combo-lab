function MechaTransformerTool({
  armed,
  onArm,
  naturalMechaCount,
  bonusMechaCount,
  effectiveMechaCount,
  boardSlotsUsed,
}) {
  return (
    <div className="mb-4 rounded-3xl border border-amber-300/30 bg-amber-300/10 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-amber-100">
            Mecha Transformer
          </div>

          <div className="text-xs text-amber-100/75">
            Drag onto a Mecha unit, or click this tool and then click a Mecha
            unit. Click/drop again to remove.
          </div>
        </div>

        <button
          type="button"
          draggable
          onClick={onArm}
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", MECHA_TRANSFORMER_TOOL);
            event.dataTransfer.effectAllowed = "move";
          }}
          className={cx(
            "rounded-2xl border px-4 py-3 text-left shadow-xl transition",
            armed
              ? "border-amber-100 bg-amber-300 text-amber-950"
              : "border-amber-300/40 bg-black/20 text-amber-100 hover:bg-amber-300/20",
          )}
        >
          <div className="text-lg font-black">⚙️ Transformer</div>
          <div className="text-xs">+1 Mecha · +1 board slot</div>
        </button>
      </div>

      <div className="grid gap-2 text-xs text-amber-100/85 md:grid-cols-4">
        <div className="rounded-xl bg-black/20 p-2">
          Natural Mecha: <b>{naturalMechaCount}</b>
        </div>

        <div className="rounded-xl bg-black/20 p-2">
          Transformer Bonus: <b>+{bonusMechaCount}</b>
        </div>

        <div className="rounded-xl bg-black/20 p-2">
          Effective Mecha: <b>{effectiveMechaCount}</b>
        </div>

        <div className="rounded-xl bg-black/20 p-2">
          Slots Used: <b>{boardSlotsUsed}</b>
        </div>
      </div>
    </div>
  );
}
