#!/usr/bin/env bash
# VelaDesk production deploy entry point — RackNerd (systemd + release-pointer
# layout). Repository source of truth; installed on the host verbatim as
# /usr/local/sbin/veladesk-deploy.sh (root:root 0755) and reachable by the
# `veladesk-deploy` account through exactly one sudoers entry:
#
#   veladesk-deploy ALL=(root) NOPASSWD: /usr/local/sbin/veladesk-deploy.sh
#
# Contract (docs/DEPLOYMENT.md 「RackNerd 自动部署」):
#   - Accepts ONLY validated release identifiers. No paths, no commands:
#       --commit <40-hex sha>   the exact main SHA whose CI passed
#       --sha256 <64-hex>       checksum of the staged tarball
#       --run-id <digits>       the GitHub Actions run number (staleness gate)
#     All filesystem locations are derived internally from constants below.
#   - The CI runner stages the tarball (renamed veladesk-<sha40>.tar.gz) into
#     the upload directory first; this script verifies the checksum itself.
#   - Serialized by flock; under the lock it rejects stale runs (a newer run
#     already deployed) and treats the already-deployed SHA as a no-op.
#   - Before touching production: verifies the tarball layout, boots the
#     staged release on a throwaway port with disposable data, takes a
#     consistent backup (online SQLite backup + integrity check + assets +
#     engineering credentials), and records the migration fingerprint.
#   - Rollback rules (task §4): a post-switch failure rolls back ONLY when
#     the migration fingerprint is unchanged. If migrations ran (or the
#     fingerprint is unreadable), it HALTS on the new release and reports the
#     backup + previous release instead of risking old code on a newer DB.
#
# Exit codes: 0 success / no-op / stale-skip · 1 failed (rolled back or
# aborted before the switch) · 2 halted after migrations ran.
#
# Env overrides exist ONLY for rehearsing against disposable paths — they are
# never set by CI.

set -euo pipefail

# ---------------- fixed production layout ----------------
APP_ROOT="${VD_APP_ROOT:-/opt/veladesk}"
DATA_DIR="${VD_DATA_DIR:-/var/lib/veladesk}"
BACKUP_ROOT="${VD_BACKUP_ROOT:-/var/backups}"
UPLOAD_DIR="${VD_UPLOAD_DIR:-/var/tmp/veladesk-deploy}"
UNIT_NAME="${VD_UNIT_NAME:-veladesk}"
SVC_USER="${VD_SVC_USER:-veladesk}"
HEALTH_URL="${VD_HEALTH_URL:-http://127.0.0.1:3000}"
HEALTH_TIMEOUT="${VD_HEALTH_TIMEOUT:-90}"
SMOKE_PORT="${VD_SMOKE_PORT:-3999}"
STATE_FILE="${VD_STATE_FILE:-/opt/veladesk/last-deploy.json}"
LOCK_FILE="${VD_LOCK_FILE:-/run/veladesk-deploy.lock}"
LOG_DIR="${VD_LOG_DIR:-/var/log}"

CUR_LINK="$APP_ROOT/current"
RELEASES_DIR="$APP_ROOT/releases"

# ---------------- validated input ----------------
COMMIT=""
SHA256=""
RUN_ID=""

is_commit() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
is_sha256() { [[ "$1" =~ ^[0-9a-f]{64}$ ]]; }
is_run_id() { [[ "$1" =~ ^[0-9]{1,15}$ ]]; }
# Release archives are named by the packager: VelaDesk-vX.Y.Z-<platform>-<arch>.
is_bundle_dir() { [[ "$1" =~ ^VelaDesk-v[0-9]+\.[0-9]+\.[0-9]+-linux-x64$ ]]; }

