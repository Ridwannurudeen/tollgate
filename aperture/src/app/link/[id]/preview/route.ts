import { findLink } from "../../../../lib/link-registry";
import { readLinkPreview } from "../../../../lib/link-preview";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function notFound(): Response {
  return new Response("preview not found", { status: 404 });
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const link = await findLink(id);
  if (!link?.hasPreview) return notFound();

  try {
    const bytes = await readLinkPreview(link.id);
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      status: 200,
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=3600, immutable",
      },
    });
  } catch {
    return notFound();
  }
}
