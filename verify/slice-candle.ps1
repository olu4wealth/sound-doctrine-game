# slice-candle.ps1 — cut candle-states-alpha.png into 3 equal vertical strips.
Add-Type -AssemblyName System.Drawing

$src = Join-Path (Get-Location) 'assets\candle-states-alpha.png'
$names = @('candle-lit.png', 'candle-guttering.png', 'candle-smouldering.png')

$img = New-Object System.Drawing.Bitmap($src)
$w = $img.Width; $h = $img.Height
$sliceW = [int]([math]::Floor($w / 3))

for ($i = 0; $i -lt 3; $i++) {
  $x = $i * $sliceW
  $rect = New-Object System.Drawing.Rectangle($x, 0, $sliceW, $h)
  $crop = $img.Clone($rect, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $out = Join-Path (Get-Location) ('assets\' + $names[$i])
  $crop.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $crop.Dispose()
  Write-Output "saved $($names[$i]) ($sliceW x $h)"
}
$img.Dispose()
