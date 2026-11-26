import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4"
      style={{ zIndex: 99999 }}
      role="presentation"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/70"
        aria-label="Dismiss"
        disabled={busy}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!busy) onCancel();
        }}
      />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        className="safe-pb relative flex max-h-[min(90dvh,640px)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-line/70 bg-abyss shadow-glass sm:rounded-3xl"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <h2 id="confirm-title" className="text-lg font-semibold text-fog">
            {title}
          </h2>
          <p id="confirm-message" className="mt-2 text-sm text-mute">
            {message}
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-line/50 bg-abyss p-4 sm:flex sm:justify-end sm:px-6 sm:pb-6">
          <button
            type="button"
            className="btn-subtle min-h-11"
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCancel();
            }}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={(danger ? 'btn-danger' : 'btn-primary') + ' min-h-11'}
            disabled={busy}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onConfirm();
            }}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
