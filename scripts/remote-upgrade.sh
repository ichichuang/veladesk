#!/usr/bin/env bash
#
# remote-upgrade.sh — 原地升级已安装的 VelaDesk 发布程序包（无需重新部署）。
#
# 专门给"用 zip / tar.gz 安装"的机器用：从 GitHub Releases 下载对应平台的
# 正式包 → 校验 SHA256 → 解压到安装目录旁的临时目录 → 备份旧目录 → 换入新目录。
# 数据（SQLite / 上传图片 / 工程模式凭据）保存在独立的平台数据目录，
# 全程不受影响。升级完成后按原来的方式启动即可（双击 start-veladesk.cmd
# 或运行 ./start-veladesk.sh），或加 --restart 让脚本代劳。
#
# 用法:
#   scripts/remote-upgrade.sh <安装目录>               升级到最新正式版
#   scripts/remote-upgrade.sh <安装目录> v1.2.3        升级/回退到指定版本
#   scripts/remote-upgrade.sh <安装目录> --restart     完成后停止旧进程并启动新包
#   scripts/remote-upgrade.sh --check [安装目录]       只比较本地与最新版本
#
# 远程一条命令（安装目录按实际路径替换）:
#   curl -fsSL https://raw.githubusercontent.com/ichichuang/veladesk/main/scripts/remote-upgrade.sh \
#     | bash -s -- /path/to/VelaDesk-v1.0.0-macos-arm64
#
# 回退: 换装前旧目录被改名为 <安装目录>.backup-<旧版本>，回退就是把它换回来。
set -euo pipefail

REPO="ichichuang/veladesk"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main/scripts/remote-upgrade.sh"
DEFAULT_PORT=3000

MODE="upgrade"
TARGET_VERSION=""
DO_RESTART=0
INSTALL_DIR="."

# ---------- 参数 ----------
print_help() {
  cat <<'EOF'
remote-upgrade.sh — 原地升级已安装的 VelaDesk 发布程序包（无需重新部署）

用法:
  scripts/remote-upgrade.sh <安装目录>               升级到最新正式版
  scripts/remote-upgrade.sh <安装目录> v1.2.3        升级/回退到指定版本
  scripts/remote-upgrade.sh <安装目录> --restart     完成后停止旧进程并启动新包
  scripts/remote-upgrade.sh --check [安装目录]       只比较本地与最新版本

说明见文件头注释与 docs/DEPLOYMENT.md。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check"; shift ;;
    --restart) DO_RESTART=1; shift ;;
    -h|--help) print_help; exit 0 ;;
    v[0-9]*) TARGET_VERSION="${1#v}"; shift ;;
    *) INSTALL_DIR="$1"; shift ;;
  esac
done

# ---------- 依赖 ----------
for tool in curl tar node; do
  command -v "${tool}" >/dev/null 2>&1 || { echo "[upgrade] 缺少 ${tool}" >&2; exit 1; }
done
if [ "${DO_RESTART}" = "1" ] && ! command -v lsof >/dev/null 2>&1; then
  echo "[upgrade] --restart 需要 lsof（用于停止旧进程）；未安装则请手动重启" >&2
  exit 1
fi
if command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_TOOL="shasum -a 256"
else
  echo "[upgrade] 缺少 sha256sum / shasum（校验下载完整性必需）" >&2
  exit 1
fi

# ---------- 平台 → 程序包资产 ----------
# 官方包只有三种：windows-x64 / linux-x64 / macos-arm64
detect_asset_name() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "${os}" in
    Darwin)
      case "${arch}" in
        arm64) echo "macos-arm64" ;;
        *) echo ""; echo "[upgrade] 暂无 Intel Mac 程序包；请改用 Docker 或源码方式部署（docs/DEPLOYMENT.md）" >&2; return 1 ;;
      esac
      ;;
    Linux)
      case "${arch}" in
        x86_64) echo "linux-x64" ;;
        *) echo ""; echo "[upgrade] 暂无 Linux ARM 程序包；请改用 Docker 或源码方式部署（docs/DEPLOYMENT.md）" >&2; return 1 ;;
      esac
      ;;
    *)
      echo "[upgrade] 本脚本用于 macOS/Linux；Windows 请用 scripts/remote-upgrade.ps1" >&2
      return 1
      ;;
  esac
}

