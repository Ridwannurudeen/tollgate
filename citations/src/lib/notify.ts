import { readSources } from "./catalog";
import type { PaymentReceipt, QueryRecord } from "./types";

type Notification = {
  notifyEmail: string;
  sourceId: string;
  title: string;
  creator: string;
  amountAtomicUsdc: number;
  settlementMode: PaymentReceipt["settlementMode"];
  receiptHash: string;
  queryId: string;
  question: string;
  createdAt: string;
};

type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
};

type MailTransport = {
  sendMail(message: MailMessage): Promise<unknown>;
};

type MailTransportOptions = {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
};

type NotifyEnv = Record<string, string | undefined>;

type NotifyOptions = {
  env?: NotifyEnv;
  fetchImpl?: typeof fetch;
  createTransport?: (
    options: MailTransportOptions,
  ) => Promise<MailTransport> | MailTransport;
  readSourcesImpl?: typeof readSources;
};

function smtpPort(env: NotifyEnv): number {
  const value = env.SMTP_PORT;
  if (!value) return env.SMTP_SECURE === "1" ? 465 : 587;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`SMTP_PORT must be a positive integer, got ${value}.`);
  }
  return parsed;
}

function smtpTransportOptions(env: NotifyEnv): MailTransportOptions | null {
  if (!env.SMTP_HOST) return null;
  const options: MailTransportOptions = {
    host: env.SMTP_HOST,
    port: smtpPort(env),
    secure: env.SMTP_SECURE === "1",
  };
  if (env.SMTP_USER || env.SMTP_PASS) {
    if (!env.SMTP_USER || !env.SMTP_PASS) {
      throw new Error("SMTP_USER and SMTP_PASS must be set together.");
    }
    options.auth = {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    };
  }
  return options;
}

async function defaultCreateTransport(
  options: MailTransportOptions,
): Promise<MailTransport> {
  const nodemailer = await import("nodemailer");
  return nodemailer.createTransport(options);
}

function notificationText(notification: Notification): string {
  return [
    `Tollgate paid your source "${notification.title}".`,
    "",
    `Question: ${notification.question}`,
    `Source: ${notification.sourceId}`,
    `Receipt: ${notification.receiptHash}`,
    `Amount atomic USDC: ${notification.amountAtomicUsdc}`,
    `Settlement mode: ${notification.settlementMode}`,
    `Created at: ${notification.createdAt}`,
  ].join("\n");
}

export async function notifyCreatorReceipts(
  query: QueryRecord,
  receipts: PaymentReceipt[],
  options: NotifyOptions = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const webhook = env.TOLLGATE_NOTIFY_WEBHOOK;
  const smtp = smtpTransportOptions(env);
  if (!webhook && !smtp) return;

  const sources = await (options.readSourcesImpl ?? readSources)();
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const notifications = receipts
    .map((receipt) => {
      const source = sourceById.get(receipt.sourceId);
      if (!source?.notifyEmail) return null;
      return {
        notifyEmail: source.notifyEmail,
        sourceId: source.id,
        title: source.title,
        creator: source.creator,
        amountAtomicUsdc: receipt.amountAtomicUsdc,
        settlementMode: receipt.settlementMode,
        receiptHash: receipt.receiptHash,
        queryId: query.id,
        question: query.question,
        createdAt: receipt.createdAt,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
  if (notifications.length === 0) return;

  if (webhook) {
    const response = await (options.fetchImpl ?? fetch)(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notifications }),
    });
    if (!response.ok) {
      throw new Error(`notification webhook failed: HTTP ${response.status}`);
    }
  }

  if (smtp) {
    const from = env.SMTP_FROM ?? env.SMTP_USER;
    if (!from) throw new Error("SMTP_FROM is required when SMTP is enabled.");
    const transport = await (options.createTransport ?? defaultCreateTransport)(
      smtp,
    );
    for (const notification of notifications) {
      await transport.sendMail({
        from,
        to: notification.notifyEmail,
        subject: `Tollgate paid ${notification.title}`,
        text: notificationText(notification),
      });
    }
  }
}
