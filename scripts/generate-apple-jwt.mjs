#!/usr/bin/env node
/**
 * Generates the JWT that Better-Auth uses as APPLE_CLIENT_SECRET.
 *
 * Apple requires a signed JWT (ES256) instead of a long-lived client secret.
 * Max lifetime is 6 months; rotate before expiry and update Vercel env var.
 *
 * Inputs (from env or CLI flags):
 *   APPLE_TEAM_ID            — Apple Developer team id, e.g. ABC1234567
 *   APPLE_KEY_ID             — Sign In with Apple key id, e.g. AB12CD34EF
 *   APPLE_CLIENT_ID          — Services ID, e.g. com.grappes.signin
 *   APPLE_PRIVATE_KEY_FILE   — Path to the .p8 file Apple gave you
 *   (or)
 *   APPLE_PRIVATE_KEY        — The p8 contents inline (BEGIN PRIVATE KEY ...)
 *
 * Usage:
 *   APPLE_TEAM_ID=... APPLE_KEY_ID=... APPLE_CLIENT_ID=... \
 *   APPLE_PRIVATE_KEY_FILE=AuthKey_XXX.p8 \
 *     node scripts/generate-apple-jwt.mjs
 *
 * The JWT is printed to stdout. Pipe it into Vercel env:
 *
 *   node scripts/generate-apple-jwt.mjs | \
 *     xargs -I{} vercel env add APPLE_CLIENT_SECRET production
 */

import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

function require(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return v;
}

const teamId   = require("APPLE_TEAM_ID");
const keyId    = require("APPLE_KEY_ID");
const clientId = require("APPLE_CLIENT_ID");

let privateKey = process.env.APPLE_PRIVATE_KEY;
if (!privateKey) {
  const file = process.env.APPLE_PRIVATE_KEY_FILE;
  if (!file) {
    console.error("Set APPLE_PRIVATE_KEY (inline) or APPLE_PRIVATE_KEY_FILE (path to .p8)");
    process.exit(1);
  }
  privateKey = readFileSync(file, "utf8");
}

// JWT max lifetime: 6 months from `iat`. Apple recommends shorter.
const now = Math.floor(Date.now() / 1000);
const exp = now + 60 * 60 * 24 * 180; // 180 days

const header = { alg: "ES256", kid: keyId, typ: "JWT" };
const claims = {
  iss: teamId,
  iat: now,
  exp,
  aud: "https://appleid.apple.com",
  sub: clientId,
};

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj))
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const signingInput = `${b64url(header)}.${b64url(claims)}`;
const signer = createSign("SHA256");
signer.update(signingInput);
const signatureDer = signer.sign({
  key: privateKey,
  dsaEncoding: "ieee-p1363",
});
const signature = signatureDer
  .toString("base64")
  .replace(/=/g, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

const jwt = `${signingInput}.${signature}`;
console.log(jwt);
console.error(`\n✓ JWT generated (180-day lifetime, expires ${new Date(exp * 1000).toISOString().slice(0, 10)})`);
console.error("Set as APPLE_CLIENT_SECRET on Vercel and rotate before expiry.");
