# -*- coding: utf-8 -*-
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor

# 创建演示文稿
prs = Presentation()
prs.slide_width = Inches(10)
prs.slide_height = Inches(7.5)

def add_title_slide(prs, title, subtitle):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    background = slide.background
    fill = background.fill
    fill.solid()
    fill.fore_color.rgb = RGBColor(15, 76, 129)
    
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(2.5), Inches(9), Inches(1))
    title_frame = title_box.text_frame
    title_frame.text = title
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(48)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(255, 255, 255)
    title_para.alignment = PP_ALIGN.CENTER
    
    subtitle_box = slide.shapes.add_textbox(Inches(0.5), Inches(4), Inches(9), Inches(0.8))
    subtitle_frame = subtitle_box.text_frame
    subtitle_frame.text = subtitle
    subtitle_para = subtitle_frame.paragraphs[0]
    subtitle_para.font.size = Pt(24)
    subtitle_para.font.color.rgb = RGBColor(200, 220, 240)
    subtitle_para.alignment = PP_ALIGN.CENTER

def add_content_slide(prs, title, content_items):
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    
    title_bg = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(10), Inches(1))
    title_bg.fill.solid()
    title_bg.fill.fore_color.rgb = RGBColor(15, 76, 129)
    title_bg.line.color.rgb = RGBColor(15, 76, 129)
    
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.2), Inches(9), Inches(0.6))
    title_frame = title_box.text_frame
    title_frame.text = title
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(32)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(255, 255, 255)
    
    content_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(8.4), Inches(5.5))
    text_frame = content_box.text_frame
    text_frame.word_wrap = True
    
    for i, item in enumerate(content_items):
        if i > 0:
            text_frame.add_paragraph()
        p = text_frame.paragraphs[i]
        p.text = item
        p.font.size = Pt(18)
        p.font.color.rgb = RGBColor(50, 50, 50)
        p.space_before = Pt(12)
        p.level = 0

# 封面
add_title_slide(prs, "2026年AI在智慧城市中的发展", "技术创新 · 应用场景 · 未来展望")

# 目录
slide = prs.slides.add_slide(prs.slide_layouts[6])
title_bg = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(10), Inches(1))
title_bg.fill.solid()
title_bg.fill.fore_color.rgb = RGBColor(15, 76, 129)
title_bg.line.color.rgb = RGBColor(15, 76, 129)

title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.2), Inches(9), Inches(0.6))
title_frame = title_box.text_frame
title_frame.text = "目录"
title_para = title_frame.paragraphs[0]
title_para.font.size = Pt(32)
title_para.font.bold = True
title_para.font.color.rgb = RGBColor(255, 255, 255)

content_items = [
    "01  智慧城市的定义和发展背景",
    "02  AI在智慧城市中的主要应用场景",
    "03  2026年最新技术和趋势",
    "04  成功案例分析",
    "05  未来展望"
]

content_box = slide.shapes.add_textbox(Inches(2), Inches(2), Inches(6), Inches(4.5))
text_frame = content_box.text_frame
for i, item in enumerate(content_items):
    if i > 0:
        text_frame.add_paragraph()
    p = text_frame.paragraphs[i]
    p.text = item
    p.font.size = Pt(24)
    p.font.color.rgb = RGBColor(15, 76, 129)
    p.font.bold = True
    p.space_before = Pt(20)

# 智慧城市定义
add_content_slide(prs, "01 智慧城市的定义和发展背景", [
    "智慧城市定义",
    "   利用物联网、云计算、大数据、人工智能等新一代信息技术",
    "   实现城市智慧化管理和运行，提升城市治理效率和居民生活质量",
    "",
    "市场规模",
    "   全球智慧城市市场：2025年699.7亿美元 -> 2030年1445.6亿美元（CAGR 15.6%）",
    "   AI在智慧城市市场：2025年2000亿美元 -> 2033年12000亿美元",
    "",
    "全球发展态势",
    "   亚洲地区呈现最高成长速度",
    "   迪拜、阿布扎比首次进入2025智慧城市指数前5位",
    "   中国、新加坡、卡塔尔等国家积极推进智慧城市建设"
])

# 应用场景1
add_content_slide(prs, "02 AI在智慧城市中的主要应用场景（1/2）", [
    "智能交通管理",
    "   AI交通系统有效缓解道路拥堵",
    "   动态信号优化系统提升区域平均通行效率超过15%",
    "   实时路况预测和智能导航",
    "",
    "智能安防监控",
    "   预测性安防系统在事故发生前及时预警",
    "   智能视频分析和人脸识别技术",
    "   香港锐眼计划：2028年达到60,000支智能摄像头覆盖",
    "",
    "智能能源管理",
    "   AI调度将电网的波动性可再生能源消纳能力提升10%以上",
    "   实时监测和调整能源使用，减少浪费",
    "   智能电网和分布式能源管理"
])

# 应用场景2
add_content_slide(prs, "02 AI在智慧城市中的主要应用场景（2/2）", [
    "城市治理优化",
    "   物联网垃圾箱在将满时自动发出清运提醒",
    "   智能街灯根据行人数量自动调节亮度",
    "   数据要素流通实现跨部门创新成果增长50%（预计2026年）",
    "",
    "公共服务提升",
    "   AI辅助医疗诊断和健康管理",
    "   智能教育平台和个性化学习",
    "   数字政府服务和一站式办事平台",
    "",
    "环境监测与保护",
    "   空气质量实时监测和预警",
    "   水资源智能管理，消耗量降低超20%",
    "   城市绿色低碳发展支持"
])

