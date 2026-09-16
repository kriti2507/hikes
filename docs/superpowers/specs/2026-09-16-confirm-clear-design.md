# Confirming a Cleared Seal — Design

**Date:** 2026-09-16
**Status:** Approved — built and driven in a browser; see Verification.

## Objective

Unticking a seal is the only click on this page that destroys anything. It
clears the ascent, and `app/checklist-table.tsx` has always discarded the date
along with it — "the row means 'not climbed', so a date would contradict it".
One mis-aimed tap on a 25px box takes a recorded date with it and there is
nothing to get it back from.

So unticking now asks first. Ticking does not, and neither does editing a date:
neither of those loses anything.

## Decisions

| | |
|---|---|
| Which control | The climbed seal, in the table **and** in the map's peak card |
| Form | A centred native `<dialog>` |
| When | Every untick, whether or not a date was recorded |

Every untick, rather than only those carrying a date, because a rule with no
exceptions needs no explaining — and the absence of a prompt would otherwise
have to be read as "this one had no date", which is not something the seal
shows you.

## Where it hooks in

Both seals already call the same `onSave` — `save()` in `app/checklist.tsx` —
so the confirmation goes there and both call sites get it without knowing about
it. `save()` splits in two:

- `commit()` — the old body: paint optimistically, persist, roll back and raise
  the error banner on failure.
- `save()` — if the entry is currently climbed and the incoming one is not, it
  stores the pending change and returns. Everything else goes straight to
  `commit()`.

Nothing is written to `entries` on the way past, and that is what keeps the seal
ticked while the dialog is open: the checkbox is controlled, so the state change
re-renders it back to the value the database still holds. Cancel therefore needs
no undo — nothing happened.

The pending change is kept whole (`{ personId, mountainId, next }`) rather than
rebuilt on confirm, so what gets written is what the seal asked for.

## The dialog

`app/confirm-clear.tsx`, one instance for the page, mounted always and opened by
`request` going non-null.

A real `<dialog>` with `showModal()`, which brings Escape, the focus trap, focus
returned to the seal on close, and the **top layer**. That last is not a
detail: under 720px the seals sit inside `.table-scroll`, an overflow container
that would clip anything drawn beside them in the flow. It is also why one
dialog can serve both a 51px table cell and a peak card floating over the map.

- Escape is `preventDefault`ed and routed through the same cancel handler, so
  React state stays the only thing that opens or closes it.
- A click landing on the dialog element itself rather than on the panel inside
  it is a click on the backdrop, and cancels. The panel owns the padding for
  exactly this reason.
- Cancel is first in the source, so it takes the focus `showModal()` hands out:
  Enter on an untick you did not mean leaves the seal alone.
- The date line appears only when there is a date. The tick alone costs a click
  to put back; the date is the part that cannot be recovered, so it is the part
  worth naming.

```
┌────────────────────────────────┐
│  取り消し  CLEAR ASCENT         │
│                                │
│  Clear V’s ascent of           │
│  十勝岳 Mt. Tokachi?            │
│                                │
│  The date 2024-08-01 is        │
│  discarded with it.            │
│                                │
│        [ Cancel ]  [ Clear ]   │
└────────────────────────────────┘
```

The backdrop is a literal `rgb(0 0 0 / 0.45)` rather than a mix of `--sumi`:
`::backdrop` only began inheriting custom properties from its originating
element recently, and a `var()` resolving to nothing would leave the page
unshaded and the modal looking like part of it.

## Verification

Driven in headless Chrome against `next dev` and the real database:

| Step | Result |
|---|---|
| Untick in the table | Dialog opens, **seal stays ticked**, focus on Cancel |
| Cancel | Closes, seal still ticked |
| Escape | Closes, seal still ticked |
| Reload after both | Seal still ticked — nothing was ever written |
| Clear | Seal clears; survives a reload |
| Tick again | No dialog |
| Phone, 390×700 | Dialog 331×161, fully inside the viewport, not clipped by the scroller |
| Map peak card | Tick is silent; untick asks, naming 利尻山 Mt. Rishiri and the right person; Clear applies |

No console errors or exceptions in any of it.
