#!/usr/bin/env bun
import { eq } from "drizzle-orm";
import { auth } from "../auth";
import { db } from "../db";
import { user } from "../db/schema";
import { generateSipPassword } from "../lib/crypto";
import { allowOneSignup } from "../lib/signup-gate";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg("email");
const name = arg("name");
const supplied = arg("password");

if (!email || !name) {
  console.error(
    "Usage: create-user.ts --email <email> --name <name> [--password <password>]",
  );
  process.exit(2);
}

if (supplied && supplied.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const existing = await db.query.user.findFirst({
  where: eq(user.email, email),
});
if (existing) {
  console.error(`${email} already exists (${existing.id}).`);
  console.error(
    "To attach a tenant to them:  bun run src/cli/provision-tenant.ts --owner " +
      email,
  );
  process.exit(1);
}

const password = supplied ?? generateSipPassword(20);

allowOneSignup();
try {
  await auth.api.signUpEmail({ body: { email, name, password } });
} catch (err) {
  console.error(`Could not create ${email}: ${(err as Error).message}`);
  process.exit(1);
}

const created = await db.query.user.findFirst({ where: eq(user.email, email) });
if (!created) {
  console.error(
    "Signup reported success but no user row exists - check the API logs.",
  );
  process.exit(1);
}

console.log(`\nCreated ${name} <${email}>`);
if (!supplied) {
  console.log(`\n  Password: ${password}\n`);
  console.log("  Save it now. It is stored hashed and cannot be shown again.");
}
console.log(`\nNext, give them a tenant:`);
console.log(
  `  bun run src/cli/provision-tenant.ts --name "Acme Corp" --slug acme \\\n` +
    `    --domain <sip-domain> --owner ${email}`,
);
process.exit(0);
