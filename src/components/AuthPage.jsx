import { useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function AuthPage({ onLoginSuccess }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setIsLoading(true);
    setStatusMessage("");

    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;

        setStatusMessage("Login successful.");
        onLoginSuccess(data.session);
      }

      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });

        if (error) throw error;

        setStatusMessage(
          "Account created. If email confirmation is enabled, check your inbox. Otherwise, you can log in now."
        );
        setMode("login");
      }
    } catch (error) {
      setStatusMessage(error.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="auth-page">
      <div className="auth-card">
        <span className="eyebrow">Admin Access</span>

        <h2>{mode === "login" ? "Admin Login" : "Create Admin Account"}</h2>

        <p>
          The worker form is public. Dashboard, records, worker profiles, and
          commission settings require admin access.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Email
            <input
              type="email"
              placeholder="admin@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </label>

          {statusMessage && <div className="auth-message">{statusMessage}</div>}

          <button className="submit-btn" type="submit" disabled={isLoading}>
            {isLoading
              ? "Please wait..."
              : mode === "login"
              ? "Login"
              : "Create Account"}
          </button>
        </form>

        <button
          type="button"
          className="ghost-btn auth-switch"
          onClick={() => setMode(mode === "login" ? "signup" : "login")}
        >
          {mode === "login"
            ? "Need to create an admin account?"
            : "Already have an account? Login"}
        </button>
      </div>
    </section>
  );
}