$ErrorActionPreference = 'Stop'

function Get-Color([string]$hex) {
    $hex = $hex.TrimStart('#')
    $red = [Convert]::ToInt32($hex.Substring(0, 2), 16)
    $green = [Convert]::ToInt32($hex.Substring(2, 2), 16)
    $blue = [Convert]::ToInt32($hex.Substring(4, 2), 16)
    return $red + ($green * 256) + ($blue * 65536)
}

$colors = @{
    Background = Get-Color '071426'
    Panel = Get-Color '0D2037'
    PanelAlt = Get-Color '102A47'
    Cyan = Get-Color '24D5FF'
    Blue = Get-Color '3B82F6'
    Mint = Get-Color '45F0C5'
    Gold = Get-Color 'FFCB66'
    White = Get-Color 'F4F8FC'
    Text = Get-Color 'C7D7E8'
    Muted = Get-Color '7894AF'
    Line = Get-Color '244666'
}

function Add-Box($slide, [float]$x, [float]$y, [float]$width, [float]$height, [int]$fill, [int]$line, [float]$radius = 5) {
    $shapeType = if ($radius -gt 0) { 5 } else { 1 }
    $shape = $slide.Shapes.AddShape($shapeType, $x, $y, $width, $height)
    $shape.Fill.ForeColor.RGB = $fill
    $shape.Fill.Transparency = 0
    $shape.Line.ForeColor.RGB = $line
    $shape.Line.Weight = 1
    return $shape
}

function Add-Text($slide, [string]$text, [float]$x, [float]$y, [float]$width, [float]$height, [float]$size, [int]$color, [bool]$bold = $false, [int]$align = 1, [string]$font = 'Microsoft YaHei') {
    $shape = $slide.Shapes.AddTextbox(1, $x, $y, $width, $height)
    $shape.TextFrame2.MarginLeft = 0
    $shape.TextFrame2.MarginRight = 0
    $shape.TextFrame2.MarginTop = 0
    $shape.TextFrame2.MarginBottom = 0
    $shape.TextFrame2.WordWrap = -1
    $shape.TextFrame2.AutoSize = 2
    $shape.TextFrame2.TextRange.Text = $text
    $shape.TextFrame2.TextRange.Font.Name = $font
    $shape.TextFrame2.TextRange.Font.Size = $size
    $shape.TextFrame2.TextRange.Font.Bold = if ($bold) { -1 } else { 0 }
    $shape.TextFrame2.TextRange.Font.Fill.ForeColor.RGB = $color
    $shape.TextFrame2.TextRange.ParagraphFormat.Alignment = $align
    return $shape
}

function Add-Line($slide, [float]$x1, [float]$y1, [float]$x2, [float]$y2, [int]$color, [float]$weight = 1, [bool]$arrow = $false) {
    $line = $slide.Shapes.AddLine($x1, $y1, $x2, $y2)
    $line.Line.ForeColor.RGB = $color
    $line.Line.Weight = $weight
    if ($arrow) { $line.Line.EndArrowheadStyle = 2 }
    return $line
}

function Add-Pill($slide, [string]$text, [float]$x, [float]$y, [float]$width, [int]$color) {
    $pill = Add-Box $slide $x $y $width 22 $colors.PanelAlt $color
    $pill.Line.Transparency = 0.35
    Add-Text $slide $text ($x + 5) ($y + 5) ($width - 10) 12 8.2 $color $true 2 'Aptos' | Out-Null
}

function Add-Base($slide, [int]$page) {
    $background = Add-Box $slide 0 0 960 540 $colors.Background $colors.Background 0
    $background.Line.Visible = 0
    Add-Box $slide 0 0 960 4 $colors.Cyan $colors.Cyan 0 | Out-Null
    for ($x = 48; $x -lt 930; $x += 36) {
        $line = Add-Line $slide $x 30 $x 500 (Get-Color '0C2741') 0.35
        $line.Line.Transparency = 0.55
    }
    for ($y = 34; $y -lt 505; $y += 36) {
        $line = Add-Line $slide 30 $y 930 $y (Get-Color '0C2741') 0.35
        $line.Line.Transparency = 0.55
    }
    $veil = Add-Box $slide 0 4 960 505 $colors.Background $colors.Background 0
    $veil.Fill.Transparency = 0.1
    $veil.Line.Visible = 0
    Add-Line $slide 48 512 912 512 $colors.Line 0.75 | Out-Null
    Add-Text $slide 'SUPPLYCHAINX402' 48 518 125 11 7.5 $colors.Muted $true 1 'Aptos' | Out-Null
    Add-Text $slide 'ATTESTFLOW · CC3 MVP' 744 518 148 11 7.5 $colors.Muted $true 3 'Aptos' | Out-Null
    Add-Text $slide ([string]$page) 905 518 12 11 7.5 $colors.Muted $false 3 'Aptos' | Out-Null
}

