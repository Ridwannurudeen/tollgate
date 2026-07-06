import { NextRequest, NextResponse } from "next/server";
import {
  getSessionOwner,
  maskAccountEmail,
  normalizeAccountEmail,
} from "../../../../lib/account";
import {
  findWalletForOwner,
  readWalletRegistry,
  withRegistryWriteLock,
  writeWalletRegistry,
} from "../../../../lib/registry";

export const runtime = "nodejs";

type EmailUpdateResult =
  | { status: "ok"; email: string }
  | { status: "already-set" | "in-use" | "missing" };

async function readEmail(request: NextRequest): Promise<string | null> {
  const body = (await request.json().catch(() => null)) as {
    email?: unknown;
  } | null;
  return typeof body?.email === "string"
    ? normalizeAccountEmail(body.email)
    : null;
}

async function addAccountEmail(
  ownerId: string,
  email: string,
): Promise<EmailUpdateResult> {
  return withRegistryWriteLock(async () => {
    const registry = await readWalletRegistry();
    const owner = findWalletForOwner(registry, ownerId);
    if (!owner) return { status: "missing" };
    if (owner.email) return { status: "already-set" };
    const claimed = registry.photographers.find(
      (entry) => entry.ownerId !== ownerId && entry.email === email,
    );
    if (claimed) return { status: "in-use" };

    const photographers = registry.photographers.map((entry) =>
      entry.ownerId === ownerId ? { ...entry, email } : entry,
    );
    await writeWalletRegistry({ photographers });
    return { status: "ok", email };
  });
}

export async function POST(request: NextRequest) {
  const owner = await getSessionOwner();
  if (!owner)
    return NextResponse.json({ error: "not logged in" }, { status: 401 });

  const email = await readEmail(request);
  if (!email) {
    return NextResponse.json(
      { error: "a valid email is required" },
      { status: 400 },
    );
  }

  const result = await addAccountEmail(owner.ownerId, email);
  switch (result.status) {
    case "ok":
      return NextResponse.json({
        ok: true,
        email: maskAccountEmail(result.email),
      });
    case "already-set":
      return NextResponse.json(
        {
          error:
            "email already set - this account already has a recovery email",
        },
        { status: 400 },
      );
    case "in-use":
      return NextResponse.json(
        { error: "that email is already in use" },
        { status: 409 },
      );
    case "missing":
      return NextResponse.json({ error: "account not found" }, { status: 404 });
  }
  const exhaustiveResult: never = result;
  return exhaustiveResult;
}
