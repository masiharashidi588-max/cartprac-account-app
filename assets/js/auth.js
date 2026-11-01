document.addEventListener("DOMContentLoaded", () => {
  const { sb, status } = window.CP;
  const statusEl = document.getElementById("formStatus");
  const google = document.querySelectorAll("[data-google-login]");
  const signup = document.getElementById("signupForm");
  const verificationNotice = document.getElementById("verificationNotice");
  let pendingEmail = "";

  async function googleLogin() {
    if (!sb) return status(statusEl, "Authentication is not configured yet.", "error");
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/account.html" }
    });
    if (error) status(statusEl, error.message, "error");
  }
  google.forEach(button => button.addEventListener("click", googleLogin));

  signup?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return status(statusEl, "Authentication is not configured yet.", "error");

    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const repeat = document.getElementById("repeatPassword").value;
    if (password !== repeat) return status(statusEl, "The passwords do not match.", "error");
    if (password.length < 10) return status(statusEl, "Use a password with at least 10 characters.", "error");

    const button = signup.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = "Creating account…";
    try {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: location.origin + "/account.html?setup=1" }
      });
      if (error) throw error;
      if (data.session) {
        location.href = "account.html?setup=1";
        return;
      }

      pendingEmail = email;
      signup.classList.add("hidden");
      verificationNotice?.classList.remove("hidden");
      const destination = document.getElementById("verificationEmail");
      if (destination) destination.textContent = email;
      status(statusEl, "Account created. Check your inbox and open the confirmation link to finish setting up your CartPrac profile.", "success");
    } catch (error) {
      status(statusEl, error.message || "Could not create your account.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Create account";
    }
  });

  document.getElementById("resendVerification")?.addEventListener("click", async event => {
    if (!sb || !pendingEmail) return;
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { error } = await sb.auth.resend({
        type: "signup",
        email: pendingEmail,
        options: { emailRedirectTo: location.origin + "/account.html?setup=1" }
      });
      if (error) throw error;
      status(statusEl, "A new confirmation email has been requested.", "success");
    } catch (error) {
      status(statusEl, error.message || "Could not resend the confirmation email.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("loginForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return status(statusEl, "Authentication is not configured yet.", "error");
    const email = document.getElementById("email").value.trim();
    const password = document.getElementById("password").value;
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const requestedNext = new URLSearchParams(location.search).get("next");
      const safeNext = requestedNext && /^[a-z0-9-]+\.html(?:\?[a-z0-9_=&%-]*)?$/i.test(requestedNext)
        ? requestedNext
        : "account.html";
      location.href = safeNext;
    } catch (error) {
      status(statusEl, error.message || "Login failed.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("forgotForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return status(statusEl, "Authentication is not configured yet.", "error");
    const email = document.getElementById("email").value.trim();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: location.origin + "/reset-password.html"
      });
      if (error) throw error;
      status(statusEl, "If the email is registered, a password-reset email has been sent.", "success");
    } catch (error) {
      status(statusEl, error.message || "Could not send the password-reset email.", "error");
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("resetForm")?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!sb) return status(statusEl, "Authentication is not configured yet.", "error");
    const password = document.getElementById("password").value;
    const repeat = document.getElementById("repeatPassword").value;
    if (password !== repeat) return status(statusEl, "The passwords do not match.", "error");
    if (password.length < 10) return status(statusEl, "Use at least 10 characters.", "error");

    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      status(statusEl, "Password updated successfully.", "success");
      event.currentTarget.reset();
    } catch (error) {
      status(statusEl, error.message || "Could not update the password.", "error");
    } finally {
      button.disabled = false;
    }
  });

  if (sb && location.pathname.endsWith("/signup.html")) {
    sb.auth.getSession().then(({ data }) => {
      if (data.session) location.replace("account.html");
    }).catch(() => {});
  }
});