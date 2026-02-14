"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "登录失败");
      }

      router.replace("/admin");
      router.refresh();
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "登录失败";
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-login-card">
      <form className="admin-login-form" onSubmit={handleSubmit}>
        <label htmlFor="username">Username or Email</label>
        <div className="admin-login-input-wrap">
          <span>@</span>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="admin@blog.com"
            autoComplete="username"
            required
          />
        </div>

        <div className="admin-login-row">
          <label htmlFor="password">Password</label>
          <a href="#">Forgot password?</a>
        </div>
        <div className="admin-login-input-wrap">
          <span>*</span>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="password"
            autoComplete="current-password"
            required
          />
          <button
            className="admin-login-eye"
            type="button"
            onClick={() => setShowPassword((prev) => !prev)}
            aria-label={showPassword ? "hide password" : "show password"}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>

        <label className="admin-login-remember" htmlFor="remember-me">
          <input
            id="remember-me"
            type="checkbox"
            checked={rememberMe}
            onChange={(event) => setRememberMe(event.target.checked)}
          />
          <span>Remember me for 30 days</span>
        </label>

        <button className="admin-login-submit" type="submit" disabled={submitting}>
          {submitting ? "Signing In..." : "Sign In"}
        </button>
      </form>

      {error ? (
        <div className="admin-login-error" role="alert">
          <span>!</span>
          <p>{error}</p>
        </div>
      ) : null}
    </div>
  );
}
