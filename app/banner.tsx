"use client";

import { useState, useTransition } from "react";
import { deletePerson, updatePerson } from "./actions";
import { signOut } from "./login/actions";
import { ThemeToggle } from "./theme-toggle";
import { Locked, useAdmin } from "./auth";
import type { Person } from "./checklist";

export function Banner({
  people,
  counts,
  total,
  onChanged,
}: {
  people: Person[];
  counts: Map<number, number>;
  total: number;
  onChanged: () => void;
}) {
  const { isAdmin } = useAdmin();

  return (
    <header className="banner">
      {/* Decorative: the print carries no information the text does not. */}
      <div className="banner-print" aria-hidden="true" />
      <ThemeToggle />
      <div className="banner-text">
        <h1>
          <span lang="ja">日本百名山</span>
          <span className="subtitle">
            The Hundred Famous Mountains
            <br />
            Fukada Kyūya, 1964
          </span>
        </h1>
        <ul className="tally">
          {people.map((person) => (
            <li key={person.id}>
              {/* The seal is a fixed square, so edit/delete sit below it rather
                  than inside — the stamp keeps its proportions either way. */}
              <div
                className="tally-seal"
                title={`${person.name}: ${counts.get(person.id) ?? 0} of ${total}`}
              >
                <strong>{counts.get(person.id) ?? 0}</strong>
                <span>{person.name}</span>
              </div>
              <PersonActions person={person} onChanged={onChanged} />
            </li>
          ))}
        </ul>

        {/* Only the admin sees this, so the page never advertises to a visitor
            that an admin exists. */}
        {isAdmin ? (
          <form action={signOut} className="banner-logout">
            <button type="submit" className="text-button">
              Log out
            </button>
          </form>
        ) : null}
      </div>
    </header>
  );
}

function PersonActions({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const [mode, setMode] = useState<"closed" | "edit" | "delete">("closed");
  const [name, setName] = useState(person.name);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(nextMode: "edit" | "delete") {
    setMode(nextMode);
    setName(person.name);
    setError(null);
  }

  function close() {
    if (pending) return;
    setMode("closed");
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        if (mode === "edit") await updatePerson(person.id, name);
        else if (mode === "delete") await deletePerson(person.id);
        setMode("closed");
        onChanged();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save that change.");
      }
    });
  }

  if (mode === "closed") {
    return (
      <Locked className="locked-control">
        <span className="person-actions">
          <button type="button" className="text-button" onClick={() => open("edit")}>
            Edit
          </button>
          <button type="button" className="text-button danger-text" onClick={() => open("delete")}>
            Delete
          </button>
        </span>
      </Locked>
    );
  }

  return (
    <form className="person-action-form" onSubmit={submit}>
      {mode === "edit" ? (
        <>
          <label htmlFor={`edit-person-${person.id}`}>New name</label>
          <input
            id={`edit-person-${person.id}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={pending}
            autoFocus
          />
        </>
      ) : (
        <p>Delete {person.name} and all of their ascents?</p>
      )}
      {error ? <span className="error">{error}</span> : null}
      <span className="person-form-buttons">
        <button
          type="submit"
          className={mode === "delete" ? "danger-button" : undefined}
          disabled={pending || (mode === "edit" && !name.trim())}
        >
          {pending ? "Saving…" : mode === "edit" ? "Save" : "Delete"}
        </button>
        <button type="button" className="secondary-button" onClick={close} disabled={pending}>
          Cancel
        </button>
      </span>
    </form>
  );
}
