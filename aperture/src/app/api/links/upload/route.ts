import { NextRequest, NextResponse } from "next/server";
import { LinkRegistryError } from "../../../../lib/link-registry";
import { handleLinkUploadRegistration } from "../../../../lib/link-registration";
import { LINK_DOWNLOAD_MAX_BYTES } from "../../../../lib/link-content";
import { assertLinkRegistrationRateLimit } from "../../../../lib/link-rate-limit";
import { publicOrigin } from "../../../../lib/x402-server";
import {
  SESSION_COOKIE_NAME,
  getSessionOwner,
  sessionCookieOptions,
  signSession,
} from "../../../../lib/account";

export const runtime = "nodejs";

function requestIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((part) => part.trim());
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "local";
}

function fileField(value: FormDataEntryValue | null): File {
  if (!(value instanceof File)) {
    throw new LinkRegistryError("image file is required.");
  }
  if (value.size > LINK_DOWNLOAD_MAX_BYTES) {
    throw new LinkRegistryError(
      "photo is larger than the 25 MB upload cap.",
      413,
    );
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    assertLinkRegistrationRateLimit(requestIp(request));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "rate limited" },
      { status: 429 },
    );
  }

  try {
    const sessionOwner = await getSessionOwner();
    const form = await request.formData();
    const file = fileField(form.get("file"));
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > LINK_DOWNLOAD_MAX_BYTES) {
      throw new LinkRegistryError(
        "photo is larger than the 25 MB upload cap.",
        413,
      );
    }

    const result = await handleLinkUploadRegistration(
      {
        fileBytes: bytes,
        title: form.get("title"),
        description: form.get("description"),
        displayName: form.get("displayName"),
        wallet: form.get("wallet"),
        email: sessionOwner ? undefined : form.get("email"),
      },
      {
        origin: publicOrigin(request.headers, "http://127.0.0.1:3092"),
        basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
        ...(sessionOwner ? { sessionOwnerId: sessionOwner.ownerId } : {}),
      },
    );
    const response = NextResponse.json(result, { status: 201 });
    if (!sessionOwner && result.accountKey) {
      const cookieValue = signSession(result.registered.ownerId);
      if (cookieValue) {
        response.cookies.set(
          SESSION_COOKIE_NAME,
          cookieValue,
          sessionCookieOptions(),
        );
      }
    }
    return response;
  } catch (error) {
    const status = error instanceof LinkRegistryError ? error.status : 400;
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "photo upload registration failed",
      },
      { status },
    );
  }
}
