# A synthetic conversation fixture, not a screenshot of a real customer.
Add-Type -AssemblyName System.Drawing
$artifactDir = Join-Path $PSScriptRoot '..\.artifacts'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$canvas = New-Object System.Drawing.Bitmap 1000,520
$graphics = [System.Drawing.Graphics]::FromImage($canvas)
$font = New-Object System.Drawing.Font 'Malgun Gothic',22
try {
    $graphics.Clear([System.Drawing.Color]::White)
    $brush = [System.Drawing.Brushes]::Black
    $graphics.DrawString('가상 A/S 상담 — 이미지 인식 테스트', $font, $brush, 30, 25)
    $graphics.DrawString('나: 수리비는 얼마인가요?', $font, $brush, 30, 110)
    $graphics.DrawString('입고 후 수리는 며칠 걸리나요?', $font, $brush, 30, 160)
    $graphics.DrawString('왕복 배송비는 누가 부담하나요?', $font, $brush, 30, 210)
    $graphics.DrawString('고객센터: 수리는 3~5영업일 소요됩니다.', $font, $brush, 30, 310)
    $graphics.DrawString('수리비는 점검 후 안내하겠습니다.', $font, $brush, 30, 360)
    $canvas.Save((Join-Path $artifactDir 'synthetic-chat.png'), [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output 'Prepared .artifacts/synthetic-chat.png'
} finally {
    $graphics.Dispose()
    $canvas.Dispose()
    $font.Dispose()
}
