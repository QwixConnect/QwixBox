// One Worker, two hostnames. get.qwixbox.com returns the install script and nothing else;
// everything else is the static site.
//
// The script is an asset built into this deploy, not fetched from GitHub at request time. What
// gets piped into a root shell is therefore exactly what was reviewed and deployed, and changing
// it takes a deploy that shows up in the Cloudflare log.

interface Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.hostname === "get.qwixbox.com") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method not allowed\n", { status: 405 });
      }

      const script = await env.ASSETS.fetch(new Request(new URL("/bootstrap.sh", url)));
      if (!script.ok) return new Response("Install script unavailable\n", { status: 502 });

      return new Response(script.body, {
        headers: {
          // text/plain, not x-shellscript: a browser should show it, not download it. Anyone
          // about to pipe this into sudo bash should be able to read it in one click.
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=300",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (url.hostname === "www.qwixbox.com") {
      url.hostname = "qwixbox.com";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