self_test() {
  local failures=0
  check() { # check <description> <fn> <input> <expected(0/1)>
    if "$2" "$3"; then local got=0; else local got=1; fi
    if [ "$got" != "$4" ]; then echo "FAIL: $1"; failures=$((failures + 1)); else echo "ok: $1"; fi
  }
  check "full sha accepted"        is_commit "1f1c78e07baf953d20b968eb739653a3c10a2f2c" 0
  check "short sha rejected"       is_commit "1f1c78e" 1
  check "uppercase sha rejected"   is_commit "1F1C78E07BAF953D20B968EB739653A3C10A2F2C" 1
  check "non-hex rejected"         is_commit "zz1c78e07baf953d20b968eb739653a3c10a2f2cz" 1
  check "sha256 accepted"          is_sha256 "8b64c1630fe7d7187c3a66743e74dc0147d0535ec694fe9794e08d96b6e07e2b" 0
  check "sha256 length rejected"   is_sha256 "8b64c163" 1
  check "run id accepted"          is_run_id "43875220323" 0
  check "run id non-digits"        is_run_id "438a" 1
  check "run id empty"             is_run_id "" 1
  check "bundle dir accepted"      is_bundle_dir "VelaDesk-v1.0.0-linux-x64" 0
  check "wrong platform rejected"  is_bundle_dir "VelaDesk-v1.0.0-darwin-arm64" 1
  check "no version rejected"      is_bundle_dir "VelaDesk-linux-x64" 1
  check "traversal rejected"       is_bundle_dir "../evil" 1
  if [ "$failures" -gt 0 ]; then echo "self-test: $failures failure(s)"; exit 1; fi
  echo "self-test: all checks passed"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="${2:-}"; shift 2 ;;
    --sha256) SHA256="${2:-}"; shift 2 ;;
    --run-id) RUN_ID="${2:-}"; shift 2 ;;
    --self-test) self_test; exit 0 ;;
    *) echo "ERROR: unknown argument: $1" >&2; exit 1 ;;
  esac
done

