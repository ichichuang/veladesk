import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PasswordCredential } from "./password";
import { parseStoredCredential } from "./password";

/**
 * File-backed Engineering-mode credential store (t181).
 *
 * One JSON file — `<dataDir>/engineering.json` — holds the salted scrypt
 * hash of the Engineering-mode password. It lives inside the existing
 * data dir (the documented backup boundary: the whole dir backs up the
 * install), next to the SQLite database and the assets folder, and is
 * written atomically (temp file + rename) so a crash mid-change can never
 * leave a truncated credential behind.
 *
 * The store is injectable-path for tests; the server runtime wires the
 * real path from `resolveServerConfig`.
 */

interface EngineeringFileShape {
  readonly version: 1;
  readonly credential?: unknown;
}

/** Read/write access to `engineering.json` for one data dir. */
export interface EngineeringCredentialStore {
  /** The stored credential, or null when none has been set (default password). */
  load(): PasswordCredential | null;
  /** Persists a new credential atomically. */
  save(credential: PasswordCredential): void;
}

class FileEngineeringCredentialStore implements EngineeringCredentialStore {
  constructor(private readonly filePath: string) {}

  load(): PasswordCredential | null {
    let text: string;
    try {
      text = readFileSync(this.filePath, "utf8");
    } catch {
      // Missing or unreadable file = no custom password configured; the
      // default password path applies. Any other data is a parse error
      // and deliberately also falls back (an operator can always recover
      // by deleting the file) — but a CORRUPT file never silently keeps
      // a credential that could lock the operator out.
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const version = (parsed as Record<string, unknown>).version;
    if (version !== 1) {
      return null;
    }
    return parseStoredCredential((parsed as Record<string, unknown>).credential);
  }

  save(credential: PasswordCredential): void {
    const body: EngineeringFileShape = { version: 1, credential };
    const temporary = `${this.filePath}.tmp`;
    mkdirSync(join(this.filePath, ".."), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    renameSync(temporary, this.filePath);
  }
}

/** Builds the store for a data dir (file: `<dataDir>/engineering.json`). */
export function createEngineeringCredentialStore(dataDir: string): EngineeringCredentialStore {
  return new FileEngineeringCredentialStore(join(dataDir, "engineering.json"));
}
