import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

/*
 * Login only. MK4 is a single-account system, so there is deliberately no
 * sign-up path here.
 *
 * Removing the form is not the control that matters: anyone can still POST to
 * the Supabase /auth/v1/signup endpoint with the publishable key, which is in
 * the public bundle. Sign-ups must also be switched off in the Supabase
 * dashboard under Authentication -> Sign In / Providers -> Email.
 */
export default function AuthPage({ onLoginSuccess }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage("");

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      setStatusMessage("Login successful.");
      onLoginSuccess(data.session);
    } catch (error) {
      setStatusMessage(error.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <span className="eyebrow">Staff Access</span>

        <h2>MK4 Auto Care Login</h2>

        <p>
          Sales entry, records, worker profiles and commission settings all
          require a signed-in account.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              autoComplete="username"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>

          {statusMessage && <div className="auth-message">{statusMessage}</div>}

          <button className="submit-btn" type="submit" disabled={isLoading}>
            {isLoading ? "Please wait..." : "Login"}
          </button>
        </form>
      </div>
    </section>
  );
}
