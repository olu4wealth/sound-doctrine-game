# key-white.ps1 — chroma-key near-white backgrounds to transparent (alpha).
# Uses System.Drawing.LockBits for speed. Threshold: all RBG channels >= 235.
param(
  [string[]]$Files = @('candle.png','candle-states.png','rank-emblems.png','clay-decorations.png'),
  [int]$Threshold = 235
)

Add-Type -AssemblyName System.Drawing

$assetDir = Join-Path (Get-Location) 'assets'

foreach ($name in $Files) {
  $src = Join-Path $assetDir $name
  $png = [System.Drawing.Bitmap]::FromFile($src)
  $w = $png.Width; $h = $png.Height

  # Convert to 32bpp ARGB
  $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.DrawImage($png, 0, 0, $w, $h)
  $g.Dispose(); $png.Dispose()

  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $bytes = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)

  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $i = $y * $stride + $x * 4
      $b = $bytes[$i]; $g2 = $bytes[$i+1]; $r = $bytes[$i+2]
      # near-white test (BGRA order in memory)
      if ($b -ge $Threshold -and $g2 -ge $Threshold -and $r -ge $Threshold) {
        $bytes[$i+3] = 0  # alpha = 0
      }
    }
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)

  $out = Join-Path $assetDir ($name -replace '\.png$', '-alpha.png')
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "keyed: $name -> $(Split-Path $out -Leaf)"
}
