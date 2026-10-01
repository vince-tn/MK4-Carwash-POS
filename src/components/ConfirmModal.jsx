/*
 * Confirmation for the things that cannot be undone.
 *
 * Deliberately not window.confirm: these deletions destroy sales records, and
 * the figures involved need to be on screen at the moment the decision is
 * made rather than buried in a one-line browser prompt.
 */
export default function ConfirmModal({
  title,
  message,
  details,
  confirmLabel = "Delete",
  onConfirm,
  onClose,
  isBusy = false,
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card confirm-card"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
      >
        <h2>{title}</h2>

        <p className="confirm-message">{message}</p>

        {details && details.length > 0 && (
          <ul className="confirm-details">
            {details.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}

        <p className="confirm-warning">This cannot be undone.</p>

        <div className="confirm-actions">
          <button
            type="button"
            className="secondary-btn no-margin"
            onClick={onClose}
            disabled={isBusy}
          >
            Cancel
          </button>

          <button
            type="button"
            className="danger-btn"
            onClick={onConfirm}
            disabled={isBusy}
          >
            {isBusy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
