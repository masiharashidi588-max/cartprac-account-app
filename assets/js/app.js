(() => {
  const cfg = window.CARTPRAC_CONFIG || {};
  const configured = cfg.supabaseUrl && !cfg.supabaseUrl.includes("YOUR-PROJECT") && cfg.supabaseAnonKey && !cfg.supabaseAnonKey.includes("YOUR_SUPABASE");
  const sb = configured && window.supabase?.createClient
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const isForm = options.body instanceof FormData || options.body instanceof Blob;
    if (options.body && !isForm && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (options.auth !== false && sb) {
      const { data } = await sb.auth.getSession();
      if (data.session?.access_token) headers.set("Authorization", `Bearer ${data.session.access_token}`);
    }
    const response = await fetch(cfg.apiBase + path, { ...options, headers, cache: options.cache || "default" });
    const type = response.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await response.json() : await response.blob();
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
    return data;
  }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function status(el, message, type = "") { if (!el) return; el.textContent = message; el.className = `status${type ? ` ${type}` : ""}`; el.classList.remove("hidden"); }
  function avatarUrl(preset) { return `assets/avatars/${({tnt:"tnt",redstone:"redstone",minecart:"minecart",blaze:"blaze"}[preset] || "tnt")}.svg`; }
  async function currentUser() { if (!sb) return null; const { data } = await sb.auth.getUser(); return data.user || null; }
  function renderChrome() {
    const header = document.getElementById("siteHeader");
    if (header) {
      const links = [ ["index.html","Home"],["news.html","News"],["forums.html","Forums"],["leaderboards.html","Leaderboards"],["store.html","Store"],["rules.html","Rules"] ];
      const current = location.pathname.split("/").pop() || "index.html";
      header.innerHTML = `<div class="top"><nav class="nav wrap"><a class="brand" href="index.html"><img src="server-icon.png" alt=""><span>Cart<em>Prac</em></span></a><div class="navlinks">${links.map(([href,label])=>`<a href="${href}" ${current===href?'aria-current="page"':''}>${label}</a>`).join("")}</div><div class="nav-actions" id="navAuth"><a class="btn btn-quiet btn-small" href="login.html">Log in</a><a class="btn btn-primary btn-small" href="signup.html">Sign up</a></div><button class="btn btn-small mobile-menu" id="mobileMenu" type="button" aria-label="Toggle menu">☰</button></nav><div id="mobileNav" class="mobile-nav wrap hidden"></div></div>`;
      const mobile = document.getElementById("mobileNav");
      if (mobile) { mobile.innerHTML = links.map(([href,label])=>`<a class="btn btn-quiet btn-small" href="${href}">${label}</a>`).join(""); }
      document.getElementById("mobileMenu")?.addEventListener("click",()=>mobile?.classList.toggle("hidden"));
      updateAuthNav();
    }
    const footer = document.getElementById("siteFooter");
    if (footer) footer.innerHTML = `<footer class="footer"><div class="wrap"><div class="footer-top"><div><strong>CartPrac Network</strong><div class="small soft">Built for Minecraft practice and community.</div></div><div class="footer-links"><a href="support.html">Support</a><a href="store.html">Store</a><a href="privacy.html">Privacy</a><a href="terms.html">Terms</a><a href="https://discord.gg/P7HC6V8Pnk" target="_blank" rel="noopener">Discord ↗</a></div></div><p class="small soft">© ${new Date().getFullYear()} CartPrac. Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft.</p></div></footer>`;
  }
  async function updateAuthNav() {
    const nav = document.getElementById("navAuth");
    const mobile = document.getElementById("mobileNav");
    const links = [ ["index.html","Home"],["news.html","News"],["forums.html","Forums"],["leaderboards.html","Leaderboards"],["store.html","Store"],["rules.html","Rules"] ];
    let authMarkup = `<a class="btn btn-quiet btn-small" href="login.html">Log in</a><a class="btn btn-primary btn-small" href="signup.html">Sign up</a>`;
    if (sb) {
      const { data } = await sb.auth.getSession();
      if (data.session) authMarkup = `<a class="btn btn-primary btn-small" href="account.html">My account</a>`;
    }
    if (nav) nav.innerHTML = authMarkup;
    if (mobile) mobile.innerHTML = links.map(([href,label]) => `<a class="btn btn-quiet btn-small" href="${href}">${label}</a>`).join("") + authMarkup;
  }
  async function loadPublicStats() {
    const root = document.getElementById("networkStats"); if (!root) return;
    try {
      const data = await api("/api/stats", { auth:false });
      const set = (id,value) => { const el=document.getElementById(id); if(el) el.textContent=value; };
      set("playersOnline",data.playersOnline ?? 0); set("activeMatches",data.activeMatches ?? 0);
      set("networkStatus",data.online ? "ONLINE" : "OFFLINE");
      const st=document.getElementById("networkStatus"); if(st) st.classList.toggle("ok",!!data.online);
      set("networkUpdated",data.online ? "Updated moments ago" : "Server heartbeat not received");
    } catch { const el=document.getElementById("networkStatus"); if(el) el.textContent="UNAVAILABLE"; }
  }
  window.CP = { cfg, sb, api, escapeHtml, status, avatarUrl, currentUser, updateAuthNav, loadPublicStats };
  document.addEventListener("DOMContentLoaded",()=>{renderChrome();loadPublicStats();});
})();
