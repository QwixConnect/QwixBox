#!/usr/bin/env bun
// Does this ENCRYPTION_KEY open the secrets in this database? restore.sh runs it against a scratch
// copy of the dump before replacing anything (I13): the *Enc columns are AES-256-GCM under a key
// derived from ENCRYPTION_KEY, and a restore under any other key comes back with every SIP
// password, voicemail PIN and trunk credential unreadable - which shows up later as extensions
// that cannot be re-projected and trunks that cannot authenticate, not as an error here.
//
// Exits 1 if any value fails to decrypt. A database with no encrypted values cannot prove the key
// either way; that is reported, and exits 0.
import { isNotNull } from "drizzle-orm";
import { db, pool } from "../db";
import { extension, trunk } from "../db/schema";
import { decrypt } from "../lib/crypto";

const values = [
  ...(await db.select({ v: extension.sipPasswordEnc }).from(extension)),
  ...(await db
    .select({ v: extension.voicemailPinEnc })
    .from(extension)
    .where(isNotNull(extension.voicemailPinEnc))),
  ...(await db
    .select({ v: trunk.passwordEnc })
    .from(trunk)
    .where(isNotNull(trunk.passwordEnc))),
].map((row) => row.v as string);

let failed = 0;
for (const value of values) {
  try {
    decrypt(value);
  } catch {
    failed++;
  }
}
await pool.end();

if (failed) {
  console.error(
    `${failed} of ${values.length} stored secrets do not decrypt with this ENCRYPTION_KEY. ` +
      "It is not the key this database was written under.",
  );
  process.exit(1);
}
console.log(
  values.length
    ? `All ${values.length} stored secrets decrypt with this ENCRYPTION_KEY`
    : "No stored secrets to check the ENCRYPTION_KEY against",
);
process.exit(0);
