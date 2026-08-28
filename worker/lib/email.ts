import type { Env } from "../types";

/**
 * SendGrid, with its own API key and sending subdomain. Never share a
 * sending identity between products: a deliverability problem on one must
 * not be able to spread.
 *
 * Cloudflare Email Routing is NOT an option here. On its own it can only
 * send to verified destination addresses on your own account, so it cannot
 * deliver a magic link to a stranger, which is the entire job.
 *
 * With no key configured the link is logged instead of sent, so slice 1 is
 * fully testable before the key exists. That fallback is dev-only and
 * refuses to run in production.
 */
export async function sendMagicLink(
  env: Env,
  to: string,
  link: string,
  isProduction: boolean
): Promise<void> {
  if (!env.SENDGRID_API_KEY || !env.SENDGRID_FROM) {
    if (isProduction) {
      throw new Error("SENDGRID_API_KEY and SENDGRID_FROM are required in production");
    }
    console.log(`\n  magic link for ${to}:\n  ${link}\n`);
    return;
  }

  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SENDGRID_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: env.SENDGRID_FROM, name: "Shelf" },
      subject: "Your link to Shelf",
      content: [
        {
          type: "text/plain",
          value: `Here is your link.\n\n${link}\n\nIt works once and expires in 15 minutes.\nIf you did not ask for it, ignore this.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    // Body may carry the recipient. Log status only.
    throw new Error(`SendGrid rejected the send: ${res.status}`);
  }
}
