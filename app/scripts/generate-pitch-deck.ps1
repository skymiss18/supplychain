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
    Add-Text $slide $text ($x + 5) ($y + 5) ($width - 10) 12 8.5 $color $true 2 | Out-Null
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
    Add-Text $slide 'ATTESTFLOW' 48 518 95 11 7.5 $colors.Muted $true 1 'Aptos' | Out-Null
    Add-Text $slide 'ATTESTCOIN PROTOCOL' 767 518 125 11 7.5 $colors.Muted $true 3 'Aptos' | Out-Null
    Add-Text $slide ([string]$page) 905 518 12 11 7.5 $colors.Muted $false 3 'Aptos' | Out-Null
}

function Add-Header($slide, [string]$kicker, [string]$title, [string]$subtitle) {
    $kickerShape = Add-Text $slide $kicker 49 28 340 15 8.5 $colors.Cyan $true 1 'Aptos'
    $kickerShape.TextFrame2.TextRange.Font.Spacing = 1.5
    Add-Text $slide $title 48 52 864 42 23.5 $colors.White $true | Out-Null
    Add-Text $slide $subtitle 49 101 850 24 10.5 $colors.Text | Out-Null
}

$scriptDirectory = if ($PSScriptRoot) { $PSScriptRoot } else { (Resolve-Path '.\app\scripts').Path }
$workspaceRoot = (Resolve-Path (Join-Path $scriptDirectory '..\..')).Path
$outputPath = Join-Path $workspaceRoot 'AttestFlow-Pitch-Deck.pptx'
$previewPath = Join-Path $workspaceRoot '.ppt-preview'
if (Test-Path $previewPath) { Remove-Item $previewPath -Recurse -Force }
New-Item -ItemType Directory -Path $previewPath | Out-Null

$powerPoint = New-Object -ComObject PowerPoint.Application
$powerPoint.Visible = -1
$presentation = $powerPoint.Presentations.Add()
$presentation.PageSetup.SlideWidth = 960
$presentation.PageSetup.SlideHeight = 540

