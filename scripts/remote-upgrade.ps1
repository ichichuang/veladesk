# remote-upgrade.ps1 — 原地升级已安装的 VelaDesk 发布程序包（Windows，无需重新部署）。
#
# 与 scripts/remote-upgrade.sh 同一套逻辑的 PowerShell 版：
# 下载 GitHub Releases 的 windows-x64 包 → 校验 SHA256 → 解压到临时目录 →
# 备份旧目录 → 换入新目录。数据在 %LOCALAPPDATA%\VelaDesk，全程不受影响。
#
# 用法（PowerShell）:
#   powershell -ExecutionPolicy Bypass -File remote-upgrade.ps1 <安装目录>
#   powershell -ExecutionPolicy Bypass -File remote-upgrade.ps1 <安装目录> -Restart
#   powershell -ExecutionPolicy Bypass -File remote-upgrade.ps1 -Check <安装目录>
#   指定版本:  ... -File remote-upgrade.ps1 <安装目录> -Version 1.2.3
#
# 远程一条命令:
#   powershell -ExecutionPolicy Bypass -Command "iwr https://raw.githubusercontent.com/ichichuang/veladesk/main/scripts/remote-upgrade.ps1 -OutFile $env:TEMP\veladesk-upgrade.ps1; & $env:TEMP\veladesk-upgrade.ps1 'C:\VelaDesk-v1.0.0-windows-x64'"
#
# 回退: 换装前旧目录改名为 <安装目录>.backup-<旧版本>，回退就是把它换回来。
param(
  [Parameter(Position = 0)][string]$InstallDir = ".",
  [string]$Version = "",
  [switch]$Restart,
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$Repo = "ichichuang/veladesk"
$ApiUrl = "https://api.github.com/repos/$Repo/releases/latest"
$AssetPlatform = "windows-x64"
$DefaultPort = 3000

# ---- 安装目录校验 ----
$InstallDir = (Resolve-Path -LiteralPath $InstallDir).Path
if (-not (Test-Path (Join-Path $InstallDir "start-veladesk.cmd"))) {
  Write-Host "[upgrade] $InstallDir 不是发布程序包目录（缺少 start-veladesk.cmd）。" -ForegroundColor Red
  exit 1
}

function Get-CurrentVersion {
  $name = Split-Path $InstallDir -Leaf
  if ($name -match '^VelaDesk-v([0-9.]+)-') { return $Matches[1] }
  return "unknown"
}

function Get-RemoteVersion {
  $rel = Invoke-RestMethod -Uri $ApiUrl -TimeoutSec 30
  return $rel.tag_name -replace '^v', ''
}

if ($Check) {
  $latest = Get-RemoteVersion
  Write-Host "[upgrade] 本地版本：$(Get-CurrentVersion)"
  Write-Host "[upgrade] 最新正式版：$latest"
  exit 0
}

$latest = Get-RemoteVersion
$target = if ($Version) { $Version } else { $latest }
Write-Host "[upgrade] 安装目录：$InstallDir"
Write-Host "[upgrade] 当前版本：$(Get-CurrentVersion)"
Write-Host "[upgrade] 目标版本：$target（最新：$latest）"

if ($target -eq (Get-CurrentVersion)) {
  Write-Host "[upgrade] 已是目标版本，无需升级"
  exit 0
}

# ---- 下载 + 校验 ----
# 注意：临时目录放系统临时目录，不放安装目录里面——换装第一步
# Rename-Item 安装目录 → backup，放里面会被一起搬走导致换入失败。
$assetName = "VelaDesk-v$target-$AssetPlatform.zip"
$workDir = Join-Path ([System.IO.Path]::GetTempPath()) ("veladesk-upgrade-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $workDir | Out-Null

try {
  Write-Host "[upgrade] 下载 $assetName …"
  $assetUrl = "https://github.com/$Repo/releases/download/v$target/$assetName"
  Invoke-WebRequest -Uri $assetUrl -OutFile (Join-Path $workDir $assetName) -TimeoutSec 600

  Write-Host "[upgrade] 校验 SHA256 …"
  $sumsUrl = "https://github.com/$Repo/releases/download/v$target/SHA256SUMS.txt"
  $sumsPath = Join-Path $workDir "SHA256SUMS.txt"
  Invoke-WebRequest -Uri $sumsUrl -OutFile $sumsPath -TimeoutSec 60
  $expectLine = (Get-Content $sumsPath) | Where-Object { $_ -match [regex]::Escape($assetName) } | Select-Object -First 1
  if (-not $expectLine) { throw "SHA256SUMS.txt 里找不到 $assetName" }
  $expect = ($expectLine -split '\s+')[0]
  $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $workDir $assetName)).Hash.ToLower()
  if ($actual -ne $expect.ToLower()) {
    throw "SHA256 校验失败（期望 $expect，实际 $actual），已中止，未改动安装目录"
  }

  Write-Host "[upgrade] 解压 …"
  $extractDir = Join-Path $workDir "extract"
  Expand-Archive -Path (Join-Path $workDir $assetName) -DestinationPath $extractDir
  $newDir = Get-ChildItem -Path $extractDir -Recurse -Filter "start-veladesk.cmd" |
    Select-Object -First 1
  if (-not $newDir) { throw "解压结果里找不到 start-veladesk.cmd" }
  $newDir = $newDir.DirectoryName
  if (-not (Test-Path (Join-Path $newDir "runtime"))) { throw "新包缺 runtime/ 目录" }

  # ---- 换装 ----
  $backupDir = "${InstallDir}.backup-$(Get-CurrentVersion)"
  if (Test-Path $backupDir) {
    Write-Host "[upgrade] 移除上一次的备份 $backupDir"
    Remove-Item -LiteralPath $backupDir -Recurse -Force
  }

  if ($Restart) {
    $port = if ($env:VELADESK_PORT) { [int]$env:VELADESK_PORT } else { $DefaultPort }
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
      $oldPid = $conn.OwningProcess
      if ($oldPid -and $oldPid -ne $PID) {
        Write-Host "[upgrade] 停止旧进程（端口 $port，pid $oldPid）…"
        taskkill /PID $oldPid /T /F 2>$null | Out-Null
      }
    }
  }

  Write-Host "[upgrade] 换装：旧目录 → $(Split-Path $backupDir -Leaf)"
  Rename-Item -LiteralPath $InstallDir -NewName (Split-Path $backupDir -Leaf)
  try {
    Move-Item -LiteralPath $newDir -Destination $InstallDir
  } catch {
    Write-Host "[upgrade] 换入失败，回滚 …" -ForegroundColor Red
    Rename-Item -LiteralPath "${InstallDir}.backup-$(Get-CurrentVersion)" -NewName (Split-Path $InstallDir -Leaf)
    throw
  }

  Write-Host "[upgrade] 完成：$InstallDir 现在是 v$target"
  Write-Host "[upgrade] 旧版本保留在 $backupDir（确认正常后可删除）"

  if ($Restart) {
    Write-Host "[upgrade] 启动新版本 …"
    Start-Process -FilePath (Join-Path $InstallDir "start-veladesk.cmd") -WorkingDirectory $InstallDir
    Write-Host "[upgrade] 启动窗口已打开（保持窗口开启 = 保持 VelaDesk 运行）"
  } else {
    Write-Host "[upgrade] 按原方式重启即可生效（关掉旧启动窗口，再双击 start-veladesk.cmd），或下次加 -Restart 让脚本代劳"
  }
} finally {
  if (Test-Path $workDir) { Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue }
}
