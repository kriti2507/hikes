"use client";

import { useEffect, useState } from "react";

export const THEME_KEY = "hyakumeizan-theme";

// The two Hokusai prints the page switches between: fair weather and storm.
// Light is the default, so `dark` is the only value ever stored.
type Theme = "light" | "dark";

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    if (theme === "dark") localStorage.setItem(THEME_KEY, "dark");
    else localStorage.removeItem(THEME_KEY);
  } catch {
    // Private browsing can refuse storage; the toggle still works for this
    // page view, it just will not be remembered.
  }
}

export function ThemeToggle() {
  // Starts light to match what the server rendered. The inline script in the
  // layout has already set the attribute by now, so the effect below corrects
  // the label on the first commit without the page ever flashing.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={next === "dark" ? "Switch to the night print" : "Switch to the daylight print"}
      onClick={() => {
        apply(next);
        setTheme(next);
      }}
    >
      <span className="glyph" aria-hidden="true">
        {next === "dark" ? "雨" : "晴"}
      </span>
      {next === "dark" ? "Night" : "Day"}
    </button>
  );
}
