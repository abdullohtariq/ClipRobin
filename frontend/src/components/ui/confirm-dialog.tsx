"use client";

import React from "react";
import { ModalDialog } from "./modal-dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <ModalDialog
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      ariaLabelledBy="confirm-dialog-title"
      className="max-w-md"
    >
      <div className="w-full rounded-2xl border border-zinc-800 bg-[#121215] p-6 shadow-2xl space-y-4">
        <div className="space-y-1.5">
          <h2 id="confirm-dialog-title" className="text-base font-semibold text-[#f4f4f5]">
            {title}
          </h2>
          <p className="text-sm text-zinc-400 leading-relaxed">{description}</p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="min-h-[40px] rounded-xl border border-zinc-700 bg-transparent px-4 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800 hover:text-white transition-colors focus-ring cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-[40px] rounded-xl px-4 py-2 text-xs font-semibold transition-colors focus-ring cursor-pointer disabled:opacity-50 ${
              variant === "danger"
                ? "bg-red-500 text-white hover:bg-red-600"
                : "bg-[#10b981] text-zinc-950 hover:bg-[#059669]"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
}
