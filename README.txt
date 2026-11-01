CARTPRAC ACCOUNT & COMMUNITY APPLICATION

Deploy the contents of this folder as a separate Cloudflare Pages project, not as GitHub Pages.

Pages: login, signup, forgot/reset password, account dashboard, public profile, leaderboards, news, forums, support tickets, store information, rules and admin dashboard.

Before production, configure assets/js/config.js with your Supabase project URL and publishable/anon key. Those are public browser values. Never add service-role keys, plugin token, Resend API key or Google client secret here.

Cloudflare Pages deployment:
- Production app: https://cartprac-community.pages.dev
- Source repository: https://github.com/masiharashidi588-max/cartprac-account-app
- Production branch: main
- Static site: no build command; serve repository root.
- Files are tracked for automatic Pages deployments from `main`.
- API: https://cartprac-api.masiharashidi588.workers.dev
