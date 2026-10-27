import type { WorkspaceSnapshot } from "@veladesk/domain";

/**
 * THE one module of application-layer protection limits (task vd-guard).
 *
 * Every server-side quota that keeps anonymous visitors from growing
 * storage without bound lives here as a named constant, overridable via
 * the documented `VELADESK_*` env vars. Overrides are parsed safely:
 * missing, blank or non-positive/non-integer values fall back to the
 * default — an operator typo never breaks the server.
 *
 * These are server-side admission limits only. UI behaviour, response
 * shapes and status codes of the happy paths are unchanged; reads and
 * pre-existing data are never re-checked against them.
 */

/** Every limit the server enforces, resolved from the environment. */
export interface VelaDeskLimits {
  // (a) HTTP boundary -------------------------------------------------------
  /** Max bytes of a JSON request body (workspace POST/PUT/PATCH/DELETE). */
  readonly maxJsonBodyBytes: number;
  /** Max pages per snapshot. */
  readonly maxSnapshotPages: number;
  /** Max entities (apps + folders + widgets) per snapshot. */
  readonly maxSnapshotEntities: number;
  /** Max categories per snapshot. */
  readonly maxSnapshotCategories: number;
  /** Max dock items per snapshot. */
  readonly maxSnapshotDockItems: number;
  /** Max placement items of one page (layout.items and canvas.items each). */
  readonly maxSnapshotPageItems: number;
  /** Max children of one folder. */
  readonly maxSnapshotFolderChildren: number;
  /** Max length of any free-text string in a snapshot. */
  readonly maxSnapshotStringLength: number;
  /**
   * Max length of an app `url`. `data:` URLs count too — on purpose:
   * inline image payloads belong in the content-addressed asset store,
   * not in the snapshot.
   */
  readonly maxSnapshotUrlLength: number;

  // (b) revisions -----------------------------------------------------------
  /** Revisions retained per workspace; older rows are pruned per save. */
  readonly maxRevisionsPerWorkspace: number;

  // (c) assets --------------------------------------------------------------
  /** Max live asset files in the assets dir. */
  readonly maxAssetCount: number;
  /** Max summed bytes of live asset files in the assets dir. */
  readonly maxAssetTotalBytes: number;
  /**
   * An unreferenced asset file younger than this is never deleted: the
   * client uploads an image BEFORE saving the snapshot that references
   * it, so fresh files are always presumed to be mid-adoption.
   */
  readonly orphanGraceMs: number;
  /** Opportunistic orphan sweep cadence on upload. */
  readonly orphanSweepIntervalMs: number;

  // (d) data dir ------------------------------------------------------------
  /** Max recursive size of the whole data dir (db + wal/shm + assets). */
  readonly maxDataDirBytes: number;
  /** How long a data-dir size measurement stays cached. */
  readonly dataDirCheckTtlMs: number;
}

/**
 * Parses one positive-integer env override.
 *
 * `undefined`, blank/whitespace-only, non-numeric, fractional, non-positive
 * and non-safe values all resolve to the default — never to zero or NaN.
 */
