# 部署指南

VelaDesk 是一个**单进程** Node.js 应用：一个 Next.js 16 服务同时承担网页、API 和 SQLite 数据库，
没有独立的后端服务、没有外部数据库、没有消息队列。部署它 = 找一台有**持久磁盘**的常驻主机，
跑起这个进程，挂好数据目录。

> **不适合 serverless**（Vercel / Netlify / Cloudflare Workers 等）：
> VelaDesk 把数据写进本地 SQLite 文件和本地磁盘上的上传图片，需要持久卷和常驻进程。
> 任何能跑 Docker 或长驻 Node 进程的地方都可以：VPS、家里的 NAS、树莓派、内网服务器。

---

## 方式 A：Docker Compose（推荐）

仓库根目录自带 `Dockerfile` 和 `docker-compose.yml`。最快路径是直接拉官方镜像
（每次正式发版后由 CI 自动发布到 GHCR）：

```bash
git clone https://github.com/ichichuang/veladesk.git
cd veladesk
docker compose pull && docker compose up -d
```

没有外网拉镜像、或想自己构建的，用 `docker compose up -d --build`（等价于本地构建）。

然后打开 `http://<主机IP>:3000`。

- 数据（SQLite 数据库、上传的图片、工程模式凭据）全部存在 named volume `veladesk-data`
  （容器内 `/data`），`docker compose down` 不会丢数据。
- 想换对外端口：`VELADESK_PORT=8080 docker compose up -d`（改的是宿主机映射端口，
  容器内固定 3000）。
- 健康检查已内置：容器每 30 秒请求一次 `/api/v1/workspaces`。

备份数据：

```bash
docker run --rm -v veladesk_veladesk-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/veladesk-data.tgz /data
```

## 方式 B：从源码部署（不用 Docker）

需要 Node.js ≥ 24（以 `.nvmrc` 为准）和 pnpm 11（以根 `package.json` 的
`packageManager` 字段为准，当前 `pnpm@11.17.0`）。

```bash
git clone https://github.com/ichichuang/veladesk.git
cd veladesk
pnpm install
pnpm build
```

**生产启动必须设置两个环境变量**（`NODE_ENV=production` 时服务会拒绝启动，
见 `apps/web/server/config.ts`）：

```bash
mkdir -p /srv/veladesk/data
cd apps/web
NODE_ENV=production \
VELADESK_DATA_DIR=/srv/veladesk/data \
VELADESK_MIGRATIONS_DIR=/path/to/veladesk/packages/database/drizzle \
HOSTNAME=0.0.0.0 \
PORT=3000 \
node node_modules/next/dist/bin/next start
```

systemd 单元示例（`/etc/systemd/system/veladesk.service`）：

```ini
[Unit]
Description=VelaDesk start page
After=network.target

[Service]
Type=simple
User=veladesk
WorkingDirectory=/opt/veladesk/apps/web
Environment=NODE_ENV=production
Environment=VELADESK_DATA_DIR=/srv/veladesk/data
Environment=VELADESK_MIGRATIONS_DIR=/opt/veladesk/packages/database/drizzle
Environment=HOSTNAME=0.0.0.0
Environment=PORT=3000
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## 环境变量

| 变量 | 必填 | 作用 |
| --- | --- | --- |
| `VELADESK_DATA_DIR` | **生产必填** | 数据目录：SQLite 数据库（`veladesk.db`）、上传图片（`assets/`）、工程模式凭据（`engineering.json`）。整个目录就是备份边界 |
| `VELADESK_MIGRATIONS_DIR` | **生产必填** | 数据库迁移 SQL 目录，指向仓库内 `packages/database/drizzle` |
| `HOSTNAME` / `PORT` | 否 | `next start` 的监听地址/端口；Docker 镜像默认 `0.0.0.0:3000` |
| `VELADESK_HOST` / `VELADESK_PORT` | 否 | **仅发布程序包**的启动脚本读取（映射成 `HOSTNAME`/`PORT`），Docker 与源码部署不使用 |
| `VELADESK_DEV_ALLOWED_ORIGINS` | 否 | 仅开发服务器使用，与生产部署无关 |

## 公网部署：必须 HTTPS

浏览器端生成标识符依赖 `crypto.randomUUID()`，它**只在安全上下文可用**
（`http://localhost` 或任意 HTTPS 地址）。用明文 HTTP 从非本机地址访问时，
创建工作区/磁贴等操作会直接失败 —— 这是有意的安全降级，不是 bug。

所以：

- 只在本机用：`http://localhost:3000` 直接可用。
- 局域网内给手机用：要么接受"只读浏览"，要么上 HTTPS（自签/内网证书 + 反向代理）。
- 公网部署：**必须**在反向代理上配 HTTPS。

