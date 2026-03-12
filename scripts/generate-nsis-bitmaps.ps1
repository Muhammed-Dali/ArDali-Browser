param(
  [string]$InputPng = "screenshots\\shot-2026-02-15-003235.png",
  [string]$OutDir = "build-resources"
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $InputPng)) {
  throw "Input screenshot not found: $InputPng"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

Add-Type -AssemblyName System.Drawing

function New-CoverBitmap {
  param(
    [System.Drawing.Image]$Source,
    [int]$W,
    [int]$H
  )

  $bmp = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  # Compute "cover" crop rectangle (fill W×H).
  $srcW = [double]$Source.Width
  $srcH = [double]$Source.Height
  $dstW = [double]$W
  $dstH = [double]$H

  $scale = [Math]::Max($dstW / $srcW, $dstH / $srcH)
  $cropW = $dstW / $scale
  $cropH = $dstH / $scale
  $cropX = ($srcW - $cropW) / 2.0
  $cropY = ($srcH - $cropH) / 2.0

  $srcRect = New-Object System.Drawing.RectangleF([float]$cropX, [float]$cropY, [float]$cropW, [float]$cropH)
  $dstRect = New-Object System.Drawing.RectangleF(0, 0, $W, $H)

  $g.DrawImage($Source, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

  # Dark glass overlay + subtle cyan accent stripe (premium-ish).
  $overlay = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 10, 16, 28))
  $g.FillRectangle($overlay, 0, 0, $W, $H)
  $overlay.Dispose()

  $accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(210, 0, 200, 255))
  $g.FillRectangle($accent, 0, 0, [Math]::Max(3, [int]($W * 0.02)), $H)
  $accent.Dispose()

  $g.Dispose()
  return $bmp
}

$srcImg = [System.Drawing.Image]::FromFile($InputPng)

try {
  $sidebarBmp = New-CoverBitmap -Source $srcImg -W 164 -H 314
  $headerBmp = New-CoverBitmap -Source $srcImg -W 150 -H 57

  # Draw a small Aurivo icon on the header for brand recognition (if present).
  $iconPath = "icons\\aurivo_256.png"
  if (Test-Path $iconPath) {
    $iconImg = [System.Drawing.Image]::FromFile($iconPath)
    try {
      $g2 = [System.Drawing.Graphics]::FromImage($headerBmp)
      $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

      $size = 40
      $pad = 6
      $g2.DrawImage($iconImg, $pad, [Math]::Max(0, [int](($headerBmp.Height - $size) / 2)), $size, $size)
      $g2.Dispose()
    } finally {
      $iconImg.Dispose()
    }
  }

  $sidebarOut = Join-Path $OutDir "installerSidebar.bmp"
  $headerOut = Join-Path $OutDir "installerHeader.bmp"

  $sidebarBmp.Save($sidebarOut, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $headerBmp.Save($headerOut, [System.Drawing.Imaging.ImageFormat]::Bmp)

  $sidebarBmp.Dispose()
  $headerBmp.Dispose()

  Write-Host "Wrote: $sidebarOut"
  Write-Host "Wrote: $headerOut"
} finally {
  $srcImg.Dispose()
}
