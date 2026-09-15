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

  return (
    <main className="login">
      {admin ? (
        <form action={signOut}>
          <Title />
          {configured ? (
            <p className="login-note">You&rsquo;re logged in.</p>
          ) : (
            <p className="login-note">
              No <code>SITE_PASSWORD</code> is set, so this copy of the site is open for editing.
            </p>
          )}
          {/* Nothing to clear when no password is configured. */}
          {configured ? <button type="submit">Log out</button> : null}
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
