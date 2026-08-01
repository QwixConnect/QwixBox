import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "../env";

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard
const TAG_BYTES = 16;

const key = createHash("sha256").update(env.encryptionKey).digest();

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(":");
  if (parts.length !== 3) {
    throw new Error("Ciphertext is not in the expected iv:tag:data form");
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function computeHa1(
  username: string,
  realm: string,
  password: string,
): string {
  return createHash("md5")
    .update(`${username}:${realm}:${password}`)
    .digest("hex");
}

export function computeHa1b(
  username: string,
  realm: string,
  password: string,
): string {
  return createHash("md5")
    .update(`${username}@${realm}:${realm}:${password}`)
    .digest("hex");
}

export function generateSipPassword(length = 24): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

export function generateVoicemailPin(length = 6): string {
  for (;;) {
    const bytes = randomBytes(length);
    let pin = "";
    for (let i = 0; i < length; i++) {
      pin += String(bytes[i]! % 10);
    }
    if (/^(\d)\1*$/.test(pin)) continue;
    if ("0123456789012345".includes(pin)) continue;
    return pin;
  }
}
