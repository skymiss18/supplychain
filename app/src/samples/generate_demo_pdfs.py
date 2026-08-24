from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUTPUT_DIR = Path(__file__).parent
FONT_PATH = Path(r"C:\Windows\Fonts\simhei.ttf")
pdfmetrics.registerFont(TTFont("SimHei", str(FONT_PATH)))

PAGE_WIDTH, PAGE_HEIGHT = A4
INK = colors.HexColor("#17262F")
TEAL = colors.HexColor("#087F73")
MUTED = colors.HexColor("#667780")
LINE = colors.HexColor("#DCE4E7")
SOFT = colors.HexColor("#F2F6F6")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name="CNTitle", fontName="SimHei", fontSize=22, leading=28, textColor=INK, alignment=TA_CENTER, spaceAfter=5 * mm))
styles.add(ParagraphStyle(name="CNSubtitle", fontName="SimHei", fontSize=9, leading=14, textColor=TEAL, alignment=TA_CENTER, spaceAfter=8 * mm))
styles.add(ParagraphStyle(name="CNHeading", fontName="SimHei", fontSize=11, leading=16, textColor=INK, spaceBefore=4 * mm, spaceAfter=2 * mm))
styles.add(ParagraphStyle(name="CNBody", fontName="SimHei", fontSize=9, leading=17, textColor=INK))
styles.add(ParagraphStyle(name="CNSmall", fontName="SimHei", fontSize=7.5, leading=12, textColor=MUTED))
styles.add(ParagraphStyle(name="CNRight", fontName="SimHei", fontSize=8, leading=12, textColor=MUTED, alignment=TA_RIGHT))


def paragraph(text: str, style: str = "CNBody") -> Paragraph:
    return Paragraph(text.replace("\n", "<br/>"), styles[style])


def footer(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, 16 * mm, PAGE_WIDTH - 20 * mm, 16 * mm)
    canvas.setFont("SimHei", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 10 * mm, "AttestFlow 演示材料 · 不具有法律或税务效力")
    canvas.drawRightString(PAGE_WIDTH - 20 * mm, 10 * mm, f"第 {document.page} 页")
    canvas.restoreState()


def build_contract():
    path = OUTPUT_DIR / "supply-contract.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm, topMargin=18 * mm, bottomMargin=22 * mm, title="供应链采购合同（演示材料）", author="AttestFlow")
    story = [
        paragraph("供应链采购合同", "CNTitle"),
        paragraph("SUPPLY CHAIN PURCHASE AGREEMENT · DEMO", "CNSubtitle"),
    ]
    metadata = Table([
        [paragraph("合同编号", "CNSmall"), paragraph("SC-2026-0822-001"), paragraph("签署日期", "CNSmall"), paragraph("2026-08-22")],
        [paragraph("付款币种", "CNSmall"), paragraph("USDC"), paragraph("付款到期日", "CNSmall"), paragraph("2026-12-20")],
    ], colWidths=[26 * mm, 55 * mm, 27 * mm, 55 * mm])
    metadata.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT), ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.extend([metadata, Spacer(1, 6 * mm), paragraph("合同主体", "CNHeading")])
    parties = Table([
        [paragraph("甲方（核心买方）", "CNSmall"), paragraph("星海零售集团有限公司")],
        [paragraph("统一社会信用代码", "CNSmall"), paragraph("91310000DEMO202601")],
        [paragraph("乙方（原始供应商）", "CNSmall"), paragraph("远景物流设备有限公司")],
        [paragraph("统一社会信用代码", "CNSmall"), paragraph("91440000DEMO202602")],
    ], colWidths=[42 * mm, 121 * mm])
    parties.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story.append(parties)
    sections = [
        ("一、交易内容", "乙方向甲方提供智能仓储分拣设备及安装服务，合同总价为 100 USDC（壹佰 USDC）。"),
        ("二、交付与验收", "设备应于 2026-09-15 前完成交付，并由甲方在交付后五个工作日内完成验收。验收记录应与本合同及对应发票共同构成贸易真实性证明。"),
        ("三、结算条款", "甲方在收到合规发票并完成验收后形成应付账款。对应发票编号为 INV-2026-0822-01，应付金额为 100 USDC，付款到期日为 2026-12-20。"),
        ("四、权利确认", "甲方确认，在设备验收合格且发票信息与本合同一致后，该应付款可作为经确认的应收账款进入 AttestFlow 融资流程。链上记录仅用于证明、登记与结算，不替代本合同所建立的法律关系。"),
        ("五、演示声明", "本文件由 AttestFlow 自动生成，仅为产品演示使用。文件中的企业、代码、交易及付款义务均为虚构，不构成真实合同。"),
    ]
    for heading, body in sections:
        story.extend([paragraph(heading, "CNHeading"), paragraph(body)])
    story.extend([Spacer(1, 10 * mm), Table([[paragraph("甲方授权代表：________________", "CNBody"), paragraph("乙方授权代表：________________", "CNBody")], [paragraph("日期：2026-08-22", "CNSmall"), paragraph("日期：2026-08-22", "CNSmall")]], colWidths=[82 * mm, 82 * mm], style=[("TOPPADDING", (0, 0), (-1, -1), 8)])])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


