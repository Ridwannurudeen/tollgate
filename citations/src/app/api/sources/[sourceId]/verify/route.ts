import { NextRequest, NextResponse } from "next/server";
import {
  SourceRegistryError,
  findSource,
  publicSource,
  verifySourceOwnership,
} from "@/lib/catalog";
import { releaseEscrowForSource } from "@/lib/escrow";
import {
  verificationToken,
  verifySourceByWebProof,
} from "@/lib/source-verification";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ sourceId: string }>;
};

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { sourceId } = await context.params;
    const source = await findSource(sourceId);
    if (!source) {
      return NextResponse.json({ error: "source not found" }, { status: 404 });
    }
    const token = verificationToken(source.id);
    return NextResponse.json({
      sourceId: source.id,
      token,
      metaTag: `<meta name="tollgate-verification" content="${token}">`,
      dnsTxt: `tollgate-verify=${token}`,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Verification token failed.",
      },
      { status: 501 },
    );
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { sourceId } = await context.params;
    const body = (await request.json()) as unknown;
    const method =
      body && typeof body === "object"
        ? (body as Record<string, unknown>).method
        : undefined;
    const source = await findSource(sourceId);
    if (!source) {
      return NextResponse.json({ error: "source not found" }, { status: 404 });
    }
    if (method === "creator-claimed") {
      throw new SourceRegistryError(
        "Creator claims require meta-tag or DNS domain ownership proof.",
        403,
      );
    }
    if (method === "orcid") {
      throw new SourceRegistryError(
        "ORCID verification requires a completed OAuth session.",
        403,
      );
    }
    const result =
      method === "meta-tag" || method === "dns-txt"
        ? await verifySourceByWebProof(source, method)
        : await verifySourceOwnership(sourceId, body);
    const escrowRelease = await releaseEscrowForSource(result.source);
    return NextResponse.json({
      source: publicSource(result.source),
      sources: result.sources.map(publicSource),
      escrowRelease,
    });
  } catch (error) {
    if (error instanceof SourceRegistryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "Source verification failed." },
      { status: 400 },
    );
  }
}
