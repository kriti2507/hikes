"use client";

import { useEffect, useRef } from "react";

// What the dialog needs to name the thing it is about to clear. Resolved by
// app/checklist.tsx, which holds the roster and the mountain list; this
// component is handed strings so it never has to look anything up.
export type ClearRequest = {
  personName: string;
  mountainKanji: string;
  mountainEn: string;
  dateClimbed: string | null;
};

/**
 * Asks before a seal is cleared. Unticking is the one click on this page that
 * destroys something -- the ascent goes and the date goes with it -- so it is
 * the one click that stops to ask.
 *
 * A real <dialog> opened with showModal(), which brings Escape, the focus trap,
 * focus returned to the seal on close, and the top layer with it. That last one
 * is not a detail: under 720px the seals live inside .table-scroll, an overflow
 * container that would clip anything drawn in the flow beside them.
 *
 * `request` being non-null is what opens it. The dialog is always mounted, so
 * the open and close run through the same effect rather than through mounting.
 */
export function ConfirmClear({
  request,
  onConfirm,
  onCancel,
}: {
  request: ClearRequest | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (request && !node.open) node.showModal();
    else if (!request && node.open) node.close();
  }, [request]);

  return (
    <dialog
      ref={dialog}
      className="confirm"
      aria-labelledby="confirm-title"
      // Escape fires `cancel`, not a click on Cancel. preventDefault stops the
      // browser closing the dialog behind our back, so the state change below
      // stays the only thing that ever opens or closes it -- otherwise the
      // dialog would be shut while `request` still said it was open.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      // A modal dialog's backdrop is the dialog's own box, so a click that
      // lands on the element itself rather than on anything inside it is a
      // click outside the panel.
      onClick={(event) => {
        if (event.target === dialog.current) onCancel();
      }}
    >
      {/* Rendered only while there is something to ask about: the strings are
          the request, so an empty dialog has nothing to say. */}
      {request ? (
        <div className="confirm-panel">
          <h2 id="confirm-title">
            <span lang="ja">取り消し</span>
            <span className="confirm-title-en">Clear ascent</span>
          </h2>

          <p className="confirm-body">
            Clear {request.personName}&rsquo;s ascent of{" "}
            <span lang="ja">{request.mountainKanji}</span> {request.mountainEn}?
          </p>

          {/* Only when there is one. The tick alone costs a click to put back;
              the date is the part that cannot be recovered, so it is the part
              worth naming. */}
          {request.dateClimbed ? (
            <p className="confirm-note">The date {request.dateClimbed} is discarded with it.</p>
          ) : null}

          <div className="confirm-buttons">
            {/* Cancel takes the focus showModal() hands out, so Enter on an
                untick you did not mean leaves the seal alone. */}
            <button type="button" className="secondary-button" autoFocus onClick={onCancel}>
              Cancel
            </button>
            <button type="button" className="danger-button" onClick={onConfirm}>
              Clear
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
