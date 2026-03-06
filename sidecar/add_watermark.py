import sys
from PyPDF2 import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
from io import BytesIO

# 读取原PDF
pdf_path = r'C:\Users\liula\Downloads\Resume-YuZiJie.pdf'
reader = PdfReader(pdf_path)
writer = PdfWriter()

# 为每一页添加水印
for page in reader.pages:
    # 创建水印
    packet = BytesIO()
    can = canvas.Canvas(packet, pagesize=letter)
    can.setFont('Helvetica', 40)
    can.setFillColorRGB(0.5, 0.5, 0.5, alpha=0.3)
    can.saveState()
    can.translate(300, 400)
    can.rotate(45)
    can.drawString(0, 0, 'coworkany')
    can.restoreState()
    can.save()
    
    # 合并水印到页面
    packet.seek(0)
    watermark = PdfReader(packet)
    page.merge_page(watermark.pages[0])
    writer.add_page(page)

# 覆盖原文件
with open(pdf_path, 'wb') as output_file:
    writer.write(output_file)

print('WATERMARK_DONE')
sys.stdout.flush()