# 技术趋势1
add_content_slide(prs, "03 2026年最新技术和趋势（1/2）", [
    "Agentic AI与生成式AI",
    "   Agentic AI重塑城市系统，实现自主决策和执行",
    "   生成式AI解锁政府数据，提供智能分析和预测",
    "   AI成为城市的中枢神经系统",
    "",
    "5G/6G网络与物联网",
    "   全球IoT市场在智慧城市领域：2021年3000亿美元 -> 2026年6500亿美元",
    "   超高速、低延迟网络支持实时数据传输",
    "   万物互联实现城市全域感知",
    "",
    "数字孪生技术",
    "   创建城市的虚拟副本，进行模拟和优化",
    "   实时数据同步，支持预测性维护",
    "   CityOS统一数字平台整合城市运营"
])

# 技术趋势2
add_content_slide(prs, "03 2026年最新技术和趋势（2/2）", [
    "空中交通革命",
    "   空中出租车（Air Taxis）预计2026年投入商业运营",
    "   机器人出租车（Robotaxis）在更多城市街道上运行",
    "   立体交通网络缓解地面拥堵",
    "",
    "可持续发展技术",
    "   搭载计算优化芯片的高感知能力基础设施",
    "   智能建筑和绿色能源整合",
    "   城市碳排放实时监测和管理",
    "",
    "数据融合与智能分析",
    "   跨部门数据整合和共享",
    "   边缘计算提升实时处理能力",
    "   AI驱动的城市运营决策支持系统"
])

# 案例1
add_content_slide(prs, "04 成功案例分析（1/2）", [
    "新加坡 - iTransport系统",
    "   全球领先的智能交通管理系统",
    "   整合公共交通、私人交通和共享出行",
    "   实时优化交通流量，减少拥堵30%以上",
    "",
    "卡塔尔Lusail City - AGIL智慧城市操作系统",
    "   全球首个完全智能化的新建城市",
    "   统一平台管理能源、交通、安防、公共设施",
    "   AI驱动的城市大脑实现自主运营",
    "",
    "北京 - AI之城",
    "   2025年AI核心产业规模达3500亿元，占全国50%",
    "   AI相关企业2400家，占全国总量50%",
    "   每15元GDP中有1元直接来自AI产业"
])

# 案例2
add_content_slide(prs, "04 成功案例分析（2/2）", [
    "迪拜 - 智慧城市2.0",
    "   2025年智慧城市指数亚洲地区领先",
    "   全面推进数字政府和智能服务",
    "   目标2030年成为全球最智慧城市",
    "",
    "香港 - 锐眼计划",
    "   每年增加超过2万支智能摄像头",
    "   2028年达到约60,000支的覆盖规模",
    "   AI视频分析提升公共安全和城市管理效率",
    "",
    "济南 - AI泉城赋能行动",
    "   重点围绕数字政府、制造、医疗、能源、交通等领域",
    "   构建人工智能应用场景体系",
    "   到2026年核心产业规模显著增长"
])

# 未来展望
add_content_slide(prs, "05 未来展望", [
    "技术演进方向",
    "   AI从辅助工具演变为城市运营的核心驱动力",
    "   智慧城市进入2.0阶段：从连接到思考与行动",
    "   人机协同治理模式成为主流",
    "",
    "应用深化趋势",
    "   从单点应用到全域智能化",
    "   从被动响应到主动预测和干预",
    "   从技术驱动到以人为本的服务创新",
    "",
    "全球协同发展",
    "   国际标准和规范逐步建立",
    "   跨城市、跨国家的数据共享和协作",
    "   智慧城市经验和技术的全球推广",
    "",
    "挑战与机遇并存",
    "   数据隐私和安全保护",
    "   数字鸿沟和公平性问题",
    "   技术伦理和治理框架完善"
])

# 结束页
slide = prs.slides.add_slide(prs.slide_layouts[6])
background = slide.background
fill = background.fill
fill.solid()
fill.fore_color.rgb = RGBColor(15, 76, 129)

thank_you_box = slide.shapes.add_textbox(Inches(0.5), Inches(2.5), Inches(9), Inches(1.5))
thank_you_frame = thank_you_box.text_frame
thank_you_frame.text = "谢谢观看"
thank_you_para = thank_you_frame.paragraphs[0]
thank_you_para.font.size = Pt(54)
thank_you_para.font.bold = True
thank_you_para.font.color.rgb = RGBColor(255, 255, 255)
thank_you_para.alignment = PP_ALIGN.CENTER

subtitle_box = slide.shapes.add_textbox(Inches(0.5), Inches(4.2), Inches(9), Inches(0.6))
subtitle_frame = subtitle_box.text_frame
subtitle_frame.text = "AI赋能智慧城市，共创美好未来"
subtitle_para = subtitle_frame.paragraphs[0]
subtitle_para.font.size = Pt(24)
subtitle_para.font.color.rgb = RGBColor(200, 220, 240)
subtitle_para.alignment = PP_ALIGN.CENTER

# 保存文件
prs.save('2026年AI在智慧城市中的发展.pptx')
print("PPT创建成功！")
