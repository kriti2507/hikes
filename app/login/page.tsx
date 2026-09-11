import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="login">
      <form action={signIn}>
        <h1>
          日本百名山
          <span>Nihon Hyakumeizan</span>
        </h1>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoFocus autoComplete="current-password" />
        {error ? <p className="error">Wrong password.</p> : null}
        <button type="submit">Enter</button>
      </form>
    </main>
  );
}
