import { createConnection } from "node:net";

export async function assertFeeRouterServiceStopped(
  internalOrigin: string,
): Promise<void> {
  const origin = new URL(internalOrigin);
  const port = Number(origin.port || (origin.protocol === "https:" ? 443 : 80));
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: origin.hostname, port });
    socket.setTimeout(1_000);
    socket.once("connect", () => {
      socket.destroy();
      reject(
        new Error(
          `Settlement service is still listening at ${origin.origin}; drain and stop it before preparing key rotation.`,
        ),
      );
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      socket.destroy();
      if (error.code === "ECONNREFUSED") resolve();
      else
        reject(new Error(`Could not verify that ${origin.origin} is stopped.`));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Could not verify that ${origin.origin} is stopped.`));
    });
  });
}
