# Builds docs/hero.png for the README from the real pet self-test screenshots:
# the nudge bubble, the timer ring and the HUD panel on a dark "desktop".
#   npm run test:pet -- <dir>; powershell -File scripts/hero.ps1 <dir>
param([Parameter(Mandatory)][string]$Shots, [string]$Out = "")
if (-not $Out) { $Out = Join-Path (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)) 'docs\hero.png' }
Add-Type -AssemblyName System.Drawing
$W = 1600; $H = 640
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = 'NearestNeighbor'
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(255, 10, 8, 28)), ([System.Drawing.Color]::FromArgb(255, 28, 10, 48)), 35
$g.FillRectangle($bg, $rect)
$grid = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(28, 0, 240, 255)), 1
for ($x = 0; $x -lt $W; $x += 40) { $g.DrawLine($grid, $x, 0, $x, $H) }
for ($y = 0; $y -lt $H; $y += 40) { $g.DrawLine($grid, 0, $y, $W, $y) }

# Right-hand 560 px of a 1920x330 strip holds the pet and its bubble.
function Strip($file, $dx, $dy) {
  $img = [System.Drawing.Image]::FromFile((Join-Path $Shots $file))
  $src = New-Object System.Drawing.Rectangle ($img.Width - 560), 0, 560, $img.Height
  $dst = New-Object System.Drawing.Rectangle $dx, $dy, 560, $img.Height
  $g.DrawImage($img, $dst, $src, 'Pixel'); $img.Dispose()
}
Strip '2-pet-nudge.png' 40 20
Strip '6-pet-ring.png' 600 20
$panel = [System.Drawing.Image]::FromFile((Join-Path $Shots '5-panel-after-add.png'))
$g.DrawImage($panel, 1200, 40, 360, 560); $panel.Dispose()

$font = New-Object System.Drawing.Font 'Consolas', 20, ([System.Drawing.FontStyle]::Bold)
$cyan = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0, 240, 255))
$pink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 255, 43, 214))
$g.DrawString('// it speaks first when you drift', $font, $pink, 60, 380)
$g.DrawString('// click it: a focus ring', $font, $cyan, 620, 380)
$small = New-Object System.Drawing.Font 'Consolas', 15
$dim = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 150, 160, 200))
$g.DrawString("Real screenshots from the app (npm run test:pet).`nThe familiar lives on the bottom edge of your screen; clicks pass through everywhere else.", $small, $dim, 60, 450)
$big = New-Object System.Drawing.Font 'Consolas', 44, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('NUDGLING', $big, $cyan, 56, 530)
$g.DrawString('the body double that speaks first', $font, $pink, 380, 553)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
"wrote $Out"