ASSET_PLATFORM="$(detect_asset_name)" || exit 1

# ---------- 安装目录校验 ----------
INSTALL_DIR="$(cd "${INSTALL_DIR}" 2>/dev/null && pwd)" || {
  echo "[upgrade] 安装目录不存在：${INSTALL_DIR}" >&2
  exit 1
}
if [ ! -f "${INSTALL_DIR}/start-veladesk.sh" ]; then
  echo "[upgrade] ${INSTALL_DIR} 不是发布程序包目录（缺少 start-veladesk.sh）。" >&2
  echo "[upgrade] Docker / 源码部署请分别用 docker compose pull 或 scripts/update.sh。" >&2
  exit 1
fi

current_version() {
  # 目录名形如 VelaDesk-v1.0.0-macos-arm64；认不出就返回 unknown（照样可以升级）
  local base detected
  base="$(basename "${INSTALL_DIR}")"
  detected="$(printf '%s' "${base}" | sed -n 's/^VelaDesk-v\([0-9.]*\)-.*/\1/p' || true)"
  printf '%s' "${detected:-unknown}"
}

# ---------- 查询远端版本 ----------
remote_version() {
  curl -fsSL --max-time 30 "${API_URL}" | node -e "
    let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
      try { process.stdout.write(JSON.parse(d).tag_name.replace(/^v/,'')) }
      catch(e){ process.exit(1) }
    })"
}

if [ "${MODE}" = "check" ]; then
  LATEST="$(remote_version)"
  echo "[upgrade] 本地版本：$(current_version)"
  echo "[upgrade] 最新正式版：${LATEST}"
  echo "[upgrade] 升级：curl -fsSL ${RAW_BASE} | bash -s -- ${INSTALL_DIR}"
  exit 0
fi

# ---------- 确定目标版本 ----------
LATEST="$(remote_version)"
VERSION="${TARGET_VERSION:-${LATEST}}"
case "${VERSION}" in
  *[!0-9A-Za-z.-]*|"")
    echo "[upgrade] 版本号不合法：${VERSION}（应形如 1.2.3 或 v1.2.3）" >&2
    exit 1
    ;;
esac
echo "[upgrade] 安装目录：${INSTALL_DIR}"
echo "[upgrade] 当前版本：$(current_version)"
echo "[upgrade] 目标版本：${VERSION}（最新：${LATEST}）"

if [ "${VERSION}" = "$(current_version)" ]; then
  echo "[upgrade] 已是目标版本，无需升级（换指定版本可用：remote-upgrade.sh ${INSTALL_DIR} v<版本号>）"
  exit 0
fi

# ---------- 下载 + 校验 ----------
# 注意：临时目录必须放系统临时目录，不能放安装目录里面——
# 换装的第一步是 mv 安装目录 → backup，放里面会被一起搬走导致换入失败。
ASSET_NAME="VelaDesk-v${VERSION}-${ASSET_PLATFORM}.tar.gz"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

echo "[upgrade] 下载 ${ASSET_NAME} …"
curl -fsSL --max-time 600 -o "${WORK_DIR}/${ASSET_NAME}" \
  "https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET_NAME}"

echo "[upgrade] 校验 SHA256 …"
curl -fsSL --max-time 60 -o "${WORK_DIR}/SHA256SUMS.txt" \
  "https://github.com/${REPO}/releases/download/v${VERSION}/SHA256SUMS.txt"
# 锚定整行匹配 + `|| true`：grep 无匹配会以 exit 1 触发 pipefail 直接杀脚本，
# 让下面的友好报错变成永远走不到的死分支
EXPECT="$(grep -E "^[0-9a-f]{64}[[:space:]]+${ASSET_NAME}\$" "${WORK_DIR}/SHA256SUMS.txt" | awk '{print $1}' || true)"
ACTUAL="$(cd "${WORK_DIR}" && ${SHA_TOOL} "${ASSET_NAME}" | awk '{print $1}')"
if [ -z "${EXPECT}" ] || [ "${EXPECT}" != "${ACTUAL}" ]; then
  echo "[upgrade] SHA256 校验失败（期望 ${EXPECT:-在 SHA256SUMS.txt 中未找到 ${ASSET_NAME}}，实际 ${ACTUAL}），已中止，未改动安装目录。" >&2
  exit 1