function positiveIntEnv(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) {
    return fallback;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return fallback;
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/** Pure resolver so tests can feed env records without touching process.env. */
export function resolveLimits(env: {
  readonly [name: string]: string | undefined;
}): VelaDeskLimits {
  return {
    // 512 KiB — a whole-workspace JSON snapshot is a few KiB even when
    // full; 512 KiB leaves >100x headroom while capping abuse.
    maxJsonBodyBytes: positiveIntEnv(env.VELADESK_MAX_JSON_BYTES, 512 * 1024),

    // Snapshot structure: chosen 10x+ above a heavy real desktop (≈5
    // pages, ≈150 entities, ≈10 categories, ≈20 dock/folder entries,
    // ≈100 items per page, short names/urls). Fixed constants, no env:
    // they guard the JSON shape, not operator capacity.
    maxSnapshotPages: 50,
    maxSnapshotEntities: 2000,
    maxSnapshotCategories: 100,
    maxSnapshotDockItems: 200,
    maxSnapshotPageItems: 500,
    maxSnapshotFolderChildren: 200,
    // Every string anywhere in a snapshot (names, descriptions, tags,
    // icon/widget text, ids, wallpaper asset ids, config values): real
    // values stay under ~200 chars; 5000 is generous.
    maxSnapshotStringLength: 5000,
    // URLs: the classic de-facto safe cap. data:/custom-protocol urls are
    // plain strings here and are counted by the same limit.
    maxSnapshotUrlLength: 4096,

    // History: 50 restorable revisions per workspace is plenty of undo
    // depth while bounding the table to 10 workspaces x 50 rows.
    maxRevisionsPerWorkspace: positiveIntEnv(
      env.VELADESK_MAX_REVISIONS_PER_WORKSPACE,
      50,
    ),

    // Assets: 200 files OR 200 MiB, whichever is hit first.
    maxAssetCount: positiveIntEnv(env.VELADESK_MAX_ASSET_COUNT, 200),
    maxAssetTotalBytes: positiveIntEnv(
      env.VELADESK_MAX_ASSET_TOTAL_BYTES,
      200 * 1024 * 1024,
    ),
    // 24 h adoption grace for unreferenced files (see interface docs).
    orphanGraceMs: positiveIntEnv(env.VELADESK_ORPHAN_GRACE_MS, 24 * 60 * 60 * 1000),
    // At most one opportunistic orphan sweep per hour on upload.
    orphanSweepIntervalMs: 60 * 60 * 1000,

    // Whole data dir (SQLite + wal/shm + assets): 500 MiB hard budget.
    maxDataDirBytes: positiveIntEnv(env.VELADESK_MAX_DATA_DIR_BYTES, 500 * 1024 * 1024),
    dataDirCheckTtlMs: positiveIntEnv(env.VELADESK_DATA_DIR_CHECK_TTL_MS, 30_000),
  };
}

/**
 * The process limits, resolved once at module load. Reading the env is
 * side-effect free, so importing route modules never touches state.
 */
export const LIMITS: VelaDeskLimits = resolveLimits(process.env);

/**
 * Why a snapshot exceeded a structural limit. Count/size budgets answer
 * 413 (the payload as a whole is too big); string-shape limits answer 400
 * (`snapshot-limit-exceeded` with the offending limit named).
 */
export interface SnapshotLimitViolation {
  /** 413 for count budgets, 400 for string-length limits. */
  readonly status: 413 | 400;
  /** Stable machine name of the exceeded limit, e.g. `max-snapshot-pages`. */
  readonly limit: string;
}

function countViolation(limit: string): SnapshotLimitViolation {
  return { status: 413, limit };
}

function stringViolation(limit: string): SnapshotLimitViolation {
  return { status: 400, limit };
}

/** Whether any string anywhere in a JSON-shaped value exceeds the budget. */
function anyStringTooLong(value: unknown, maxLength: number): boolean {
  if (typeof value === "string") {
    return value.length > maxLength;
  }
  if (Array.isArray(value)) {
    return value.some((item) => anyStringTooLong(item, maxLength));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((item) => anyStringTooLong(item, maxLength));
  }
  return false;
}

/**
 * Checks a decoded snapshot against the structural limits — on POST/PUT
 * request bodies only, never on reads and never on pre-existing data, so
 * old (even oversized) snapshots keep loading and renaming forever.
 *
 * Count budgets are checked per structure, url-like fields get their
 * tighter cap first, and then ONE generic recursive walk applies the
 * string budget to EVERY string in the snapshot — names, descriptions,
 * tags, icon/widget text, ids, wallpaper asset ids and widget config
 * values alike; no field is skipped, so nothing can hide an oversized
 * payload behind an unchecked property. Returns the first violation, or
 * undefined when the snapshot is within every budget.
 */
export function checkSnapshotLimits(
  snapshot: WorkspaceSnapshot,
  limits: VelaDeskLimits = LIMITS,
): SnapshotLimitViolation | undefined {
  if (snapshot.pages.length > limits.maxSnapshotPages) {
    return countViolation("max-snapshot-pages");
  }
  for (const page of snapshot.pages) {
    if (page.layout.items.length > limits.maxSnapshotPageItems) {
      return countViolation("max-snapshot-page-items");
    }
    if (page.canvas !== undefined && page.canvas.items.length > limits.maxSnapshotPageItems) {
      return countViolation("max-snapshot-page-items");
    }
  }

  if (snapshot.entities.length > limits.maxSnapshotEntities) {
    return countViolation("max-snapshot-entities");
  }
  for (const entity of snapshot.entities) {
    if (entity.kind === "app" && entity.url.length > limits.maxSnapshotUrlLength) {
      return stringViolation("max-snapshot-url-length");
    }
    if (entity.kind === "folder" && entity.children.length > limits.maxSnapshotFolderChildren) {
      return countViolation("max-snapshot-folder-children");
    }
  }

  if (snapshot.categories.length > limits.maxSnapshotCategories) {
    return countViolation("max-snapshot-categories");
  }
  if (snapshot.dock.items.length > limits.maxSnapshotDockItems) {
    return countViolation("max-snapshot-dock-items");
  }
  if (anyStringTooLong(snapshot, limits.maxSnapshotStringLength)) {
    return stringViolation("max-snapshot-string-length");
  }
  return undefined;
}