try {
    $slide1 = $presentation.Slides.Add(1, 12)
    Add-Base $slide1 1
    Add-Header $slide1 '01  /  ATTESTCOIN IN THE LOOP' '一张真实发票，如何变成可融资、可兑付的数字资产？' 'AttestFlow 不是在流程末尾补一个证明，而是用 Attestcoin 协议驱动证据、融资、权属与兑付。'

    Add-Line $slide1 56 163 903 163 $colors.Blue 2 $true | Out-Null
    $steps = @(
        @{ Role = '供应商'; Title = '提交贸易凭证'; Detail = "合同 + 发票`n生成 receivableIdHash"; Color = $colors.Cyan },
        @{ Role = '核心企业'; Title = '确认真实债务'; Detail = "EIP-3009 授权`n绑定 authorizationHash"; Color = $colors.Gold },
        @{ Role = '供应商'; Title = '发起融资询价'; Detail = "requestFinancing()`n发出源交易事件"; Color = $colors.Cyan },
        @{ Role = '资金方'; Title = '提交无追索报价'; Detail = "submitOffer()`n本金锁入合约"; Color = $colors.Mint },
        @{ Role = '供应商'; Title = '确认融资报价'; Detail = "acceptOffer()`n放款与权属同步"; Color = $colors.Cyan },
        @{ Role = '资金方'; Title = '到期兑付'; Detail = "settleWithAuthorization()`nclaim() 钱包领取"; Color = $colors.Mint }
    )
    $cardXs = @(48, 200, 352, 504, 656, 808)
    for ($index = 0; $index -lt $steps.Count; $index++) {
        $step = $steps[$index]
        $x = $cardXs[$index]
        $card = Add-Box $slide1 $x 140 112 180 $colors.Panel $step.Color
        $card.Line.Transparency = 0.45
        $badge = $slide1.Shapes.AddShape(9, ($x + 42), 127, 28, 28)
        $badge.Fill.ForeColor.RGB = $step.Color
        $badge.Line.ForeColor.RGB = $colors.Background
        $badge.Line.Weight = 2
        Add-Text $slide1 (($index + 1).ToString('00')) ($x + 42) 135 28 10 7.5 $colors.Background $true 2 'Aptos' | Out-Null
        Add-Pill $slide1 $step.Role ($x + 16) 166 80 $step.Color
        Add-Text $slide1 $step.Title ($x + 10) 207 92 32 12.5 $colors.White $true 2 | Out-Null
        Add-Line $slide1 ($x + 25) 248 ($x + 87) 248 $step.Color 0.8 | Out-Null
        Add-Text $slide1 $step.Detail ($x + 8) 263 96 38 8.7 $colors.Text $false 2 | Out-Null
    }

    $rail = Add-Box $slide1 48 345 864 108 $colors.PanelAlt $colors.Blue
    $rail.Line.Transparency = 0.35
    Add-Box $slide1 48 345 6 108 $colors.Cyan $colors.Cyan 0 | Out-Null
    Add-Text $slide1 'ATTESTCOIN PROTOCOL · CC3 执行轨道' 70 365 300 23 13.5 $colors.White $true | Out-Null
    Add-Text $slide1 '两份核心合约承接六次协议写入；业务状态以链上记录为准，本地数据只做缓存。' 70 397 320 32 8.8 $colors.Text | Out-Null
    Add-Pill $slide1 'REQUEST FINANCING' 410 371 112 $colors.Gold
    Add-Pill $slide1 'REGISTER PROOF' 532 371 112 $colors.Mint
    Add-Pill $slide1 'SUBMIT / ACCEPT OFFER' 654 371 112 $colors.Cyan
    Add-Pill $slide1 'SETTLE / CLAIM' 776 371 112 $colors.Blue
    Add-Text $slide1 '贸易流' 415 415 45 13 8 $colors.Muted $true | Out-Null
    Add-Line $slide1 460 422 535 422 $colors.Cyan 1 $true | Out-Null
    Add-Text $slide1 '资金流' 550 415 45 13 8 $colors.Muted $true | Out-Null
    Add-Line $slide1 595 422 670 422 $colors.Mint 1 $true | Out-Null
    Add-Text $slide1 '信任流' 685 415 45 13 8 $colors.Muted $true | Out-Null
    Add-Line $slide1 730 422 805 422 $colors.Gold 1 $true | Out-Null
    Add-Text $slide1 '不是“链上存证”  ·  而是 Attestcoin 原生融资与兑付闭环' 48 474 864 20 10.5 $colors.Cyan $true 2 | Out-Null

    $slide2 = $presentation.Slides.Add(2, 12)
    Add-Base $slide2 2
    Add-Header $slide2 '02  /  PROTOCOL DEPTH' 'Attestcoin 深度使用：两份合约，六次写入，一条完整生命周期' '从源交易证明到融资状态机，再到防重放结算，协议不是装饰层，而是业务事实的最终来源。'

    $highlights = @(
        @{ Number = '01'; Tag = 'NATIVE FINANCING STATE'; Title = '原生融资状态机'; Body = 'requestFinancing → submitOffer → acceptOffer；请求、定价、本金托管与成交状态全部在协议内。'; Color = $colors.Cyan; X = 48; Y = 138 },
        @{ Number = '02'; Tag = 'THREE-LAYER ATTESTATION'; Title = '三层审计证据绑定'; Body = '源交易 + 授权哈希 + 区块哈希生成 evidenceHash，再由 registerProof 写入不可变注册表。'; Color = $colors.Gold; X = 290; Y = 138 },
        @{ Number = '03'; Tag = 'ATOMIC DELIVERY VERSUS PAYMENT'; Title = '原子放款与权属更新'; Body = '报价先锁定精确本金；供应商接受后自动放款，并将资金方固化为到期结算接收人。'; Color = $colors.Mint; X = 48; Y = 290 },
        @{ Number = '04'; Tag = 'REPLAY-SAFE SETTLEMENT'; Title = '防重放到期结算'; Body = 'settleWithAuthorization 校验窗口、nonce 与收款人；claimable + claim 确保资金不可重定向。'; Color = $colors.Blue; X = 290; Y = 290 }
    )
    foreach ($item in $highlights) {
        $card = Add-Box $slide2 $item.X $item.Y 218 128 $colors.Panel $item.Color
        $card.Line.Transparency = 0.48
        Add-Text $slide2 $item.Number ($item.X + 14) ($item.Y + 14) 34 22 17 $item.Color $true 1 'Aptos Display' | Out-Null
        $tagShape = Add-Text $slide2 $item.Tag ($item.X + 55) ($item.Y + 18) 145 12 7.2 $colors.Muted $true 1 'Aptos'
        $tagShape.TextFrame2.TextRange.Font.Spacing = 0.7
        Add-Text $slide2 $item.Title ($item.X + 14) ($item.Y + 50) 190 25 12.2 $colors.White $true | Out-Null
        Add-Text $slide2 $item.Body ($item.X + 14) ($item.Y + 82) 190 33 8.5 $colors.Text | Out-Null
    }

    $formula = Add-Box $slide2 534 138 378 280 (Get-Color '0A1D32') $colors.Cyan
    $formula.Line.Transparency = 0.38
    $formulaKicker = Add-Text $slide2 'THE WINNING FORMULA' 560 160 326 14 8 $colors.Cyan $true 2 'Aptos'
    $formulaKicker.TextFrame2.TextRange.Font.Spacing = 1.4
    Add-Text $slide2 '2 份核心合约' 585 202 276 30 17.5 $colors.White $true 2 | Out-Null
    Add-Text $slide2 '+' 656 237 135 24 21 $colors.Cyan $true 2 'Aptos' | Out-Null
    Add-Text $slide2 '6 次协议写入' 585 270 276 30 17.5 $colors.White $true 2 | Out-Null
    Add-Text $slide2 '+' 656 305 135 24 21 $colors.Mint $true 2 'Aptos' | Out-Null
    Add-Text $slide2 '1 条完整生命周期' 585 338 276 30 17.5 $colors.White $true 2 | Out-Null
    Add-Line $slide2 600 376 846 376 $colors.Line 1 | Out-Null
    Add-Text $slide2 '深度使用，不是贴牌集成' 570 389 306 27 18.5 $colors.Gold $true 2 | Out-Null

    $outcomeBar = Add-Box $slide2 48 435 864 58 $colors.PanelAlt $colors.Line
    $outcomeBar.Line.Transparency = 0.25
    $outcomes = @(
        @{ Role = '供应商'; Value = '更快获得低成本流动性'; Color = $colors.Cyan; X = 70 },
        @{ Role = '核心企业'; Value = '资金留存至真实到期日'; Color = $colors.Gold; X = 353 },
        @{ Role = '资金方'; Value = '获得可验证债权与兑付'; Color = $colors.Mint; X = 636 }
    )
    foreach ($outcome in $outcomes) {
        Add-Text $slide2 $outcome.Role $outcome.X 447 60 12 8 $outcome.Color $true | Out-Null
        Add-Text $slide2 $outcome.Value $outcome.X 466 230 16 10.2 $colors.White $true | Out-Null
    }
    Add-Line $slide2 330 447 330 482 $colors.Line 0.8 | Out-Null
    Add-Line $slide2 613 447 613 482 $colors.Line 0.8 | Out-Null

    $presentation.SaveAs($outputPath, 24)
    $presentation.Export($previewPath, 'PNG', 1600, 900)
}
finally {
    $presentation.Close()
    $powerPoint.Quit()
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($presentation) | Out-Null
    [System.Runtime.InteropServices.Marshal]::ReleaseComObject($powerPoint) | Out-Null
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

Write-Output "Created: $outputPath"
Write-Output "Preview: $previewPath"