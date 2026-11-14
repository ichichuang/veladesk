import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Engineering-mode password hashing (t181).
 *
 * The password NEVER lives in client JS and never travels back from the
 * server; only a salted scrypt hash is stored in the data dir
 * (`engineering.json`, see `auth-store.ts`). When no hash has been set
 * the DEFAULT password below unlocks — a self-hosted box must be able to
 * enter Engineering mode before anyone changed the password.
 *
 * Constants: scrypt with Node's standard cost (N=16384, r=8, p=1) and a
 * 16-byte salt — the `crypto.scryptSync` defaults with an explicit keylen,
 * deliberately not tuned per-install so every install hashes alike.
 */

/** The out-of-the-box password (changed via Settings inside Engineering mode). */
export const DEFAULT_ENGINEERING_PASSWORD = "123456";

/** Derived key length in bytes (scrypt keylen). */
const HASH_KEYLEN = 64;

/** Salt length in bytes. */
const SALT_BYTES = 16;

/** The stored credential record (`engineering.json`'s `credential` field). */
export interface PasswordCredential {
  readonly algorithm: "scrypt";
  readonly saltBase64: string;
  readonly hashBase64: string;
}

/** Hashes one password with a fresh random salt. */
export function hashEngineeringPassword(password: string): PasswordCredential {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, HASH_KEYLEN);
  return {
    algorithm: "scrypt",
    saltBase64: salt.toString("base64"),
    hashBase64: hash.toString("base64"),
  };
}

function decodeCredential(value: unknown): PasswordCredential | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.algorithm !== "scrypt" ||
    typeof record.saltBase64 !== "string" ||
    typeof record.hashBase64 !== "string"
  ) {
    return null;
  }
  return {
    algorithm: "scrypt",
    saltBase64: record.saltBase64,
    hashBase64: record.hashBase64,
  };
}

/**
 * Timing-safe password check against a stored credential — or, when no
 * credential is set (null), against the default password (still hashed
 * with a per-process salt so the comparison cost is identical either way).
 */
export function verifyEngineeringPassword(
  candidate: string,
  stored: PasswordCredential | null,
): boolean {
  const credential =
    stored ?? hashEngineeringPasswordWithStableSalt(DEFAULT_ENGINEERING_PASSWORD);
  const salt = Buffer.from(credential.saltBase64, "base64");
  const expected = Buffer.from(credential.hashBase64, "base64");
  const actual = scryptSync(candidate, salt, expected.length);
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/**
 * A fixed-salt hash of the default password: the default path still pays
 * the full scrypt cost and still compares in constant time, but the salt
 * is derived from the password itself rather than randomness so the work
 * is not repeated per attempt against an unconfigured install.
 */
const defaultCredentialRef: { credential: PasswordCredential | null } = {
  credential: null,
};

function hashEngineeringPasswordWithStableSalt(password: string): PasswordCredential {
  if (defaultCredentialRef.credential === null) {
    // Salt derived from a fixed domain string: NOT a secret (the default
    // password is public knowledge anyway) — it only keeps the scrypt
    // call honest on both branches of verify.
    const salt = scryptSync("veladesk-engineering-default-salt", "veladesk", SALT_BYTES);
    defaultCredentialRef.credential = {
      algorithm: "scrypt",
      saltBase64: salt.toString("base64"),
      hashBase64: scryptSync(password, salt, HASH_KEYLEN).toString("base64"),
    };
  }
  return defaultCredentialRef.credential;
}

/** Parses a persisted `credential` field (unknown-in → record-or-null). */
export function parseStoredCredential(value: unknown): PasswordCredential | null {
  return decodeCredential(value);
}

/** Whether a candidate is an acceptable NEW password (6 digits, t181 spec). */
export function isValidNewEngineeringPassword(candidate: string): boolean {
  return /^[0-9]{6}$/.test(candidate);
}
