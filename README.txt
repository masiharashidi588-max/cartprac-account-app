CARTPRAC ACCOUNT & COMMUNITY APPLICATION

Deploy the contents of this folder as a separate Cloudflare Pages project, not as GitHub Pages.

Pages: login, signup, forgot/reset password, account dashboard, public profile, leaderboards, news, forums, support tickets, store information, rules and admin dashboard.

Before production, configure assets/js/config.js with your Supabase project URL and publishable/anon key. Those are public browser values. Never add service-role keys, plugin token, Resend API key or Google client secret here.

Cloudflare Pages deployment:
- Public app: https://cartprac-account.masiharashidi588.workers.dev
- Static origin: https://cartprac-community.pages.dev (proxied behind the Worker so Auth redirects stay on the configured origin)
- Source repository: https://github.com/masiharashidi588-max/cartprac-account-app
- Production branch: main
- Deployment trigger includes root files and nested asset directories.
- Static site: no build command; serve repository root.
- Files are tracked for automatic Pages deployments from `main`.
- API: https://cartprac-api.masiharashidi588.workers.dev
- Worker proxy source: `cloudflare/cartprac-account-proxy.js`
- API Worker source: `cloudflare/cartprac-api-worker.js`
- Worker proxy is GET/HEAD-only and fetches the static Pages origin