function Add-Header($slide, [string]$kicker, [string]$title, [string]$subtitle) {
    $kickerShape = Add-Text $slide $kicker 49 28 340 15 8.5 $colors.Cyan $true 1 'Aptos'
    $kickerShape.TextFrame2.TextRange.Font.Spacing = 1.5
    Add-Text $slide $title 48 52 864 42 23.5 $colors.White $true | Out-Null
    Add-Text $slide $subtitle 49 101 850 24 10.5 $colors.Text | Out-Null
}

$scriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { (Resolve-Path '.\demoscript').Path }
$outputPath = Join-Path $scriptDirectory 'supplychainX402-two-slide-cn.pptx'
$previewPath = Join-Path $scriptDirectory '.ppt-preview-supplychainx402-cn'

if (Test-Path $previewPath) { Remove-Item $previewPath -Recurse -Force }
New-Item -ItemType Directory -Path $previewPath | Out-Null

$powerPoint = $null
$presentation = $null
$powerPoint = New-Object -ComObject PowerPoint.Application
$powerPoint.Visible = -1
$powerPoint.DisplayAlerts = 0
$presentation = $powerPoint.Presentations.Add()
$presentation.PageSetup.SlideWidth = 960
$presentation.PageSetup.SlideHeight = 540

try {
    $slide1 = $presentation.Slides.Add(1, 12)
    Add-Base $slide1 1
    Add-Header $slide1 '01  /  供应链金融模式' '从真实贸易到到期兑付：一笔应收账款的融资闭环' '买方先确权，供应商凭买方信用获得无追索融资；到期由预签授权驱动稳定币结算。'

    Add-Line $slide1 56 132 903 132 $colors.Blue 1.5 $true | Out-Null
    $steps = @(
        @{ Role = '供应商'; Title = '提交贸易资料'; Detail = "合同 / PO / 发票`n验收记录"; Color = $colors.Cyan },
        @{ Role = '核心买方'; Title = '确权 + 双签'; Detail = "Approved Payable`n+ EIP-3009 授权`n确权时不锁款"; Color = $colors.Gold },
        @{ Role = '平台'; Title = '生成数字凭证'; Detail = "Digital Receivable`nACTIVE · 可融资"; Color = $colors.Blue },
        @{ Role = '资金方'; Title = '提交融资报价'; Detail = "按买方授信`n无追索报价"; Color = $colors.Mint },
        @{ Role = '供应商'; Title = '接受并放款'; Detail = "acceptOffer()`n原子放款 · 权属更新"; Color = $colors.Cyan },
        @{ Role = '结算合约'; Title = '到期分账'; Detail = "受限 Relayer`n→ claim()"; Color = $colors.Blue }
    )
    $cardXs = @(48, 200, 352, 504, 656, 808)
    for ($index = 0; $index -lt ($steps.Count - 1); $index++) {
        $fromX = $cardXs[$index] + 116
        $toX = $cardXs[$index + 1] - 7
        Add-Line $slide1 $fromX 239 $toX 239 $colors.Line 1.1 $true | Out-Null
    }
    for ($index = 0; $index -lt $steps.Count; $index++) {
        $step = $steps[$index]
        $x = $cardXs[$index]
        $card = Add-Box $slide1 $x 145 112 188 $colors.Panel $step.Color
        $card.Line.Transparency = 0.45
        $badge = $slide1.Shapes.AddShape(9, ($x + 42), 132, 28, 28)
        $badge.Fill.ForeColor.RGB = $step.Color
        $badge.Line.ForeColor.RGB = $colors.Background
        $badge.Line.Weight = 2
        Add-Text $slide1 (($index + 1).ToString('00')) ($x + 42) 140 28 10 7.5 $colors.Background $true 2 'Aptos' | Out-Null
        Add-Pill $slide1 $step.Role ($x + 16) 178 80 $step.Color
        Add-Text $slide1 $step.Title ($x + 9) 217 94 28 10.4 $colors.White $true 2 | Out-Null
        Add-Line $slide1 ($x + 24) 251 ($x + 88) 251 $step.Color 0.8 | Out-Null
        Add-Text $slide1 $step.Detail ($x + 8) 264 96 48 8.2 $colors.Text $false 2 | Out-Null
    }

    $logicPanel = Add-Box $slide1 48 350 864 116 $colors.PanelAlt $colors.Blue
    $logicPanel.Line.Transparency = 0.35
    Add-Box $slide1 48 350 6 116 $colors.Cyan $colors.Cyan 0 | Out-Null
    Add-Text $slide1 '模式核心' 70 365 150 19 13.5 $colors.White $true | Out-Null
    Add-Text $slide1 '买方资金' 70 399 65 13 8.2 $colors.Gold $true | Out-Null
    Add-Text $slide1 '确权时不锁款 · 到期前检查余额与授权' 140 397 285 18 8.5 $colors.Text | Out-Null
    Add-Text $slide1 '资金方本金' 70 426 75 13 8.2 $colors.Mint $true | Out-Null
    Add-Text $slide1 '报价后托管在合约 · 接受后原子放款' 140 424 285 18 8.5 $colors.Text | Out-Null
    Add-Line $slide1 452 365 452 451 $colors.Line 0.8 | Out-Null
    Add-Text $slide1 '到期结算条件' 478 365 170 19 13.5 $colors.White $true | Out-Null
    Add-Pill $slide1 '授权有效' 478 397 86 $colors.Gold
    Add-Pill $slide1 '余额充足' 572 397 86 $colors.Mint
    Add-Pill $slide1 '当前权利人' 666 397 96 $colors.Cyan
    Add-Text $slide1 '→ 结算合约收款 · 按最新权属分账' 478 428 390 16 8.5 $colors.Text | Out-Null
    Add-Text $slide1 '无追索：普通买方信用风险由资金方承担' 478 448 390 14 8.5 $colors.Gold $true | Out-Null
    Add-Text $slide1 '方案 A · 许可式 MVP · 数字凭证不等同于法定票据或还款保证' 48 481 864 16 8.8 $colors.Cyan $true 2 | Out-Null

    $slide2 = $presentation.Slides.Add(2, 12)
    Add-Base $slide2 2
    Add-Header $slide2 '02  /  本项目亮点' '把确权、融资、审计与兑付做成可验证闭环' 'Creditcoin CC3 测试网封闭式 MVP · 链上状态驱动 · 异步证明不阻塞核心流程。'

    $highlights = @(
        @{ Number = '01'; Tag = 'DATA READY'; Title = 'AI 辅助字段提取'; Body = '合同 + 发票 → 买方、供应商、金额与到期日；人工复核后创建凭证。'; Color = $colors.Cyan; X = 48; Y = 143 },
        @{ Number = '02'; Tag = 'SIGNED, NOT LOCKED'; Title = '双签确权 · 不锁款'; Body = '服务端独立验签；Approved Payable 与未来 EIP-3009 授权哈希绑定，签名不转账。'; Color = $colors.Gold; X = 288; Y = 143 },
        @{ Number = '03'; Tag = 'NATIVE STATE MACHINE'; Title = '融资状态机上链'; Body = "requestFinancing() →`nsubmitOffer() → acceptOffer()`n请求、报价、本金托管与接受状态可核验。"; Color = $colors.Mint; X = 48; Y = 284 },
        @{ Number = '04'; Tag = 'REPLAY-SAFE + AUDIT'; Title = '防重放结算 + 异步证明'; Body = '校验窗口、nonce、收款人；ReceivableSettlement 防重复结算，AuditProofRegistry 登记证据哈希。'; Color = $colors.Blue; X = 288; Y = 284 }
    )
    foreach ($item in $highlights) {
        $card = Add-Box $slide2 $item.X $item.Y 218 126 $colors.Panel $item.Color
        $card.Line.Transparency = 0.48
        Add-Text $slide2 $item.Number ($item.X + 14) ($item.Y + 14) 34 22 17 $item.Color $true 1 'Aptos Display' | Out-Null
        $tagShape = Add-Text $slide2 $item.Tag ($item.X + 55) ($item.Y + 18) 148 12 7.2 $colors.Muted $true 1 'Aptos'
        $tagShape.TextFrame2.TextRange.Font.Spacing = 0.7
        Add-Text $slide2 $item.Title ($item.X + 14) ($item.Y + 50) 190 25 12.1 $colors.White $true | Out-Null
        Add-Text $slide2 $item.Body ($item.X + 14) ($item.Y + 82) 190 34 8.25 $colors.Text | Out-Null
    }

    $chainPanel = Add-Box $slide2 532 143 380 281 (Get-Color '0A1D32') $colors.Cyan
    $chainPanel.Line.Transparency = 0.38
    $chainKicker = Add-Text $slide2 'VERIFIABLE PATH' 558 160 320 14 8 $colors.Cyan $true 1 'Aptos'
    $chainKicker.TextFrame2.TextRange.Font.Spacing = 1.4
    Add-Text $slide2 '可验证链路' 558 180 300 25 15 $colors.White $true | Out-Null
    Add-Line $slide2 579 228 579 341 $colors.Line 1 | Out-Null
    Add-Line $slide2 579 245 579 248 $colors.Line 1 $true | Out-Null
    Add-Line $slide2 579 283 579 286 $colors.Line 1 $true | Out-Null
    Add-Line $slide2 579 321 579 324 $colors.Line 1 $true | Out-Null

    $nodes = @(
        @{ Number = '01'; Y = 207; Title = '贸易资料'; Body = 'AI 提取 + 人工复核'; Color = $colors.Cyan },
        @{ Number = '02'; Y = 245; Title = '双签授权'; Body = '独立验签 + 哈希绑定'; Color = $colors.Gold },
        @{ Number = '03'; Y = 283; Title = 'CC3 链上状态'; Body = 'ReceivableSettlement'; Color = $colors.Mint },
        @{ Number = '04'; Y = 321; Title = '异步审计证据'; Body = 'AuditProofRegistry'; Color = $colors.Blue }
    )
    foreach ($node in $nodes) {
        $circle = $slide2.Shapes.AddShape(9, 562, $node.Y, 34, 34)
        $circle.Fill.ForeColor.RGB = $node.Color
        $circle.Line.ForeColor.RGB = $colors.Background
        $circle.Line.Weight = 1.5
        Add-Text $slide2 $node.Number 562 ($node.Y + 10) 34 11 7.5 $colors.Background $true 2 'Aptos' | Out-Null
        Add-Text $slide2 $node.Title 610 ($node.Y + 1) 250 15 10 $colors.White $true | Out-Null
        Add-Text $slide2 $node.Body 610 ($node.Y + 18) 250 13 8.1 $colors.Text | Out-Null
    }
    Add-Pill $slide2 'CC3 TESTNET' 558 365 84 $colors.Cyan
    Add-Pill $slide2 'MockUSDC' 648 365 70 $colors.Gold
    Add-Pill $slide2 '许可式 MVP' 724 365 78 $colors.Mint
    Add-Pill $slide2 '受限 Relayer' 808 365 84 $colors.Blue
    Add-Text $slide2 '审计证明交易事实，不等于余额充足或还款保证。' 558 397 334 14 7.5 $colors.Muted | Out-Null

    $outcomeBar = Add-Box $slide2 48 441 864 51 $colors.PanelAlt $colors.Line
    $outcomeBar.Line.Transparency = 0.25
    $outcomes = @(
        @{ Role = '供应商'; Value = '提前获得流动性'; Color = $colors.Cyan; X = 70 },
        @{ Role = '核心买方'; Value = '确权时不锁款'; Color = $colors.Gold; X = 360 },
        @{ Role = '资金方'; Value = '可验证权属与到期兑付'; Color = $colors.Mint; X = 650 }
    )
    foreach ($outcome in $outcomes) {
        Add-Text $slide2 $outcome.Role $outcome.X 450 70 12 8 $outcome.Color $true | Out-Null
        Add-Text $slide2 $outcome.Value $outcome.X 467 230 15 10.2 $colors.White $true | Out-Null
    }
    Add-Line $slide2 337 450 337 483 $colors.Line 0.8 | Out-Null
    Add-Line $slide2 627 450 627 483 $colors.Line 0.8 | Out-Null
    Add-Text $slide2 '演示边界：Creditcoin CC3 测试网 · MockUSDC · 许可式流程' 48 497 864 13 7.5 $colors.Muted $false 2 | Out-Null

    if ($presentation.Slides.Count -ne 2) {
        throw "Expected exactly two slides, got $($presentation.Slides.Count)"
    }
    if ($presentation.PageSetup.SlideWidth -ne 960 -or $presentation.PageSetup.SlideHeight -ne 540) {
        throw 'Unexpected slide dimensions'
    }

    $presentation.SaveAs($outputPath, 24)
    $presentation.Export($previewPath, 'PNG', 1600, 900)
}
finally {
    if ($presentation) {
        $presentation.Close()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null
    }
    if ($powerPoint) {
        $powerPoint.Quit()
        [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

Write-Output "Created: $outputPath"
Write-Output "Preview: $previewPath"
