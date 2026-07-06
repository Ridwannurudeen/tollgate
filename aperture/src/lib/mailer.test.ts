import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendLoginLinkEmail } from "./mailer";

describe("sendLoginLinkEmail", () => {
  const savedKey = process.env.RESEND_API_KEY;
  const savedFrom = process.env.APERTURE_MAIL_FROM;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    if (savedKey === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = savedKey;
    }
    if (savedFrom === undefined) {
      delete process.env.APERTURE_MAIL_FROM;
    } else {
      process.env.APERTURE_MAIL_FROM = savedFrom;
    }
    vi.unstubAllGlobals();
  });

  it("returns false without throwing when mail env is missing", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.APERTURE_MAIL_FROM;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      sendLoginLinkEmail("jane@example.com", "https://example.com/login"),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "Aperture login email is not configured.",
    );
  });

  it("posts to Resend and returns true on 2xx", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.APERTURE_MAIL_FROM = "Aperture <no-reply@send.gudman.xyz>";
    const fetchMock = vi.fn(async () => new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendLoginLinkEmail(
      "jane@example.com",
      "https://tollgate.gudman.xyz/aperture/login/verify/token",
    );

    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer re_test",
          "content-type": "application/json",
        }),
      }),
    );
  });

  it("returns false on non-2xx responses", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.APERTURE_MAIL_FROM = "Aperture <no-reply@send.gudman.xyz>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      sendLoginLinkEmail("jane@example.com", "https://example.com/login"),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("Aperture login email failed with 500.");
  });

  it("returns false on fetch failures", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.APERTURE_MAIL_FROM = "Aperture <no-reply@send.gudman.xyz>";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      sendLoginLinkEmail("jane@example.com", "https://example.com/login"),
    ).resolves.toBe(false);
    expect(warn).toHaveBeenCalledWith("Aperture login email failed: offline.");
  });
});
