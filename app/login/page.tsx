import { isAdmin, sitePassword } from "@/lib/auth";
import { signIn, signOut } from "./actions";

// Unlinked from the rest of the site -- the admin types the URL. Nothing here
// is a gate; app/actions.ts is.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const admin = await isAdmin();
  const configured = sitePassword() !== null;

  // Three states, and `configured` decides first: with no password set there is
  // nothing to type, whichever way isAdmin() went. Under `next dev` that means
  // everyone is already admin; in a built deployment isAdmin() fails closed, so
  // it means nobody is -- see lib/auth.ts.
  if (!configured) {
    return (
      <main className="login">
        <div className="login-panel">
          <Title />
          <p className="login-note">
            No <code>SITE_PASSWORD</code> is set.{" "}
            {admin
              ? "This copy of the site is open for editing."
              : "Until one is, the checklist is readable but nobody can change it."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="login">
      {admin ? (
        <form action={signOut}>
          <Title />
          <p className="login-note">You&rsquo;re logged in.</p>
          <button type="submit">Log out</button>
        </form>
      ) : (
        <form action={signIn}>
          <Title />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoFocus autoComplete="current-password" />
          {error ? <p className="error">Wrong password.</p> : null}
          <button type="submit">Enter</button>
        </form>
      )}
    </main>
  );
}

function Title() {
  return (
    <h1>
      <span lang="ja">日本百名山</span>
      <span className="subtitle">Nihon Hyakumeizan</span>
    </h1>
  );
}
