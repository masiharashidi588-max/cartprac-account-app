const UPSTREAM = "https://cartprac-community.pages.dev";

function applySecurityHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "DENY");

  const location = headers.get("location");
  if (location) {
    try {
      const target = new URL(location, UPSTREAM);
      if (target.origin === UPSTREAM) {
        headers.set("location", target.pathname + target.search + target.hash);
      }
    } catch {
      headers.delete("location");
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { "allow": "GET, HEAD", "cache-control": "no-store" },
      });
    }

    const source = new URL(request.url);
    const target = new URL(source.pathname + source.search, UPSTREAM);
    const headers = new Headers();

    for (const name of ["accept", "accept-language", "if-none-match", "if-modified-since"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    try {
      const upstream = await fetch(new Request(target, {
        method: request.method,
        headers,
        redirect: "manual",
      }));
      return applySecurityHeaders(upstream);
    } catch (error) {
      console.error("CartPrac Account upstream error:", error?.message || error);
      return new Response("CartPrac Community is temporarily unavailable.", {
        status: 502,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
          "retry-after": "30",
        },
      });
    }
  },
};