import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  DEFAULT_ENGINEERING_PASSWORD,
  hashEngineeringPassword,
  isValidNewEngineeringPassword,
  verifyEngineeringPassword,
} from "./password";
import { createEngineeringCredentialStore } from "./auth-store";

describe("engineering password hashing", () => {
  it("round-trips a custom password", () => {
    const credential = hashEngineeringPassword("654321");
    expect(verifyEngineeringPassword("654321", credential)).toBe(true);
    expect(verifyEngineeringPassword("123456", credential)).toBe(false);
  });

  it("salts: the same password hashes differently each time", () => {
    const a = hashEngineeringPassword("000000");
    const b = hashEngineeringPassword("000000");
    expect(a.hashBase64).not.toEqual(b.hashBase64);
    expect(a.saltBase64).not.toEqual(b.saltBase64);
  });

  it("falls back to the default password when no credential is stored", () => {
    expect(verifyEngineeringPassword(DEFAULT_ENGINEERING_PASSWORD, null)).toBe(true);
    expect(verifyEngineeringPassword("000000", null)).toBe(false);
  });

  it("accepts exactly 6 digits as a NEW password", () => {
    expect(isValidNewEngineeringPassword("123456")).toBe(true);
    expect(isValidNewEngineeringPassword("12345")).toBe(false);
    expect(isValidNewEngineeringPassword("1234567")).toBe(false);
    expect(isValidNewEngineeringPassword("12345a")).toBe(false);
    expect(isValidNewEngineeringPassword("")).toBe(false);
  });
});

describe("engineering credential store", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function freshDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "veladesk-eng-"));
    dirs.push(dir);
    return dir;
  }

  it("loads null when nothing is stored (default password path)", () => {
    const store = createEngineeringCredentialStore(freshDir());
    expect(store.load()).toBeNull();
  });

  it("persists and reloads a credential across store instances", () => {
    const dir = freshDir();
    const store = createEngineeringCredentialStore(dir);
    const credential = hashEngineeringPassword("246810");
    store.save(credential);

    const reopened = createEngineeringCredentialStore(dir);
    expect(reopened.load()).toEqual(credential);
    expect(verifyEngineeringPassword("246810", reopened.load())).toBe(true);
  });

  it("falls back to null on a corrupt file (never locks the operator out)", () => {
    const dir = freshDir();
    const store = createEngineeringCredentialStore(dir);
    store.save(hashEngineeringPassword("246810"));

    writeFileSync(join(dir, "engineering.json"), "{not json", "utf8");
    expect(store.load()).toBeNull();
    expect(verifyEngineeringPassword(DEFAULT_ENGINEERING_PASSWORD, store.load())).toBe(true);
  });
});
