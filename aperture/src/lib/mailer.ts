function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function sendApertureEmail({
  to,
  subject,
  html,
  kind,
}: {
  to: string;
  subject: string;
  html: string[];
  kind: "login" | "signup";
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.APERTURE_MAIL_FROM?.trim();
  if (!key || !from) {
    console.warn(`Aperture ${kind} email is not configured.`);
    return false;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: html.join(""),
    }),
  }).catch((error: unknown) => {
    console.warn(
      `Aperture ${kind} email failed: ${
        error instanceof Error ? error.message : "network error"
      }.`,
    );
    return null;
  });
  if (!response) return false;

  if (!response.ok) {
    console.warn(`Aperture ${kind} email failed with ${response.status}.`);
    return false;
  }
  return true;
}

export async function sendLoginLinkEmail(
  to: string,
  loginUrl: string,
): Promise<boolean> {
  const safeUrl = escapeHtml(loginUrl);
  return sendApertureEmail({
    to,
    kind: "login",
    subject: "Log in to your Aperture creator account",
    html: [
      "<p>You asked to log in to your Aperture creator account.</p>",
      "<p>This link expires in 20 minutes and can be used once.</p>",
      `<p><a href="${safeUrl}">Log in to Aperture</a></p>`,
      "<p>If you did not request this, ignore this email.</p>",
    ],
  });
}

export async function sendSignupLinkEmail(
  to: string,
  signupUrl: string,
): Promise<boolean> {
  const safeUrl = escapeHtml(signupUrl);
  return sendApertureEmail({
    to,
    kind: "signup",
    subject: "Confirm your email to create your Aperture creator account",
    html: [
      "<p>Confirm your email to create your Aperture creator account.</p>",
      "<p>This link expires in 20 minutes.</p>",
      `<p><a href="${safeUrl}">Create your Aperture account</a></p>`,
      "<p>If you did not request this, ignore this email.</p>",
    ],
  });
}
