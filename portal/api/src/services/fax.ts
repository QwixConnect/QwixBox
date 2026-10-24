import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { fax, tenantSettings, inboundRoute } from "../db/schema";
import { env } from "../env";
import { encodeHeader, sendRaw } from "../lib/mail";

export type FaxReport = {
  callUuid: string;
  domain: string;
  did: string;
  callerNumber?: string;
  callerName?: string;
  filePath: string;
  pages: number;
  status: "received" | "failed";
  failureReason?: string;
  remoteStationId?: string;
};

export async function faxPath(file: string, domain?: string): Promise<string> {
  const spool = await realpath(
    process.env.FAX_SPOOL ?? "/var/spool/qwixbox-fax",
  );
  const root = domain ? join(spool, domain) : spool;
  const path = await realpath(file);
  if (!path.startsWith(root + sep) || !/\.(?:tiff?|pdf)$/i.test(path))
    throw new Error("Invalid fax path");
  return path;
}

async function convertToPdf(tiffPath: string): Promise<string | null> {
  if (!/\.tiff?$/i.test(tiffPath)) throw new Error("Expected a TIFF");
  const pdfPath = join(dirname(tiffPath), `${randomUUID()}.pdf`);
  try {
    const proc = Bun.spawn(["tiff2pdf", "-o", pdfPath, tiffPath], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    if (proc.exitCode !== 0) {
      const err = await new Response(proc.stderr).text();
      console.error(`[fax] tiff2pdf failed for ${tiffPath}: ${err.trim()}`);
      return null;
    }
    return pdfPath;
  } catch (err) {
    console.error(`[fax] tiff2pdf unavailable: ${(err as Error).message}`);
    return null;
  }
}

async function deliverByEmail(
  to: string,
  subject: string,
  body: string,
  attachment: { path: string; filename: string } | null,
): Promise<boolean> {
  const boundary = `----qwixboxfax-${randomUUID()}`;
  const replyTo = env.mailReplyTo ? `Reply-To: ${env.mailReplyTo}\r\n` : "";
  let message =
    `From: ${encodeHeader(env.mailFromName)} <${env.mailFrom}>\r\n${replyTo}` +
    `To: ${to}\r\nDate: ${new Date().toUTCString()}\r\n` +
    `Subject: ${encodeHeader(subject)}\r\nMIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;

  if (attachment) {
    try {
      const bytes = await Bun.file(attachment.path).arrayBuffer();
      const b64 = Buffer.from(bytes)
        .toString("base64")
        .replace(/(.{76})/g, "$1\r\n");
      message +=
        `\r\n--${boundary}\r\nContent-Type: application/pdf\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${attachment.filename}"\r\n\r\n${b64}\r\n`;
    } catch (err) {
      console.error(
        `[fax] could not attach ${attachment.path}: ${(err as Error).message}`,
      );
    }
  }
  message += `\r\n--${boundary}--\r\n`;

  return sendRaw(message, "fax");
}

export async function recordInboundFax(
  report: FaxReport,
): Promise<string | null> {
  const tenant = await db.query.tenantSettings.findFirst({
    where: and(
      eq(tenantSettings.sipDomain, report.domain),
      eq(tenantSettings.enabled, true),
    ),
  });
  if (!tenant) {
    console.error(
      `[fax] no tenant for domain ${report.domain} - fax at ${report.filePath}`,
    );
    return null;
  }

  const did = await db.query.inboundRoute.findFirst({
    where: and(
      eq(inboundRoute.organizationId, tenant.organizationId),
      eq(inboundRoute.didPattern, report.did),
      eq(inboundRoute.enabled, true),
    ),
  });
  if (!did) throw new Error("Unknown or disabled DID");
  report.filePath = await faxPath(report.filePath, tenant.sipDomain);
  const id = randomUUID();
  await db.insert(fax).values({
    id,
    organizationId: tenant.organizationId,
    didNumber: report.did,
    callerNumber: report.callerNumber ?? null,
    callerName: report.callerName ?? null,
    filePath: report.filePath,
    pages: report.pages,
    status: report.status,
    failureReason: report.failureReason ?? null,
    callUuid: report.callUuid,
  });

  if (report.status !== "received") {
    console.warn(
      `[fax] transfer failed on ${report.did}@${report.domain} from ${report.callerNumber}: ` +
        `${report.failureReason ?? "unknown"}`,
    );
    return id;
  }

  const pdf = await convertToPdf(report.filePath);
  if (pdf) {
    await db.update(fax).set({ filePath: pdf }).where(eq(fax.id, id));
  }

  const recipient = tenant.faxNotifyEmail;
  if (recipient && pdf) {
    const delivered = await deliverByEmail(
      recipient,
      `Fax received on ${report.did} (${report.pages} page${report.pages === 1 ? "" : "s"})`,
      `From: ${report.callerName || ""} ${report.callerNumber ?? "unknown"}\n` +
        `To: ${report.did}\nPages: ${report.pages}\n`,
      { path: pdf, filename: `fax-${report.did}-${Date.now()}.pdf` },
    );
    if (delivered) {
      await db
        .update(fax)
        .set({
          status: "delivered",
          deliveredAt: new Date(),
          deliverToEmail: recipient,
        })
        .where(eq(fax.id, id));
    }
  }

  return id;
}
