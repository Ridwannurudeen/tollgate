function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function sendLoginLinkEmail(
  to: string,
  loginUrl: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.APERTURE_MAIL_FROM?.trim();
  if (!key || !from) {
    console.warn("Aperture login email is not configured.");
    return false;
  }

  const safeUrl = escapeHtml(loginUrl);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: "Log in to your Aperture creator account",
      html: [
        "<p>You asked to log in to your Aperture creator account.</p>",
        "<p>This link expires in 20 minutes and can be used once.</p>",
        `<p><a href="${safeUrl}">Log in to Aperture</a></p>`,
        "<p>If you did not request this, ignore this email.</p>",
      ].join(""),
    }),
  }).catch((error: unknown) => {
    console.warn(
      `Aperture login email failed: ${
        error instanceof Error ? error.message : "network error"
      }.`,
    );
    return null;
  });
  if (!response) return false;

  if (!response.ok) {
    console.warn(`Aperture login email failed with ${response.status}.`);
    return false;
  }
  return true;
}
