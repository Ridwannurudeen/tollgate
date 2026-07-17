import { NextRequest, NextResponse } from "next/server";
import { LinkRegistryError } from "../../../../lib/link-registry";
import { handleLinkUploadRegistration } from "../../../../lib/link-registration";
import { LINK_DOWNLOAD_MAX_BYTES } from "../../../../lib/link-content";
import { assertLinkRegistrationRateLimit } from "../../../../lib/link-rate-limit";
import { projectPublicData } from "../../../../lib/public-data";
import { aperturePublicOrigin } from "../../../../lib/public-origin";
import { VIDEO_UPLOAD_MAX_BYTES } from "../../../../lib/video-content";
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

type MediaKind = "photo" | "video";

function mediaKindField(value: FormDataEntryValue | null): MediaKind {
  if (value === null || value === "") return "photo";
  if (typeof value !== "string") {
    throw new LinkRegistryError("mediaKind must be photo or video.");
  }
  const trimmed = value.trim();
  if (!trimmed) return "photo";
  if (trimmed !== "photo" && trimmed !== "video") {
    throw new LinkRegistryError("mediaKind must be photo or video.");
  }
  return trimmed;
}

function fileField(value: FormDataEntryValue | null, kind: MediaKind): File {
  if (!(value instanceof File)) {
    throw new LinkRegistryError(
      kind === "video" ? "video file is required." : "image file is required.",
    );
  }
  const maxBytes =
    kind === "video" ? VIDEO_UPLOAD_MAX_BYTES : LINK_DOWNLOAD_MAX_BYTES;
  if (value.size > maxBytes) {
    throw new LinkRegistryError(
      kind === "video"
        ? "video is larger than the 100 MB upload cap."
        : "photo is larger than the 25 MB upload cap.",
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
    const kind = mediaKindField(form.get("mediaKind"));
    const file = fileField(form.get("file"), kind);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const maxBytes =
      kind === "video" ? VIDEO_UPLOAD_MAX_BYTES : LINK_DOWNLOAD_MAX_BYTES;
    if (bytes.byteLength > maxBytes) {
      throw new LinkRegistryError(
        kind === "video"
          ? "video is larger than the 100 MB upload cap."
          : "photo is larger than the 25 MB upload cap.",
        413,
      );
    }

    const result = await handleLinkUploadRegistration(
      {
        fileBytes: bytes,
        mediaKind: kind,
        title: form.get("title"),
        description: form.get("description"),
        displayName: form.get("displayName"),
        wallet: form.get("wallet"),
        email: undefined,
      },
      {
        origin: aperturePublicOrigin(),
        basePath: process.env.APERTURE_BASE_PATH ?? "/aperture",
        ...(sessionOwner ? { sessionOwnerId: sessionOwner.ownerId } : {}),
      },
    );
    const response = NextResponse.json(projectPublicData(result), {
      status: 201,
    });
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
    if (error instanceof LinkRegistryError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: "photo upload registration failed" },
      { status: 400 },
    );
  }
}
