import { env } from "../env";

export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]/g, " ");
  // eslint-disable-next-line no-control-regex
  if (!/[^\x20-\x7E]/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

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
