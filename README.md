# VelaDesk

> 一个自己部署、自己整理的浏览器主页和网站导航桌面。

VelaDesk 可以把常用网站整理成分类、文件夹和 Dock，
作为电脑和手机都能使用的浏览器入口。

电脑端主要用来添加、整理和设置；
手机端主要用来查看分类、搜索和打开网站。

## VelaDesk 是什么

VelaDesk 是一个免费开源的浏览器主页程序。

它跑在你自己的电脑上，不需要注册账号，也没有广告。

打开浏览器就能看到自己整理的网站桌面：
点一下图标打开网站，像用手机桌面一样。

数据保存在你自己部署的 VelaDesk 里，不会上传到第三方云服务。

## 能做什么

- 把常用网站整理成自己的浏览器桌面
- 创建多个分类（页面）和文件夹
- 在电脑端拖动、调整应用的位置
- 设置 Dock、背景和主题
- 搜索并快速打开网站
- 使用 JSON 批量导入网站
- 在手机端查看分类、搜索和打开应用
- 数据保存在自己的设备上

## 下载

下载地址：

https://github.com/ichichuang/veladesk/releases/latest

进入 Releases 页面后，在 Assets 里下载对应系统的程序包。

通用文件名：

| 系统 | 文件名 |
| --- | --- |
| Windows 64 位（Intel/AMD） | `VelaDesk-v<版本号>-windows-x64.zip` |
| Linux 64 位（Intel/AMD） | `VelaDesk-v<版本号>-linux-x64.tar.gz` |
| Mac Apple 芯片 | `VelaDesk-v<版本号>-macos-arm64.tar.gz` |

Apple 芯片 = Apple Silicon（M 系列芯片）。

目前没有提供：

- Intel Mac 正式包
- Windows ARM 正式包
- Linux ARM 正式包

注意：不要下载 GitHub 自动生成的

- `Source code (zip)`
- `Source code (tar.gz)`

它们是源码压缩包，不是能直接运行的 VelaDesk 程序包。

## 运行前准备

只需要安装一样东西：Node.js 24 LTS

下载地址：https://nodejs.org/

安装时一路默认即可。

使用正式 Release 程序包，不需要 Git、pnpm、Visual Studio、Python，
也不需要自己编译。

## Windows 使用方法

1. 安装 Node.js 24 LTS。
2. 下载 `windows-x64` 的 zip 包。
3. 解压到任意文件夹。
4. 双击 `start-veladesk.cmd`。
5. 保持启动窗口打开（关掉窗口 = 关闭 VelaDesk）。
6. 浏览器访问 http://127.0.0.1:3000。
7. 第一次打开时，按页面提示创建工作区。

## macOS 使用方法

1. 安装 Node.js 24 LTS。
2. 下载 `macos-arm64` 的程序包。
3. 解压。
4. 打开「终端」，进入解压后的目录，例如：

   ```bash
   cd ~/Downloads/VelaDesk-v1.0.0-macos-arm64
   ```

5. 运行：

   ```bash
   ./start-veladesk.sh
   ```

6. 打开 http://127.0.0.1:3000。

说明：目前只提供 Apple 芯片（Apple Silicon，M 系列）的程序包。

## Linux 使用方法

1. 安装 Node.js 24 LTS。
2. 下载 `linux-x64` 的程序包。
3. 解压。
4. 进入解压后的目录：

   ```bash
   cd VelaDesk-v1.0.0-linux-x64
   ```

5. 运行：

   ```bash
   ./start-veladesk.sh
   ```

6. 打开 http://127.0.0.1:3000。

## 手机访问电脑上的 VelaDesk

先说清楚一件事：

`http://127.0.0.1:3000` 里的 `127.0.0.1` 只代表“当前这台设备”。

所以手机不能用 `127.0.0.1` 去访问另一台电脑。
要让手机访问电脑上的 VelaDesk，需要两步：
让 VelaDesk 监听局域网，再用电脑的局域网 IP 访问。

**Windows（PowerShell）：**

```powershell
$env:VELADESK_HOST="0.0.0.0"
.\start-veladesk.cmd
```

**macOS / Linux：**

```bash
VELADESK_HOST=0.0.0.0 ./start-veladesk.sh
```

然后查看电脑的 IPv4 地址。
例如电脑 IP 是 `192.168.1.20`，手机浏览器打开：

http://192.168.1.20:3000

注意：

- 手机和电脑必须在同一个局域网 / Wi-Fi 下。
- Windows 弹出防火墙提示时，家庭网络场景只勾选“专用网络”。
- 不要把 3000 端口直接暴露到公网。

局域网开放只建议在家庭网络、内网或可信网络中使用。

### 自定义端口

不想用 3000 端口时，可以这样改。

**Windows（PowerShell）：**

```powershell
$env:VELADESK_PORT="8080"
.\start-veladesk.cmd
```

**macOS / Linux：**

```bash
VELADESK_PORT=8080 ./start-veladesk.sh
```

然后访问：

http://127.0.0.1:8080

## 数据保存在哪里

| 系统 | 数据目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\VelaDesk` |
| macOS | `~/Library/Application Support/VelaDesk` |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/veladesk` |

说明：

- 工作区、数据库和上传的图片都保存在上面的用户数据目录里。
- 程序目录和用户数据是分开的。
- 升级时替换程序文件夹，不会自动删除用户数据。
- 要备份，直接备份整个 VelaDesk 数据目录即可。

## 升级

1. 下载新版本程序包。
2. 解压新的程序包。
3. 关闭旧版本（关掉启动窗口）。
4. 用新版本启动。
5. 继续使用原来的数据目录。

正常升级不需要重新建立工作区。

## 常见问题

**Q：双击以后打不开？**
A：先确认已安装 Node.js 24 LTS，并保持启动窗口打开。

**Q：浏览器打不开 127.0.0.1:3000？**
A：确认启动窗口没有报错；如果自定义过端口，请使用对应端口。

**Q：手机为什么打不开 127.0.0.1:3000？**
A：`127.0.0.1` 只代表手机自己。请按“手机访问电脑上的 VelaDesk”一节配置局域网，并使用电脑的局域网 IP。

**Q：升级会丢数据吗？**
A：程序目录和数据目录是分开的。正常替换程序包不会删除工作区；重要数据仍建议定期备份。

**Q：下载哪个文件？**
A：按系统和 CPU 架构选择 Assets 中的 VelaDesk 程序包，不要下载 Source code。

**Q：macOS/Linux 提示没有执行权限？**
A：运行一次：

```bash
chmod +x start-veladesk.sh
```

## 开发者

如果你要修改源码、参与开发或了解项目结构，请看：

[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)

## 开源协议

VelaDesk 基于 [MIT License](./LICENSE) 开源。
