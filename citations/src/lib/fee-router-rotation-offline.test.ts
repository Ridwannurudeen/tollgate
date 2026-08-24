import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { assertFeeRouterServiceStopped } from "./fee-router-rotation-offline";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe("FeeRouter offline rotation preflight", () => {
  it("rejects while the settlement service is listening", async () => {
    const server = createServer();
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind a TCP port");
    }

    await expect(
      assertFeeRouterServiceStopped(`http://127.0.0.1:${address.port}`),
    ).rejects.toThrow("still listening");
  });

  it("allows preparation after the settlement listener closes", async () => {
    const server = createServer();
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("test server did not bind a TCP port");
    }
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );

    await expect(
      assertFeeRouterServiceStopped(`http://127.0.0.1:${address.port}`),
    ).resolves.toBeUndefined();
  });
});
