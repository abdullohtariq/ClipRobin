"use client";

import React, { useEffect, useRef } from "react";

interface ModalDialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  className?: string;
  children: React.ReactNode;
}

/**
 * Accessible native <dialog> wrapper using showModal() for top-layer stacking,
 * built-in Escape handling, focus trapping, and focus restoration.
 */
export function ModalDialog({
  open,
  onClose,
  ariaLabel,
  ariaLabelledBy,
  className = "",
  children,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const pointerDownOnBackdropRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
        previousFocusRef.current = document.activeElement;
      }
      if (!dialog.open && typeof dialog.showModal === "function") {
        dialog.showModal();
      } else if (!dialog.open) {
        dialog.setAttribute("open", "");
      }
    } else if (dialog.open) {
      if (typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
      const prev = previousFocusRef.current;
      previousFocusRef.current = null;
      if (prev && prev.isConnected) {
        prev.focus();
      }
    }
    return () => {
      if (dialog.open) {
        if (typeof dialog.close === "function") {
          dialog.close();
        } else {
          dialog.removeAttribute("open");
        }
      }
      const prev = previousFocusRef.current;
      if (prev && prev.isConnected) {
        queueMicrotask(() => {
          if (prev.isConnected) prev.focus();
        });
      }
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) {
          onClose();
        }
      }}
      onPointerDown={(event) => {
        pointerDownOnBackdropRef.current = event.target === dialogRef.current;
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current && pointerDownOnBackdropRef.current) {
          onClose();
        }
        pointerDownOnBackdropRef.current = false;
      }}
      className={`cliprobin-dialog w-[calc(100vw-2rem)] ${className}`}
    >
      {open ? children : null}
    </dialog>
  );
}
