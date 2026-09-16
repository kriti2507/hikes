"use client";

import { useState, useTransition } from "react";
import { addPerson } from "./actions";
import { Locked } from "./auth";

export function AddPerson({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  return (
    <Locked className="locked-control">
      <form
        className="add-person"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setFailed(false);
          startTransition(async () => {
            try {
              await addPerson(name);
              setName("");
              onAdded();
            } catch {
              setFailed(true);
            }
          });
        }}
      >
        <label htmlFor="new-person">Add a friend</label>
        <input
          id="new-person"
          value={name}
          placeholder="Name"
          onChange={(event) => setName(event.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Adding…" : "Add"}
        </button>
        {failed ? <span className="error">Could not add that person.</span> : null}
      </form>
    </Locked>
  );
}
