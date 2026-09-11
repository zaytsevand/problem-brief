<#
.SYNOPSIS
  Install the problem-brief skill on Windows.

.DESCRIPTION
  Copies the skill into %USERPROFILE%\.claude\skills\problem-brief, checks that
  Node is present, and reports whether the two skills this one composes —
  archify and humanizer — are installed.

.PARAMETER Link
  Make a directory junction instead of copying, so a git pull updates the skill.
  Junctions need no elevation; symbolic links would.

.PARAMETER Dir
  Install into a different skills directory.

.PARAMETER Uninstall
  Remove the skill again.

.EXAMPLE
  .\install.ps1
.EXAMPLE
  .\install.ps1 -Link
.EXAMPLE
  .\install.ps1 -Uninstall
#>
[CmdletBinding()]
param(
  [switch]$Link,
  [switch]$Uninstall,
  [string]$Dir
)

$ErrorActionPreference = 'Stop'
$src  = $PSScriptRoot
$name = 'problem-brief'

if (-not $Dir) { $Dir = Join-Path $env:USERPROFILE '.claude\skills' }
$target = Join-Path $Dir $name

function Write-Ok   ($m) { Write-Host "✓ $m" -ForegroundColor Green }
function Write-Warn ($m) { Write-Host "! $m" -ForegroundColor Yellow }

if ($Uninstall) {
  if (Test-Path $target) {
    # Remove-Item on a junction deletes the junction, not the target it points at.
    Remove-Item $target -Recurse -Force
    Write-Ok "removed $target"
  } else {
    Write-Host "nothing installed at $target"
  }
  return
}

# ── requirements ────────────────────────────────────────────────────────────
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Warn 'node is not on PATH. The renderer needs Node 18 or newer: https://nodejs.org'
} else {
  $major = [int](& node -p 'process.versions.node.split(".")[0]')
  if ($major -lt 18) { Write-Warn "node $(& node -v) is older than v18; the renderer may not run" }
}

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
if (Test-Path $target) { Remove-Item $target -Recurse -Force }

if ($Link) {
  New-Item -ItemType Junction -Path $target -Target $src | Out-Null
  Write-Ok "linked $target -> $src"
} else {
  New-Item -ItemType Directory -Force -Path $target | Out-Null
  foreach ($item in @('SKILL.md', 'bin', 'schema', 'examples')) {
    $from = Join-Path $src $item
    if (Test-Path $from) { Copy-Item $from -Destination $target -Recurse -Force }
  }
  Write-Ok "installed $target"
}

# ── the two skills this one composes ────────────────────────────────────────
$missing = $false

if (Test-Path (Join-Path $Dir 'archify\SKILL.md')) {
  Write-Ok 'archify found — real drawings available'
} else {
  Write-Warn 'archify not found. Drawings fall back to mermaid only.'
  Write-Host "    git clone https://github.com/tt-a1i/archify `"$(Join-Path $Dir 'archify')`""
  $missing = $true
}

$humanizerPlugin = Join-Path $env:USERPROFILE '.claude\plugins\cache\humanizer'
if ((Test-Path $humanizerPlugin) -or (Test-Path (Join-Path $Dir 'humanizer\SKILL.md'))) {
  Write-Ok 'humanizer found — prose gets a pass before publishing'
} else {
  Write-Warn 'humanizer not found. Briefs will read as machine-written.'
  Write-Host '    in Claude Code:  /plugin marketplace add blader/humanizer'
  Write-Host '                     /plugin install humanizer@humanizer'
  $missing = $true
}

Write-Host ''
Write-Ok 'problem-brief is installed.'
Write-Host "Try it:  node `"$target\bin\render-brief.mjs`" `"$target\examples\example.brief.json`" .\brief.html"
if ($missing) { Write-Host 'Install the missing pieces above for the full thing.' }
