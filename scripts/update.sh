#!/usr/bin/env bash
#
# VelaDesk source-deployment self-update (方式 B installs, no Docker).
#
#   scripts/update.sh             拉取 main、按需 install、重新 build，然后
#                                 打印重启命令（或配合 --restart 直接重启）
#   scripts/update.sh --check     只检查是否有更新，不改任何东西（给定时器/巡检用）
#   scripts/update.sh --restart   build 成功后尝试 systemctl restart veladesk
#                                 （需要 root；systemd timer 以 root 跑即可全自动）
#
# 数据不受影响：所有持久数据都在 VELADESK_DATA_DIR，更新只换代码。
# 每次启动服务会自动跑数据库迁移；迁移是单向的，升级前建议备份数据目录。
#
# 适合放进 systemd timer / cron 定时执行（详见 docs/DEPLOYMENT.md）。
set -euo pipefail

MODE="update"
case "${1:-}" in
  "") ;;
  --check) MODE="check" ;;
  --restart) MODE="restart" ;;
  -h|--help) grep '^#' "$0" | grep -v '^#!' | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "未知参数: ${1}（支持 --check / --restart）" >&2; exit 2 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

for tool in git pnpm node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "缺少 $tool（部署需要 Node.js ≥24 与 pnpm 11）" >&2; exit 1; }
done

# 老机器常驻着旧版 Node：新版代码依赖 Node ≥24，提前拦截而不是装到一半坏掉
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 24 ]; then
  echo "[update] Node.js 版本过旧（${NODE_MAJOR}.x），VelaDesk 需要 ≥ 24：https://nodejs.org/" >&2
  exit 1
fi

git fetch origin main --quiet
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[update] 已是最新（${LOCAL}）"
  exit 0
fi

echo "[update] 有新版本：${LOCAL} → ${REMOTE}"
echo "[update] 更新内容："
git --no-pager log --oneline "$LOCAL..$REMOTE" | head -20

if [ "$MODE" = "check" ]; then
  echo "[update] --check 模式：以上仅为报告，未做任何改动"
  exit 0
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "[update] 工作区有未提交改动，拒绝自动更新（部署机不应有本地修改）。" >&2
  echo "[update] 确认丢弃这些改动后重试：git -C '$REPO_ROOT' status" >&2
  exit 1
fi

OLD="$LOCAL"
git pull --ff-only origin main

# 只有依赖清单变化时才重装（pnpm install 较慢，没必要每次跑）
if git diff --name-only "$OLD" HEAD | grep -qE '(^|/)package\.json$|pnpm-lock\.yaml$'; then
  echo "[update] 依赖有变化，执行 pnpm install …"
  pnpm install
fi

echo "[update] 重新构建 …"
if ! pnpm build; then
  echo "[update] 构建失败：运行中的服务仍在跑旧版本，本次不重启。" >&2
  echo "[update] 磁盘上的构建产物可能不完整——在下一次成功构建前不要重启服务。" >&2
  exit 1
fi

echo "[update] 构建完成。"
if [ "$MODE" = "restart" ] && command -v systemctl >/dev/null 2>&1; then
  echo "[update] 重启 veladesk 服务 …"
  systemctl restart veladesk
  echo "[update] 完成：systemctl status veladesk"
else
  echo "[update] 手动重启以生效："
  echo "  sudo systemctl restart veladesk        # 有 systemd 单元时"
  echo "  或在 apps/web 下重新以生产环境变量启动 next start"
fi