def build_invoice():
    path = OUTPUT_DIR / "commercial-invoice.pdf"
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=20 * mm, leftMargin=20 * mm, topMargin=18 * mm, bottomMargin=22 * mm, title="商业发票（演示材料）", author="AttestFlow")
    story = [paragraph("商业发票", "CNTitle"), paragraph("COMMERCIAL INVOICE · DEMO", "CNSubtitle")]
    header = Table([
        [paragraph("发票编号", "CNSmall"), paragraph("INV-2026-0822-01"), paragraph("开票日期", "CNSmall"), paragraph("2026-09-16")],
        [paragraph("合同编号", "CNSmall"), paragraph("SC-2026-0822-001"), paragraph("付款到期日", "CNSmall"), paragraph("2026-12-20")],
    ], colWidths=[25 * mm, 57 * mm, 27 * mm, 54 * mm])
    header.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), SOFT), ("BOX", (0, 0), (-1, -1), 0.5, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 7), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story.extend([header, Spacer(1, 6 * mm)])
    parties = Table([
        [paragraph("销售方 / SELLER", "CNSmall"), paragraph("购买方 / BUYER", "CNSmall")],
        [paragraph("远景物流设备有限公司<br/>统一社会信用代码：91440000DEMO202602"), paragraph("星海零售集团有限公司<br/>统一社会信用代码：91310000DEMO202601")],
    ], colWidths=[81.5 * mm, 81.5 * mm])
    parties.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E6F3F0")), ("BOX", (0, 0), (-1, -1), 0.5, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.extend([parties, Spacer(1, 8 * mm)])
    items = Table([
        [paragraph("项目说明", "CNSmall"), paragraph("数量", "CNSmall"), paragraph("单价（USDC）", "CNSmall"), paragraph("金额（USDC）", "CNSmall")],
        [paragraph("智能仓储分拣设备及安装服务"), paragraph("1 批"), paragraph("100", "CNRight"), paragraph("100", "CNRight")],
    ], colWidths=[76 * mm, 20 * mm, 32 * mm, 35 * mm])
    items.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white), ("BOX", (0, 0), (-1, -1), 0.5, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story.extend([items, Spacer(1, 5 * mm)])
    total = Table([
        [paragraph("付款币种", "CNSmall"), paragraph("USDC", "CNRight")],
        [paragraph("应收金额", "CNHeading"), paragraph("100 USDC", "CNRight")],
    ], colWidths=[105 * mm, 58 * mm])
    total.setStyle(TableStyle([("LINEABOVE", (0, 1), (-1, 1), 1, TEAL), ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    story.extend([total, Spacer(1, 10 * mm), paragraph("收款说明", "CNHeading"), paragraph("本发票对应供应链采购合同 SC-2026-0822-001。买方验收完成后，应于 2026-12-20 前支付 100 USDC。"), Spacer(1, 7 * mm), paragraph("演示声明", "CNHeading"), paragraph("本文件由 AttestFlow 自动生成，仅用于 AI 文档识别与产品演示，不具有税务、会计或法律效力。", "CNSmall")])
    doc.build(story, onFirstPage=footer, onLaterPages=footer)


if __name__ == "__main__":
    build_contract()
    build_invoice()
    print(OUTPUT_DIR / "supply-contract.pdf")
    print(OUTPUT_DIR / "commercial-invoice.pdf")
