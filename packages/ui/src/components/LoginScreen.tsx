export function LoginScreen() {
  return (
    <div className="login">
      <h1>Alex-bot</h1>
      <p>Your autonomous coding agent. Sign in to see what it's up to.</p>
      <a href="/auth/login">
        <button className="gh-button">Sign in with GitHub</button>
      </a>
    </div>
  );
}
