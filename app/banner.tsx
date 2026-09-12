"use client";

import { useState, useTransition } from "react";
import { deletePerson, updatePerson } from "./actions";
import { ThemeToggle } from "./theme-toggle";
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
  return (
    <header className="banner">
      {/* Decorative: the print carries no information the text does not. */}
      <div className="banner-print" aria-hidden="true" />
      <ThemeToggle />
      <div className="banner-text">
        <h1>
          日本百名山
          <span>
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
      </div>
    </header>
  );
}

function PersonActions({ person, onChanged }: { person: Person; onChanged: () => void }) {
  const [mode, setMode] = useState<"closed" | "edit" | "delete">("closed");
  const [name, setName] = useState(person.name);
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(nextMode: "edit" | "delete") {
    setMode(nextMode);
    setName(person.name);
    setPassword("");
    setError(null);
  }

  function close() {
    if (pending) return;
    setMode("closed");
    setPassword("");
    setError(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      try {
        if (mode === "edit") await updatePerson(person.id, name, password);
        else if (mode === "delete") await deletePerson(person.id, password);
        setMode("closed");
        setPassword("");
        onChanged();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not save that change.");
      }
    });
  }

  if (mode === "closed") {
    return (
      <span className="person-actions">
        <button type="button" className="text-button" onClick={() => open("edit")}>
          Edit
        </button>
        <button type="button" className="text-button danger-text" onClick={() => open("delete")}>
          Delete
        </button>
      </span>
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
      <label htmlFor={`confirm-password-${person.id}`}>Password</label>
      <input
        id={`confirm-password-${person.id}`}
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={pending}
        autoComplete="current-password"
        required
      />
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
