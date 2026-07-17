import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function nginxConfig(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), "deploy", "nginx", name), "utf8");
}

function locationBlock(config: string, location: string): string {
  const start = config.indexOf(`location = ${location} {`);
  if (start < 0) return "";
  const openingBrace = config.indexOf("{", start);
  let depth = 0;
  for (let index = openingBrace; index < config.length; index += 1) {
    if (config[index] === "{") depth += 1;
    if (config[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return config.slice(start, index + 1);
  }
  return "";
}

describe("Immich archive nginx enforcement", () => {
  it.each([
    ["tollgate-aperture.locations.conf", "/immich/api/download/archive"],
    ["immich.gudman.xyz.conf", "/api/download/archive"],
  ])("gates the archive endpoint in %s", async (name, archivePath) => {
    const config = await nginxConfig(name);
    const archive = locationBlock(config, archivePath);
    const check = locationBlock(config, "/_aperture/license-check");

    expect(archive).toContain("auth_request /_aperture/license-check;");
    expect(archive).toContain('proxy_set_header X-Immich-Share-Key "";');
    expect(archive).toContain('proxy_set_header X-Immich-Share-Slug "";');
    expect(check).toContain("proxy_set_header X-Original-URI $request_uri;");
    expect(check).toContain(
      "proxy_set_header X-Original-Method $request_method;",
    );
    expect(check).toContain(
      "proxy_set_header X-Original-Immich-Share-Key $http_x_immich_share_key;",
    );
    expect(check).toContain(
      "proxy_set_header X-Original-Immich-Share-Slug $http_x_immich_share_slug;",
    );
  });
});