fi

echo "[upgrade] 解压 …"
tar xzf "${WORK_DIR}/${ASSET_NAME}" -C "${WORK_DIR}"
NEW_DIR="$(find "${WORK_DIR}" -maxdepth 2 -name start-veladesk.sh -exec dirname {} \; | head -1)"
if [ -z "${NEW_DIR}" ]; then
  echo "[upgrade] 解压结果里找不到 start-veladesk.sh，已中止。" >&2
  exit 1
fi
# 保险：换入前新包必须能找到启动脚本与 runtime
[ -d "${NEW_DIR}/runtime" ] || { echo "[upgrade] 新包缺 runtime/ 目录，已中止。" >&2; exit 1; }

# ---------- 换装（旧目录留作备份） ----------
BACKUP_DIR="${INSTALL_DIR}.backup-$(current_version)"
if [ -e "${BACKUP_DIR}" ]; then
  echo "[upgrade] 移除上一次的备份 ${BACKUP_DIR}"
  rm -rf "${BACKUP_DIR}"
fi

if [ "${DO_RESTART}" = "1" ]; then
  PORT="${VELADESK_PORT:-${DEFAULT_PORT}}"
  OLD_PID="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${OLD_PID}" ]; then
    echo "[upgrade] 停止旧进程（端口 ${PORT}，pid ${OLD_PID}）…"
    kill ${OLD_PID} 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 ${OLD_PID} 2>/dev/null || break
      sleep 1
    done
    kill -9 ${OLD_PID} 2>/dev/null || true
  fi
fi

echo "[upgrade] 换装：旧目录 → $(basename "${BACKUP_DIR}")，新目录 → $(basename "${INSTALL_DIR}")"
mv "${INSTALL_DIR}" "${BACKUP_DIR}"
if ! mv "${NEW_DIR}" "${INSTALL_DIR}"; then
  # 跨文件系统 mv 是"复制+删除"，可能留下半成品 INSTALL_DIR；
  # 旧版本安全地在 BACKUP_DIR 里，先清掉残骸再回滚
  echo "[upgrade] 换入失败，回滚 …" >&2
  rm -rf "${INSTALL_DIR}"
  if ! mv "${BACKUP_DIR}" "${INSTALL_DIR}"; then
    echo "[upgrade] 回滚也失败了！旧版本完整保留在 ${BACKUP_DIR}，请手动改名恢复。" >&2
    exit 1
  fi
  exit 1
fi

echo "[upgrade] 完成：${INSTALL_DIR} 现在是 v${VERSION}"
echo "[upgrade] 旧版本保留在 ${BACKUP_DIR}（确认正常后可删除它）"

if [ "${DO_RESTART}" = "1" ]; then
  echo "[upgrade] 启动新版本 …"
  (cd "${INSTALL_DIR}" && nohup ./start-veladesk.sh > "${INSTALL_DIR}/upgrade-restart.log" 2>&1 &)
  # 轮询 30 秒等端口上线（首次启动可能要跑迁移），失败时以非零退出供自动化识别
  UP=0
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    sleep 2
    if lsof -ti "tcp:${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      UP=1
      break
    fi
  done
  if [ "${UP}" = "1" ]; then
    echo "[upgrade] 已在端口 ${PORT} 重新上线（日志：${INSTALL_DIR}/upgrade-restart.log）"
  else
    echo "[upgrade] 30 秒内未检测到端口监听，升级本身已完成；请查看 ${INSTALL_DIR}/upgrade-restart.log 或手动启动。" >&2
    exit 1
  fi
else
  echo "[upgrade] 按原方式重启即可生效（关掉旧启动窗口，再运行 start-veladesk）。"
  echo "[upgrade] 或下次直接加 --restart 参数让脚本代劳。"
fi