# ---------------- helpers ----------------
log()  { printf '\n==> %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }

TS="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/veladesk-deploy-$TS.log"
BACKUP_DIR=""
REL_DIR=""
OLD_TARGET=""
OLD_COMMIT=""
SWITCHED=0
RESULT="FAILED"
MIG_BEFORE="unreadable"
exit_code=1

finish() {
  set +e
  echo
  echo "=================================================="
  echo "RESULT: $RESULT"
  echo "deployed_sha: ${COMMIT:-<none>}"
  echo "release: $(basename "${REL_DIR:-/unset}")"
  echo "previous_release: $(basename "${OLD_TARGET:-<none>}")${OLD_COMMIT:+ ($OLD_COMMIT)}"
  echo "backup: ${BACKUP_DIR:-<none>}"
  echo "current -> $(readlink -f "$CUR_LINK" 2>/dev/null)"
  echo "service: $(systemctl is-active "$UNIT_NAME" 2>/dev/null)"
  echo "=================================================="
  exit "$exit_code"
}

die() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

http_code() { curl -s -o /dev/null -m 10 -w '%{http_code}' "$1" 2>/dev/null || true; }

wait_200() { # $1 = seconds; prints final code, returns 1 unless 200
  local c="000" i
  for i in $(seq 1 "$1"); do
    c="$(http_code "$HEALTH_URL/")"
    [ "$c" = "200" ] && { echo 200; return 0; }
    sleep 1
  done
  echo "$c"; return 1
}

# Online SQLite backup through the known-good CURRENT release runtime
# (mirrors /usr/local/sbin/veladesk-daily-backup.sh).
sql_backup() { # $1 = better-sqlite3 module dir, $2 = src db, $3 = dest db
  runuser -u "$SVC_USER" -- env PATH="$PATH" node -e '
    const [mod, src, dst] = process.argv.slice(1);
    const Database = require(mod);
    const db = new Database(src, { fileMustExist: true, timeout: 10000 });
    db.backup(dst).then(() => { db.close();
      const b = new Database(dst, { readonly: true });
      const ic = b.pragma("integrity_check", { simple: true });
      const t = b.prepare("select count(*) as n from sqlite_master where type=\x27table\x27").get().n;
      b.close(); console.log("integrity=" + ic + " tables=" + t);
      if (ic !== "ok" || t < 1) process.exit(2);
    }).catch((e) => { console.error(String(e)); process.exit(1); });
  ' "$1" "$2" "$3"
}

# Migration fingerprint: every migration-ish table with row count + max(id).
# Drizzle's migrator records applied migrations in a table (name may vary by
# driver version), so detect dynamically instead of hardcoding.
mig_fingerprint() { # $1 = better-sqlite3 module dir; prints "<table>:<n>:<max>|..." or "none"
  local out rc
  set +e
  out="$(runuser -u "$SVC_USER" -- env PATH="$PATH" node -e '
    const [mod, src] = process.argv.slice(1);
    const Database = require(mod);
    const db = new Database(src, { readonly: true, fileMustExist: true, timeout: 10000 });
    const tables = db.prepare("select name from sqlite_master where type=\x27table\x27 and name like \x27%migrations%\x27").all();
    if (tables.length === 0) { console.log("none"); db.close(); process.exit(0); }
    const parts = tables.map((t) => {
      const row = db.prepare(`select count(*) as n, coalesce(max(id), \x27\x27) as m from "${t.name}"`).get();
      return `${t.name}:${row.n}:${row.m}`;
    });
    db.close(); console.log(parts.join("|"));
  ' "$1" "$DATA_DIR/veladesk.db" 2>&1)"
  rc=$?
  set -e
  if [ "$rc" -ne 0 ]; then
    info "fingerprint read failed (rc=$rc): ${out:0:300}"
    echo "unreadable"
  else
    echo "$out"
  fi
}

current_sqlite3_module() {
  local d root
  root="$(readlink -f "$CUR_LINK")"
  d="$root/runtime/node_modules/better-sqlite3"
  if [ ! -d "$d" ]; then
    # pnpm isolated layout (packaged release bundles from package-release.mjs)
    d="$(ls -d "$root"/runtime/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3 2>/dev/null | head -n1 || true)"
  fi
  [ -d "$d" ] || die "better-sqlite3 not found in the current release ($root/runtime)"
  echo "$d"
}

kill_smoke() { # kill anything still listening on the smoke port
  local pids
  pids="$(ss -tlnp 2>/dev/null | awk -v p=":$SMOKE_PORT " '$4 ~ p {print}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)"
  [ -z "$pids" ] || kill $pids 2>/dev/null || true
}

# ======================= main =======================
main() {
trap finish EXIT
exec > >(tee -a "$LOG_FILE") 2>&1
echo "log: $LOG_FILE"

# ---- 0. preflight (no changes yet) ----
log "0/7 preflight"
[ "$(id -u)" -eq 0 ] || die "please run as root"
[ "$(uname -m)" = "x86_64" ] || die "linux-x64 host expected, found $(uname -m)"
is_commit "$COMMIT" || die "--commit must be a 40-char lowercase hex sha"
is_sha256 "$SHA256" || die "--sha256 must be a 64-char lowercase hex digest"
is_run_id "$RUN_ID" || die "--run-id must be digits only"
command -v node >/dev/null || die "node not found"
command -v curl >/dev/null || die "curl not found"
command -v runuser >/dev/null || die "runuser not found"
systemctl cat "$UNIT_NAME" >/dev/null 2>&1 || die "systemd unit $UNIT_NAME not found"
[ -L "$CUR_LINK" ] || die "$CUR_LINK is not a symlink (unexpected state)"
[ -d "$RELEASES_DIR" ] || die "$RELEASES_DIR missing (unexpected state)"
[ -f "$DATA_DIR/veladesk.db" ] || die "$DATA_DIR/veladesk.db missing (unexpected state)"
id "$SVC_USER" >/dev/null 2>&1 || die "user $SVC_USER missing"

exec 9>"$LOCK_FILE"
flock -n 9 || die "another veladesk deploy is running"
info "lock acquired: $LOCK_FILE"

OLD_TARGET="$(readlink -f "$CUR_LINK")"
[ -x "$OLD_TARGET/start-veladesk.sh" ] || die "current release $OLD_TARGET has no start-veladesk.sh"
OLD_COMMIT="$(cat "$OLD_TARGET/COMMIT" 2>/dev/null || echo unknown)"
SQL_MOD="$(current_sqlite3_module)"
info "node $(node -v); current -> $OLD_TARGET (commit $OLD_COMMIT)"

# ---- 1. idempotence + staleness under the lock ----
log "1/7 idempotence / staleness"
if [ "$OLD_COMMIT" = "$COMMIT" ]; then
  RESULT="NO-OP"; exit_code=0
  info "$COMMIT is already the deployed release; nothing to do"
  return 0 2>/dev/null || exit 0
fi
if [ -f "$STATE_FILE" ]; then
  LAST_RUN="$(node -e 'const fs=require("fs");try{console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).run||0)}catch{console.log(0)}' "$STATE_FILE" 2>/dev/null || echo 0)"
  LAST_SHA="$(node -e 'const fs=require("fs");try{console.log(JSON.parse(fs.readFileSync(process.argv[1],"utf8")).sha||"")}catch{console.log("")}' "$STATE_FILE" 2>/dev/null || echo "")"
  if [ "$LAST_RUN" -ge "$RUN_ID" ] && [ -n "$LAST_SHA" ] && [ "$LAST_SHA" != "$COMMIT" ]; then
    RESULT="STALE"; exit_code=0
    info "run $RUN_ID is stale: run $LAST_RUN already deployed ${LAST_SHA:0:7}; skipping"
    return 0 2>/dev/null || exit 0
  fi
fi

# ---- 2. verify + unpack the staged tarball ----
log "2/7 staged tarball"
TARBALL="$UPLOAD_DIR/veladesk-$COMMIT.tar.gz"
[ -f "$TARBALL" ] || die "staged tarball not found: $TARBALL (did CI upload it?)"
ACTUAL_SHA="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
[ "$ACTUAL_SHA" = "$SHA256" ] || die "checksum mismatch: expected $SHA256, got $ACTUAL_SHA"
info "checksum ok ($SHA256)"

INCOMING="$RELEASES_DIR/.incoming-$$"
rm -rf "$INCOMING"; mkdir -p "$INCOMING"
tar -xzf "$TARBALL" -C "$INCOMING"
TOP="$(ls -1 "$INCOMING")"
[ "$(printf '%s\n' "$TOP" | wc -l)" -eq 1 ] || die "tarball must contain exactly one top-level directory"
is_bundle_dir "$TOP" || die "unexpected bundle directory name: $TOP"
[ -f "$INCOMING/$TOP/start-veladesk.sh" ] || die "bundle has no start-veladesk.sh"
[ -d "$INCOMING/$TOP/runtime" ] || die "bundle has no runtime/ directory"
[ -x "$INCOMING/$TOP/start-veladesk.sh" ] || chmod 755 "$INCOMING/$TOP/start-veladesk.sh"
VERSION="$(cat "$INCOMING/$TOP/VERSION" 2>/dev/null || echo "")"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "bundle VERSION file missing or malformed"
SHORT="${COMMIT:0:7}"
REL_DIR="$RELEASES_DIR/v$VERSION-$SHORT"
info "bundle v$VERSION -> release dir $(basename "$REL_DIR")"
if [ -d "$REL_DIR" ]; then
  EXISTING_COMMIT="$(cat "$REL_DIR/COMMIT" 2>/dev/null || echo absent)"
  [ "$EXISTING_COMMIT" = "$COMMIT" ] || die "$REL_DIR already exists for a different commit ($EXISTING_COMMIT)"
  info "release dir already staged with this commit; reusing it"
  rm -rf "$INCOMING"
else
  printf '%s\n' "$COMMIT" > "$INCOMING/$TOP/COMMIT"
  mv "$INCOMING/$TOP" "$REL_DIR"
  rmdir "$INCOMING" 2>/dev/null || true
fi
chown -R root:root "$REL_DIR"

# ---- 3. smoke the staged release with disposable data ----
log "3/7 staged smoke (port $SMOKE_PORT, disposable data)"
if ss -tln 2>/dev/null | awk -v p=":$SMOKE_PORT " '$4 ~ p {found=1} END{exit !found}'; then
  die "smoke port $SMOKE_PORT is already in use"
fi
SMOKE_DATA="$UPLOAD_DIR/smoke-$$"
SMOKE_LOG="$UPLOAD_DIR/smoke-$$.log"
rm -rf "$SMOKE_DATA"; mkdir -p "$SMOKE_DATA"; chown "$SVC_USER" "$SMOKE_DATA"; chmod 700 "$SMOKE_DATA"
setsid runuser -u "$SVC_USER" -- \
  env PATH="$PATH" VELADESK_PORT="$SMOKE_PORT" VELADESK_DATA_DIR="$SMOKE_DATA" \
  "$REL_DIR/start-veladesk.sh" >"$SMOKE_LOG" 2>&1 &
SMOKE_BG=$!
SMOKE_CODE="000"
for _ in $(seq 1 60); do
  SMOKE_CODE="$(http_code "http://127.0.0.1:${SMOKE_PORT}/api/v1/workspaces")"
  [ "$SMOKE_CODE" = "200" ] && break
  sleep 1
done
# setsid made $SMOKE_BG a session/pg leader, so -PGID is the whole tree.
for _ in $(seq 1 15); do kill -0 "$SMOKE_BG" 2>/dev/null || break; sleep 1; done
kill -TERM -- "-$SMOKE_BG" 2>/dev/null || true
kill_smoke
if [ "$SMOKE_CODE" != "200" ]; then
  RESULT="FAILED-STAGE-SMOKE"
  # Diagnostics first: the boot log is the ONLY record of why (the process
  # is already gone). Print it here so CI captures it, and keep the file.
  echo "---- smoke boot log (last 40 lines) ----"
  tail -40 "$SMOKE_LOG" 2>/dev/null || echo "(no smoke log)"
  echo "----------------------------------------"
  mv "$SMOKE_LOG" "$UPLOAD_DIR/smoke-failed-$COMMIT.log" 2>/dev/null || true
  rm -rf "$SMOKE_DATA"
  die "staged release failed its disposable-data smoke (HTTP $SMOKE_CODE); production untouched"
fi
rm -rf "$SMOKE_DATA" "$SMOKE_LOG"
info "staged release serves /api/v1/workspaces 200 on disposable data"

# ---- 4. consistent backup (verify readable before continuing) ----
log "4/7 backup"
STAGE="$BACKUP_ROOT/.veladesk-deploy-staging-$TS"
rm -rf "$STAGE"; mkdir -p "$STAGE"; chown "$SVC_USER" "$STAGE"; chmod 700 "$STAGE"
CHECK="$(sql_backup "$SQL_MOD" "$DATA_DIR/veladesk.db" "$STAGE/veladesk.db")" \
  || { RESULT="FAILED-BACKUP"; rm -rf "$STAGE"; die "online SQLite backup failed"; }
chown -R root:root "$STAGE"
if [ -d "$DATA_DIR/assets" ]; then
  cp -al "$DATA_DIR/assets" "$STAGE/assets" 2>/dev/null || cp -a "$DATA_DIR/assets" "$STAGE/assets"
fi
cp -p "$DATA_DIR"/*.json "$STAGE/" 2>/dev/null || true
printf '%s\n' "$CHECK" > "$STAGE/check.txt"
case "$CHECK" in
  "integrity=ok tables="*) : ;;
  *) RESULT="FAILED-BACKUP"; rm -rf "$STAGE"; die "backup verification failed: $CHECK" ;;
esac
BACKUP_DIR="$BACKUP_ROOT/veladesk-deploy-$TS"
mv "$STAGE" "$BACKUP_DIR"
info "backup $BACKUP_DIR ($CHECK)"

# ---- 5. migration fingerprint (before) ----
log "5/7 migration fingerprint"
MIG_BEFORE="$(mig_fingerprint "$SQL_MOD")"
info "before: $MIG_BEFORE"

# ---- 6. switch + restart + health ----
log "6/7 switch + restart"
ln -sfn "$REL_DIR" "$CUR_LINK.incoming-$$" && mv -Tf "$CUR_LINK.incoming-$$" "$CUR_LINK"
SWITCHED=1
systemctl restart "$UNIT_NAME"
CODE="$(wait_200 "$HEALTH_TIMEOUT" || true)"
if [ "$CODE" = "200" ]; then
  info "service healthy on $HEALTH_URL"
else
  # Health failed. Roll back ONLY when migrations provably did not run.
  MIG_AFTER="$(mig_fingerprint "$SQL_MOD")"
  info "after: $MIG_AFTER"
  if [ "$MIG_BEFORE" != "unreadable" ] && [ "$MIG_AFTER" = "$MIG_BEFORE" ]; then
    log "rollback (migrations unchanged)"
    ln -sfn "$OLD_TARGET" "$CUR_LINK.rollback-$$" && mv -Tf "$CUR_LINK.rollback-$$" "$CUR_LINK"
    systemctl restart "$UNIT_NAME"
    SWITCHED=0
    RBCODE="$(wait_200 60 || true)"
    if [ "$RBCODE" = "200" ]; then
      RESULT="ROLLED-BACK"
      die "new release failed health (HTTP $CODE); rolled back to $(basename "$OLD_TARGET"), site answers 200 again"
    fi
    RESULT="ROLLBACK-DEGRADED"
    journalctl -u "$UNIT_NAME" -n 40 --no-pager 2>/dev/null || true
    die "rollback to $(basename "$OLD_TARGET") completed but health returns $RBCODE — INSPECT MANUALLY; backup: $BACKUP_DIR"
  fi
  RESULT="HALTED-MIGRATED"; exit_code=2
  journalctl -u "$UNIT_NAME" -n 40 --no-pager 2>/dev/null || true
  cat <<EOF >&2

!!! HALT: the new release failed health (HTTP $CODE) but the migration
!!! fingerprint changed (before: $MIG_BEFORE / after: $MIG_AFTER) or could not
!!! be read. Old code must NOT run against the migrated database, so NO
!!! automatic rollback was performed. The unit keeps retrying the new release.
!!!
!!! Recovery decision is manual:
!!!   previous release : $OLD_TARGET (commit $OLD_COMMIT)
!!!   current (broken) : $REL_DIR (commit $COMMIT)
!!!   consistent backup: $BACKUP_DIR
!!!   To restore: stop $UNIT_NAME, restore $BACKUP_DIR into $DATA_DIR, point
!!!   $CUR_LINK back at $OLD_TARGET, start $UNIT_NAME.
EOF
  exit 2
fi

# ---- 7. record + verify identity ----
log "7/7 record"
[ "$(readlink -f "$CUR_LINK")" = "$REL_DIR" ] || { RESULT="FAILED-VERIFY"; die "current does not point at $REL_DIR"; }
[ "$(cat "$REL_DIR/COMMIT")" = "$COMMIT" ] || { RESULT="FAILED-VERIFY"; die "release COMMIT mismatch"; }
WS="$(curl -fsS -m 10 "$HEALTH_URL/api/v1/workspaces" 2>/dev/null \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d).workspaces.length)}catch{console.log("ERR")}})' || echo ERR)"
printf '{\n  "run": %s,\n  "sha": "%s",\n  "release": "%s",\n  "previous_release": "%s",\n  "previous_sha": "%s",\n  "backup": "%s",\n  "workspaces": "%s",\n  "ts": "%s",\n  "result": "SUCCESS"\n}\n' \
  "$RUN_ID" "$COMMIT" "$(basename "$REL_DIR")" "$(basename "$OLD_TARGET")" "$OLD_COMMIT" "$BACKUP_DIR" "$WS" "$(date -Is)" \
  > "$STATE_FILE"
chmod 644 "$STATE_FILE"
info "state: $STATE_FILE"
info "workspaces visible: $WS (count only, content never logged)"
RESULT="SUCCESS"; exit_code=0
}

main "$@"
