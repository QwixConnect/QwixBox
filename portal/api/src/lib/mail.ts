/**
 * Plain-text mail, through the system MTA.
 *
 * Same transport as fax delivery: `sendmail -t`, which Debian does not install by default.
 * steps/15-mail.sh installs Postfix (loopback-only) and OpenDKIM, so a host that has run it
 * signs what this sends.
 *
 * Sending is best-effort by design. A password reset that cannot be emailed must not turn into
 * a 500 that tells an anonymous caller whether the address exists - better-auth deliberately
 * answers the same way either way, and throwing here would undo that.
 *
 * services/fax.ts builds its own multipart message because it carries an attachment; it uses
 * `encodeHeader` from here so the header-injection guard has one definition.
 */
import { env } from "../env";

/**
 * RFC 2047 encodes a header value if it is not plain ASCII.
 *
 * Header values here can carry a user's display name, which is tenant-supplied - a non-ASCII
 * byte in a raw header is a protocol violation, and a CR or LF there is header injection.
 */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]/g, " ");
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7E]/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** Hands an already-assembled RFC 5322 message to the MTA. Returns false rather than throwing. */
export async function sendRaw(message: string, tag: string): Promise<boolean> {
  const sendmail = Bun.which("sendmail");
  if (!sendmail) {
    console.warn(
      `[${tag}] no MTA installed - not sending. Run steps/15-mail.sh to enable email.`,
    );
    return false;
  }

  try {
    const proc = Bun.spawn([sendmail, "-t"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write(message);
    await proc.stdin.end();
    await proc.exited;
    return proc.exitCode === 0;
  } catch (err) {
    console.error(`[${tag}] sendmail failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * From and Date are set explicitly rather than left to the MTA. Postfix would otherwise rewrite
 * From to the local system user, and a message with no Date is scored as spam by most receivers.
 * The From domain must also match the DKIM signing domain or alignment fails even though the
 * signature verifies.
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  tag?: string;
}): Promise<boolean> {
  const replyTo = env.mailReplyTo ? `Reply-To: ${env.mailReplyTo}\r\n` : "";
  const message =
    `From: "${env.mailFromName}" <${env.mailFrom}>\r\n${replyTo}` +
    `To: ${encodeHeader(opts.to)}\r\nDate: ${new Date().toUTCString()}\r\n` +
    `Subject: ${encodeHeader(opts.subject)}\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n\r\n${opts.text}\r\n`;

  return sendRaw(message, opts.tag ?? "mail");
}
