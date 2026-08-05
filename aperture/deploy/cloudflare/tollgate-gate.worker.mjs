// Cloudflare Worker port of the nginx auth_request payment gate.
//
// Same contract as aperture/deploy/nginx/tollgate-aperture.locations.conf:
// a subrequest asks Tollgate whether this download is licensed, a 2xx lets the
// request through to the origin, and a denial becomes 402 with the pay link.
//
// Bind in wrangler.toml:
//   [vars]
//   LICENSE_CHECK_URL = "https://tollgate.gudman.xyz/aperture/api/license-check"
//   ORIGIN_URL        = "https://immich.example.com"
//   GATED_PATH        = "/api/download/archive"
//   PAY_PATH          = "/aperture/api/license-download"

const SHARE_HEADERS = ["x-immich-share-key", "x-immich-share-slug"];

export function paymentRequiredResponse(payPath) {
  return new Response(
    JSON.stringify({ error: "payment required", pay: payPath }),
    { status: 402, headers: { "content-type": "application/json" } },
  );
}

// The subrequest is always GET with no body, matching nginx's
// `proxy_pass_request_body off` — the check reads the URI, never the payload.
export function licenseCheckRequest(request, licenseCheckUrl) {
  const url = new URL(request.url);
  const headers = new Headers({
    "x-original-uri": `${url.pathname}${url.search}`,
    "x-original-method": request.method,
  });
  // Only forwarded when actually present: the check treats the mere presence of
  // a share credential as unpaid, so sending an empty one would deny every
  // owner-session download.
  for (const name of SHARE_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(`x-original-${name}`, value);
  }
  return new Request(licenseCheckUrl, { method: "GET", headers });
}

export function originRequest(request, originUrl, gatedPath) {
  const incoming = new URL(request.url);
  const target = new URL(originUrl);
  target.pathname = gatedPath;
  target.search = incoming.search;
  const headers = new Headers(request.headers);
  // Stripped for the same reason nginx blanks them: leaving the share
  // credential on the upstream request lets the origin serve the file on the
  // strength of the shared link alone, which is the thing being charged for.
  for (const name of SHARE_HEADERS) headers.delete(name);
  return new Request(target, { method: request.method, headers });
}

export async function handleGatedRequest(request, env, fetchImpl = fetch) {
  const payPath = env.PAY_PATH ?? "/aperture/api/license-download";
  let check;
  try {
    check = await fetchImpl(licenseCheckRequest(request, env.LICENSE_CHECK_URL));
  } catch (error) {
    // Fail closed. An unreachable check must never be read as "licensed".
    return new Response(
      JSON.stringify({ error: "license check unavailable" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  if (check.status === 401 || check.status === 403) {
    return paymentRequiredResponse(payPath);
  }
  if (check.status < 200 || check.status > 299) {
    return new Response(
      JSON.stringify({ error: "license check failed" }),
      { status: 502, headers: { "content-type": "application/json" } },
    );
  }

  return fetchImpl(originRequest(request, env.ORIGIN_URL, env.GATED_PATH));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== env.GATED_PATH) {
      return fetch(request);
    }
    return handleGatedRequest(request, env);
  },
};