Caddy 最省事（自动申请证书）：

```caddy
veladesk.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Nginx 参考：

```nginx
server {
    listen 443 ssl;
    server_name veladesk.example.com;
    # ssl_certificate / ssl_certificate_key 按你的证书填写
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 首次启动之后

1. 打开站点，按页面引导创建第一个工作区（全新安装时创建工作区不需要解锁，保证 onboarding 可用）。
2. **修改工程模式默认密码。** VelaDesk 默认处于"使用模式"（只读浏览 + 打开网站），
   整理/编辑功能在"工程模式"里，工程模式由密码保护，**出厂默认密码是 `123456`**：

   - 进入方式：在品牌/标题区域或空白桌面背景上**快速连点 7 次**（每次间隔 ≤ 400ms），
     弹出密码框，输入默认密码 `123456` 解锁。
   - 改密：解锁后在 **设置 → 通用 → 修改密码**（需要先输当前密码）。
   - 会话：解锁后 30 分钟无操作自动退出；关闭浏览器也会退出。
   - 权限模型：读取接口对所有人开放；**所有改写接口**（工作区增删改、上传图片）都要求
     工程模式会话（httpOnly Cookie），未解锁一律 401。

   公网实例务必改掉默认密码，否则任何知道地址的人都可以解锁编辑。

## 版本更新与自动升级

VelaDesk 每次正式发版（打 `v*` 标签）后，CI 会自动把多架构镜像
（linux/amd64 + linux/arm64）发布到 `ghcr.io/ichichuang/veladesk`，
标签有 `latest`（最新正式版）和 `v<版本号>`（可固定版本）。
前端和后端是同一个镜像、同一个进程，更新镜像 = 两者一起更新。
数据在 volume 里，升级只换代码，不动数据。

> **一次性设置**：GitHub 的容器镜像首次发布后默认是**私有**的。
> 第一次发版后请到 GitHub → 你的头像 → Packages → `veladesk` →
> Package settings → Change visibility → **Public**，之后任何人（包括部署
> AI）都能匿名拉取。这个设置只需做一次。

### Docker 手动升级

```bash
docker compose pull && docker compose up -d     # 升到 latest
```

想固定在某个版本不自动跟新，把 compose 里的镜像标签改成 `v<版本号>` 即可。

### Docker 全自动静默升级（Watchtower）

在部署机上加一个 Watchtower 服务（例如放进 `docker-compose.yml`），它按间隔
检查 GHCR、发现新镜像后自动拉取并原配置重启容器：

```yaml
services:
  # …上面已有的 veladesk 服务保持不变…

  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    command: --interval 3600 --cleanup veladesk   # 每小时检查，只管 veladesk，更新后删旧镜像
```

效果：作者发新版 → CI 发布镜像 → 各机器一小时内自动完成升级，全程无人工。
升级期间服务会重启一次（通常几秒钟）；建议把 interval 设在低峰时段的使用习惯下。

### 源码部署的自动升级（update.sh + systemd timer）

仓库自带 `scripts/update.sh`：拉取 main、仅当依赖变化时 `pnpm install`、
重新构建，再配合 systemd 重启。全自动方案（每日凌晨 4 点检查并升级）：

`/etc/systemd/system/veladesk-update.service`：

```ini
[Unit]
Description=VelaDesk self-update

[Service]
Type=oneshot
User=root
WorkingDirectory=/opt/veladesk
ExecStart=/opt/veladesk/scripts/update.sh --restart
```

`/etc/systemd/system/veladesk-update.timer`：

```ini
[Unit]
Description=Daily VelaDesk self-update

[Timer]
OnCalendar=*-*-* 04:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

启用：`sudo systemctl enable --now veladesk-update.timer`。
只想看有没有新版本、不自动装：手动跑 `scripts/update.sh --check`。

### 老版本部署怎么跟上（含 v1.0.0 程序包原地升级）

- **老程序包（v1.0.0 的 zip / tar.gz）不用重新部署**：仓库提供一条命令的
  **原地升级脚本**——下载对应平台的正式包 → SHA256 校验 → 备份旧目录 →
  原地换入新目录。数据在独立的平台数据目录，全程不动：

  | 平台 | 一条命令（把安装目录换成你的实际路径） |
  | --- | --- |
  | macOS / Linux | `curl -fsSL https://raw.githubusercontent.com/ichichuang/veladesk/main/scripts/remote-upgrade.sh \| bash -s -- ~/Downloads/VelaDesk-v1.0.0-macos-arm64` |
  | Windows | `powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/ichichuang/veladesk/main/scripts/remote-upgrade.ps1 -OutFile $env:TEMP\veladesk-upgrade.ps1; & $env:TEMP\veladesk-upgrade.ps1 'C:\VelaDesk-v1.0.0-windows-x64'"` |

  - 升级后按原方式重启（双击 start-veladesk.cmd / 运行 start-veladesk.sh）即生效；
    加 `--restart`（或 `-Restart`）参数脚本会代劳停旧起新。
  - 想固定/回退版本：脚本第二个参数给版本号（如 `v1.2.3` / `-Version 1.2.3`）。
  - 放进定时任务/无人值守场景时，建议锁定脚本版本（把 URL 里的 `main` 换成
    具体版本标签如 `v1.1.0`），避免脚本行为随主干漂移。
  - 数据目录位置（升级前后一致，全程不动）：

    | 系统 | 数据目录 |
    | --- | --- |
    | Windows | `%LOCALAPPDATA%\VelaDesk` |
    | macOS | `~/Library/Application Support/VelaDesk` |
    | Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/veladesk` |

- **老的源码部署**：任意年代的克隆都能更新（仓库本身就是更新通道）。
  唯一的一次性动作是手动跑一次 `git pull`（老克隆里还没有 `update.sh`，
  拉一次它就出现了），之后回到全自动通道。如果机器上的 Node 还是 24 以下的
  老版本，`update.sh` 会明确拦下并提示先升级 Node，不会装一半坏掉。

- **Docker 部署**：本身就是新通道，`pull` / Watchtower 永续可用。

### 自动升级前要知道的事

- **重启窗口**：升级 = 容器/进程重启，通常几秒。正在保存的内容可能中断，
  VelaDesk 的本地优先同步会在恢复后自动补交，但重要操作别卡在升级瞬间。
- **迁移是单向的**：服务每次启动自动跑数据库迁移，升级后**不建议降级**
  （旧代码可能读不了新结构）。升级前备份数据目录/volume。
- **网络可达性**：`ghcr.io` 在部分地区直连较慢或不可达。拉不动时可以给
  Docker 配镜像加速器，或退回本地构建升级：
  `git pull && docker compose up -d --build`。
- **更新来源**：`latest` 跟随正式发版（推荐）；源码方式跟随 `main` 主干
  （更新最及时，但属于开发前沿）。生产建议跟正式版。

## 升级

上面两节就是全部：Docker 机器 `docker compose pull && docker compose up -d`
（或交给 Watchtower）；源码机器跑 `scripts/update.sh`（或交给 systemd timer）。
数据目录与代码完全分离，正常升级不需要重新建立工作区。

## RackNerd 自动部署（main CI → 生产 systemd 实例）

这一节描述**作者自己的生产实例**（RackNerd VPS，Debian 12，x86_64，无 Docker）：
`veladesk.service`（systemd）运行 `/opt/veladesk/current/start-veladesk.sh`，
`current` 是指向 `/opt/veladesk/releases/v<版本>-<短SHA>` 的原子指针，数据在
`/var/lib/veladesk`，nginx（Cloudflare 橙云在前）反代 `127.0.0.1:3000`。

**部署通道 = 发版 tag（显式交接）**：`release.yml` 在版本号变化时自动完成
「质量校验 → 三平台归档 → 打 `v*` tag → 发布 GitHub Release」，随后其
`dispatch-deploy` job 把新 tag 解析回**发布管线验证并打包的那个精确 SHA**
（不一致即拒绝），再用**内置 github.token**（`actions: write` 仅授予该 job，
无 PAT）显式 dispatch CI 工作流**到该 tag**（绝不在 main 上）——CI 的 deploy
job 部署这个 tag。全程无手动触发，版本归档（zip/tar.gz + SHA256SUMS）与部署
同一条链路。普通 main 推送只做校验不部署（如想 main 推送也部署，在
environment 里设变量 `VELADESK_AUTO_DEPLOY=true`）；手动 `workflow_dispatch`
可部署当前 main 或任一 tag（未经 release.yml 的手推 `v*` tag **不会**自动
部署——Docker 镜像照常发布，部署需手动 dispatch 该 tag）。

### 运行语义

- **只部署验证过的 SHA**：deploy job `needs: quality`，并以
  `ref: ${{ github.sha }}` 检出同一次 run 的提交（tag 事件 = tag 指向的
  提交）；构建在 **Debian 12 容器**（node:24-bookworm-slim）内完成——
  better-sqlite3 v13 没有预编译产物，装机即编译，必须与生产同发行版，
  否则 glibc 不匹配会让 API 全 500；打包出的 linux-x64 包与上面 systemd
  布局完全同一运行时，经 SHA256 校验后上传。
- **生产串行**：GitHub 并发组 `veladesk-deploy-production`（不可取消）+
  主机 `flock`；排队中的旧 run 在锁内被判定 stale 拒绝，已部署的 SHA 是
  no-op。新的 push 只会取消校验（quality job 的并发组），绝不会打断在跑的
  部署。
- **唯一入口**：runner 只上传一个校验和锁定的 tarball，然后调用
  `sudo -n /usr/local/sbin/veladesk-deploy.sh --commit <sha> --sha256 <hex>
  --run-id <run号>`——参数仅限三个已验证标识符，不接受路径或命令；脚本本体
  root 拥有，且 CI 会先比对主机脚本与仓库
  `scripts/deploy-racknerd.sh` 的 SHA256，不一致直接拒绝部署。
- **部署步骤**（全部在主机上）：暂存包先用一次性数据在 3999 端口冒烟 →
  在线 SQLite 备份（integrity_check 验证可读）+ assets + 工程凭据 →
  记录迁移指纹 → 原子切换 `current` → 仅重启 `veladesk.service` →
  健康检查 → 写 `/opt/veladesk/last-deploy.json`（含 SHA、上一版本、备份
  位置、结果；只记工作区**数量**，永不记录内容）。
- **验证**：CI 在服务端读 `/opt/veladesk/current/COMMIT` 必须等于目标 SHA
  （HTTP 200 缓存不算证据），再经 Cloudflare 正常路径检查公网 HTTPS
  `/` 与 `/api/v1/workspaces` 状态码（只看状态码，不记录响应体）。

### 回滚边界（重要）

- 新版本**健康检查失败且迁移指纹未变** → 自动切回上一 release 并重启，
  站点恢复 200（日志与 CI 均报 `ROLLED-BACK`）。
- 迁移已运行（指纹变化）或读不出 → **不自动回滚**（旧代码读新库不安全），
  服务停在断点等待人工决策（`HALTED-MIGRATED`，退出码 2）。恢复三要素会
  同时打进日志和 CI 摘要：上一 release 路径、当前 release、一致性备份目录。
- 公网检查失败但本地服务健康：迁移已跑，同样**不自动回滚**，人工决策。

### 一次性设置（已按此供给，留作重建手册）

1. 主机（root）安装 sudo 并建专用部署账户：
   `apt-get install -y sudo && useradd -m -s /bin/bash veladesk-deploy`。
2. `/etc/sudoers.d/veladesk-deploy`（一行，仅此一条命令）：
   `veladesk-deploy ALL=(root) NOPASSWD: /usr/local/sbin/veladesk-deploy.sh`，
   然后 `visudo -c` 校验。
3. 上传目录：`mkdir -p /var/tmp/veladesk-deploy && chown veladesk-deploy: /var/tmp/veladesk-deploy && chmod 700 /var/tmp/veladesk-deploy`。
4. 部署脚本：把仓库 `scripts/deploy-racknerd.sh` 原样放到
   `/usr/local/sbin/veladesk-deploy.sh`（root:root 0755）。**每次改动此脚本
   都要先同步主机再推送**——CI 用 SHA256 比对，漂移即拒部署。
5. 专用 SSH 密钥（ed25519，仅 VelaDesk 用，不与任何其他项目复用）：公钥装进
   `veladesk-deploy` 的 `authorized_keys`，前缀加 `restrict`；私钥与
   `ssh-keyscan -p <端口> <主机>` 得到的 host key 分别进 GitHub secrets。
6. GitHub Environment `production-racknerd`（**不带** deployment branch/tag
   策略——tag 引用必须能进来，ref 守门由工作流的 job-if 承担：仅 main 与
   `v*` tag）：secrets `VELADESK_SSH_KEY`、`VELADESK_SSH_KNOWN_HOSTS`；
   variables `VELADESK_DEPLOY_HOST` / `VELADESK_DEPLOY_PORT` /
   `VELADESK_DEPLOY_USER`、`VELADESK_PUBLIC_URL`（公网 HTTPS 基址）。
   变量 `VELADESK_AUTO_DEPLOY` 是**可选**的 main 推送部署开关（tag 部署
   无条件，不受它控制）。

### 发布即部署 / 停止自动部署

- **发一个版本 = 一次部署**：仓库根跑 `pnpm version:set <新版本号>` →
  提交推送 → `release.yml` 自动归档三平台包并打 `v*` tag → tag 触发 CI 的
  deploy job 自动部署该 SHA。不需要任何手动触发。
- 紧急部署当前 main：Actions → CI → Run workflow（main 分支）。
- 停止 tag 自动部署：把 ci.yml 触发器里的 `tags: ["v*"]` 删掉（或把 deploy
  job 的 environment 换名）即可；服务器侧的部署脚本与备份/回滚机制不受影响。

## 验证部署成功

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/                      # 期待 200
curl -s http://127.0.0.1:3000/api/v1/workspaces                                       # 期待 JSON（全新装是 {"workspaces":[]}）
```
