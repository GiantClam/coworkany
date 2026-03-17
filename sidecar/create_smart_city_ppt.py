#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成"2026年AI在智慧城市中的发展"PPT演示文稿
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor

def create_presentation():
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)
    
    # 封面页
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    
    title_box = slide.shapes.add_textbox(Inches(1), Inches(2.5), Inches(8), Inches(1.5))
    title_frame = title_box.text_frame
    title_frame.text = "2026年AI在智慧城市中的发展"
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(44)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(0, 51, 102)
    title_para.alignment = PP_ALIGN.CENTER
    
    subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(4.2), Inches(8), Inches(0.8))
    subtitle_frame = subtitle_box.text_frame
    subtitle_frame.text = "技术趋势 · 应用场景 · 成功案例 · 未来展望"
    subtitle_para = subtitle_frame.paragraphs[0]
    subtitle_para.font.size = Pt(20)
    subtitle_para.font.color.rgb = RGBColor(100, 100, 100)
    subtitle_para.alignment = PP_ALIGN.CENTER
    
    date_box = slide.shapes.add_textbox(Inches(1), Inches(6.5), Inches(8), Inches(0.5))
    date_frame = date_box.text_frame
    date_frame.text = "2026年3月"
    date_para = date_frame.paragraphs[0]
    date_para.font.size = Pt(16)
    date_para.font.color.rgb = RGBColor(150, 150, 150)
    date_para.alignment = PP_ALIGN.CENTER
    
    # 第1页：智慧城市的定义和发展背景
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    title = slide.shapes.title
    title.text = "智慧城市的定义和发展背景"
    title.text_frame.paragraphs[0].font.size = Pt(36)
    title.text_frame.paragraphs[0].font.color.rgb = RGBColor(0, 51, 102)
    
    content = slide.placeholders[1]
    tf = content.text_frame
    tf.clear()
    
    p = tf.paragraphs[0]
    p.text = "智慧城市定义"
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = RGBColor(0, 102, 204)
    p.space_after = Pt(10)
    
    p = tf.add_paragraph()
    p.text = "利用信息技术、物联网、大数据、云计算等前沿科技，集成城市组成系统和服务，提升资源运用效率，优化城市管理和服务，改善市民生活质量"
    p.font.size = Pt(18)
    p.level = 1
    p.space_after = Pt(15)
    
    p = tf.add_paragraph()
    p.text = "发展历程"
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = RGBColor(0, 102, 204)
    p.space_after = Pt(10)
    
    milestones = [
        '2008年：IBM提出"智慧地球"概念',
        '2010年：IBM正式提出"智慧城市"愿景',
        '2015-2020年：全球智慧城市试点快速扩展',
        '2024-2026年：AI技术深度融合，进入智能化新阶段'
    ]
    
    for milestone in milestones:
        p = tf.add_paragraph()
        p.text = milestone
        p.font.size = Pt(18)
        p.level = 1
    
    # 第2页：AI在智慧城市中的主要应用场景
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    title = slide.shapes.title
    title.text = "AI在智慧城市中的主要应用场景"
    title.text_frame.paragraphs[0].font.size = Pt(36)
    title.text_frame.paragraphs[0].font.color.rgb = RGBColor(0, 51, 102)
    
    content = slide.placeholders[1]
    tf = content.text_frame
    tf.clear()
    
    scenarios = [
        ("智能交通管理", "实时交通流量优化、智能信号灯控制、自动驾驶车辆协调"),
        ("能源智能调度", "电网负载预测、可再生能源优化、建筑能耗管理"),
        ("公共安全监控", "AI视频分析、异常行为检测、应急响应系统"),
        ("智慧政务服务", "AI政务助手、自动化审批流程、市民服务优化"),
        ("环境监测治理", "空气质量预测、水资源管理、垃圾分类智能化"),
        ("医疗健康服务", "远程诊疗、健康数据分析、疫情预警系统")
    ]
    
    for i, (scenario, desc) in enumerate(scenarios):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = scenario
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = RGBColor(0, 102, 204)
        
        p = tf.add_paragraph()
        p.text = desc
        p.font.size = Pt(16)
        p.level = 1
        p.space_after = Pt(8)
    
    # 第3页：2026年最新技术和趋势
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    title = slide.shapes.title
    title.text = "2026年最新技术和趋势"
    title.text_frame.paragraphs[0].font.size = Pt(36)
    title.text_frame.paragraphs[0].font.color.rgb = RGBColor(0, 51, 102)
    
    content = slide.placeholders[1]
    tf = content.text_frame
    tf.clear()
    
    trends = [
        ("AI Agent系统普及", "65%城市部署AI代理，实现跨系统数据编排和自主决策"),
        ("生成式AI深度应用", "城市治理从被动响应转向主动预测和优化"),
        ("数字孪生技术成熟", "城市级数字孪生平台，实时模拟和预测城市运行"),
        ("边缘计算+IoT融合", "实时数据处理，降低延迟，提升响应速度"),
        ("AI赋能轨道交通", "铁路网络演变为主动思考系统，预测性维护"),
        ("隐私与安全强化", "联邦学习、差分隐私等技术保障数据安全")
    ]
    
    for i, (trend, desc) in enumerate(trends):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = f"{i+1}. {trend}"
        p.font.size = Pt(20)
        p.font.bold = True
        p.font.color.rgb = RGBColor(204, 0, 0)
        
        p = tf.add_paragraph()
        p.text = desc
        p.font.size = Pt(16)
        p.level = 1
        p.space_after = Pt(8)
    
    # 第4页：成功案例分析（国际）
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    title = slide.shapes.title
    title.text = "成功案例分析 - 国际领先城市"
    title.text_frame.paragraphs[0].font.size = Pt(36)
    title.text_frame.paragraphs[0].font.color.rgb = RGBColor(0, 51, 102)
    
    content = slide.placeholders[1]
    tf = content.text_frame
    tf.clear()
    
    p = tf.paragraphs[0]
    p.text = "🇸🇬 新加坡 - Smart Nation 2.0"
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = RGBColor(0, 153, 76)
    
    singapore_points = [
        "2024年启动Smart Nation 2.0战略",
        "AI作为赋能工具，聚焦经济、社会、政府、安全四大领域",
        "数字孪生技术全球领先，成为其他城市学习标杆",
        "数字化政务服务覆盖率超90%"
    ]
    
    for point in singapore_points:
        p = tf.add_paragraph()
        p.text = point
        p.font.size = Pt(16)
        p.level = 1
    
    p = tf.add_paragraph()
    p.text = ""
    p.space_after = Pt(10)
    
    p = tf.add_paragraph()
    p.text = "🇦🇪 迪拜 - 数据驱动创新生态"
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = RGBColor(0, 153, 76)
    
    dubai_points = [
        "吸引东南亚AI初创企业的智慧城市战略",
        "政策支持与技术创新双轮驱动",
        "智能交通、智慧能源等领域快速发展"
    ]
    
    for point in dubai_points:
        p = tf.add_paragraph()
        p.text = point
        p.font.size = Pt(16)
        p.level = 1
    
    # 第5页：成功案例分析（中国）
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    title = slide.shapes.title
    title.text = "成功案例分析 - 中国领先城市"
    title.text_frame.paragraphs[0].font.size = Pt(36)
    title.text_frame.paragraphs[0].font.color.rgb = RGBColor(0, 51, 102)
    
    content = slide.placeholders[1]
    tf = content.text_frame
    tf.clear()
    
    p = tf.paragraphs[0]
    p.text = "🏙️ 深圳 - AI产业规模领先"
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = RGBColor(204, 0, 0)
    
    shenzhen_points = [
        "637个AI应用场景落地，覆盖城市治理各领域",
        "2026年目标：AI核心产业规模8000亿-1万亿元",
        "AI企业数量和创新能力全国领先",
        "智慧交通、智慧医疗等领域成果显著"
    ]
    
    for point in shenzhen_points:
        p = tf.add_paragraph()
        p.text = point
        p.font.size = Pt(16)
        p.level = 1
    
    p = tf.add_paragraph()
    p.text = ""
    p.space_after = Pt(10)
    
    p = tf.add_paragraph()
    p.text = "🌆 杭州 - AI第一城战略"
    p.font.size = Pt(24)
    p.font.bold = True
    p.font.color.rgb = RGBColor(204, 0, 0)
    
    hangzhou_points = [
        "AI核心产业营收增长26.3%",
        "城市大脑系统全球知名",
        "数字经济与AI深度融合",
        "创新试验场，探索AI治理新模式"
    ]
    
    for point in hangzhou_points:
        p = tf.add_paragraph()
        p.text = point
        p.font.size = Pt(16)
        p.level = 1
    
    # 第6页：未来展望
    slide = prs.slides.add_slide(prs.slide_layouts[1])
    title = slide.shapes.title
    title.text = "未来展望"
    title.text_frame.paragraphs[0].font.size = Pt(36)
    title.text_frame.paragraphs[0].font.color.rgb = RGBColor(0, 51, 102)
    
    content = slide.placeholders[1]
    tf = content.text_frame
    tf.clear()
    
    future_trends = [
        ("2027-2028年", "AI Agent成为城市治理标配，实现跨部门智能协同"),
        ("2028-2030年", "数字孪生城市全面普及，虚实融合治理成为常态"),
        ("长期趋势", "人机协同治理模式成熟，城市自主优化能力显著提升"),
        ("技术突破", "量子计算、脑机接口等前沿技术开始应用于智慧城市"),
        ("社会影响", "市民生活质量显著提升，城市可持续发展能力增强"),
        ("挑战应对", "数据隐私、算法公平、技术伦理等问题得到有效治理")
    ]
    
    for i, (period, desc) in enumerate(future_trends):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.text = period
        p.font.size = Pt(22)
        p.font.bold = True
        p.font.color.rgb = RGBColor(102, 0, 204)
        
        p = tf.add_paragraph()
        p.text = desc
        p.font.size = Pt(17)
        p.level = 1
        p.space_after = Pt(10)
    
    # 结束页
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    
    thank_box = slide.shapes.add_textbox(Inches(1), Inches(3), Inches(8), Inches(1.5))
    thank_frame = thank_box.text_frame
    thank_frame.text = "谢谢观看"
    thank_para = thank_frame.paragraphs[0]
    thank_para.font.size = Pt(48)
    thank_para.font.bold = True
    thank_para.font.color.rgb = RGBColor(0, 51, 102)
    thank_para.alignment = PP_ALIGN.CENTER
    
    contact_box = slide.shapes.add_textbox(Inches(1), Inches(5), Inches(8), Inches(0.6))
    contact_frame = contact_box.text_frame
    contact_frame.text = "2026年AI在智慧城市中的发展"
    contact_para = contact_frame.paragraphs[0]
    contact_para.font.size = Pt(20)
    contact_para.font.color.rgb = RGBColor(100, 100, 100)
    contact_para.alignment = PP_ALIGN.CENTER
    
    # 保存文件
    filename = "2026年AI在智慧城市中的发展.pptx"
    prs.save(filename)
    print(f"✅ PPT文件已生成：{filename}")
    print(f"📊 共包含 {len(prs.slides)} 页幻灯片")
    return filename

if __name__ == "__main__":
    create_presentation()
