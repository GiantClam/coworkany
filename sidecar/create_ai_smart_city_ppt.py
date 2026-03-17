from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor

# 创建演示文稿
prs = Presentation()
prs.slide_width = Inches(10)
prs.slide_height = Inches(7.5)

def add_title_slide(prs, title, subtitle):
    """添加标题页"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])  # 空白布局
    
    # 添加标题
    title_box = slide.shapes.add_textbox(Inches(1), Inches(2.5), Inches(8), Inches(1))
    title_frame = title_box.text_frame
    title_frame.text = title
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(44)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(0, 51, 102)
    title_para.alignment = PP_ALIGN.CENTER
    
    # 添加副标题
    subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(3.8), Inches(8), Inches(0.8))
    subtitle_frame = subtitle_box.text_frame
    subtitle_frame.text = subtitle
    subtitle_para = subtitle_frame.paragraphs[0]
    subtitle_para.font.size = Pt(24)
    subtitle_para.font.color.rgb = RGBColor(100, 100, 100)
    subtitle_para.alignment = PP_ALIGN.CENTER
    
    return slide

def add_content_slide(prs, title, content_list):
    """添加内容页"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    
    # 添加标题
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(9), Inches(0.8))
    title_frame = title_box.text_frame
    title_frame.text = title
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(32)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(0, 51, 102)
    
    # 添加内容
    content_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.5), Inches(8.5), Inches(5.5))
    text_frame = content_box.text_frame
    text_frame.word_wrap = True
    
    for i, item in enumerate(content_list):
        if i > 0:
            text_frame.add_paragraph()
        p = text_frame.paragraphs[i]
        p.text = item
        p.font.size = Pt(18)
        p.space_before = Pt(12)
        p.level = 0
        
    return slide

# 第1页：封面
add_title_slide(prs, "2026年AI在智慧城市中的发展", "人工智能驱动的城市未来")

# 第2页：目录
add_content_slide(prs, "目录", [
    "1. 智慧城市的定义和发展背景",
    "2. AI在智慧城市中的主要应用场景",
    "3. 2026年最新技术和趋势",
    "4. 成功案例分析",
    "5. 未来展望"
])

# 第3页：智慧城市的定义
add_content_slide(prs, "1. 智慧城市的定义和发展背景", [
    "• 定义：利用信息技术、物联网、大数据、云计算、人工智能等先进技术，面向城市治理、民生服务、产业发展、生态环保等核心场景的综合解决方案",
    "",
    "• 发展背景：",
    "  - 全球城市化进程加速，城市管理面临复杂挑战",
    "  - AI技术成熟度提升，为智慧城市提供核心驱动力",
    "  - 中国智慧城市IT解决方案市场规模突破1.2万亿元",
    "  - 城市全域数字化转型成为国家战略重点"
])

# 第4页：AI在智慧城市中的主要应用场景（1）
add_content_slide(prs, "2. AI在智慧城市中的主要应用场景（上）", [
    "• 智能交通管理",
    "  - AI交通系统减少拥堵25%",
    "  - 自动驾驶与智能信号灯协同",
    "  - 实时路况预测与优化",
    "",
    "• 智慧能源管理",
    "  - 虚拟电厂提供100MW备用电力",
    "  - AI优化能源分配，降低消耗",
    "  - 智能电网实时监控与调度"
])

# 第5页：AI在智慧城市中的主要应用场景（2）
add_content_slide(prs, "2. AI在智慧城市中的主要应用场景（下）", [
    "• 城市治理与公共安全",
    "  - AI视觉监控与异常检测",
    "  - 智能应急响应系统",
    "  - 公共数据流通与利用",
    "",
    "• 智慧民生服务",
    "  - IoT废物管理网络减少卡车运行90%",
    "  - AI政务服务（公文处理、审核自动化）",
    "  - 智能医疗与健康监测"
])

# 第6页：2026年最新技术和趋势（1）
add_content_slide(prs, "3. 2026年最新技术和趋势（上）", [
    "• Agentic AI（智能体AI）",
    "  - 到2027年，中国70%的城市将部署AI智能体",
    "  - 协同端到端工作流程，减轻工作量",
    "  - 自主决策与跨系统协作",
    "",
    "• 生成式AI（GenAI）",
    "  - 解锁数十年隐藏的政府数据",
    "  - 自动化文档处理与知识提取",
    "  - 精细调优的大语言模型（LLM）应用"
])

# 第7页：2026年最新技术和趋势（2）
add_content_slide(prs, "3. 2026年最新技术和趋势（下）", [
    "• 边缘智能与IoT融合",
    "  - 边缘计算降低延迟，提升响应速度",
    "  - IoT设备与AI模型本地化部署",
    "  - 5G网络支撑海量设备连接",
    "",
    "• 数字孪生城市",
    "  - 虚拟城市模型实时同步物理世界",
    "  - 在建设前测试城市决策",
    "  - 预测性维护与资源优化"
])

# 第8页：成功案例分析（1）
add_content_slide(prs, "4. 成功案例分析（上）", [
    "• 案例1：中国城市AI智能体部署",
    "  - 覆盖范围：预计2027年70%的中国城市",
    "  - 应用场景：交通调度、能源管理、应急响应",
    "  - 成效：工作流程自动化，效率提升30%+",
    "",
    "• 案例2：广州天河区智慧政务",
    "  - 京华信息智慧政务入选AI场景应用案例集",
    "  - AI技术应用于公文处理、审核、项目管理",
    "  - 交通热线服务智能化升级"
])

# 第9页：成功案例分析（2）
add_content_slide(prs, "4. 成功案例分析（下）", [
    "• 案例3：高雄智慧城市展（2026年3月）",
    "  - 展示5年智慧城市建设成果",
    "  - AI应用覆盖城市生活各面向",
    "  - 深入生活场景的AI成果展示",
    "",
    "• 案例4：Sunnyvale（硅谷核心城市）",
    "  - 市长Larry Klein：AI正在影响所有城市",
    "  - 智能许可审批与城市规划",
    "  - 公民服务与资产管理智能化"
])

# 第10页：未来展望（1）
add_content_slide(prs, "5. 未来展望（上）", [
    "• 技术演进方向",
    "  - AI从辅助工具向自主智能体演进",
    "  - 多模态AI融合（视觉、语音、文本）",
    "  - 具身智能在城市场景的广泛应用",
    "",
    "• 应用深化趋势",
    "  - 从单点应用向全域智能转变",
    "  - 跨部门数据打通与协同治理",
    "  - AI模型行业化、场景化定制"
])

# 第11页：未来展望（2）
add_content_slide(prs, "5. 未来展望（下）", [
    "• 挑战与机遇",
    "  - 隐私保护与数据安全",
    "  - 算法公平性与伦理问题",
    "  - 网络安全威胁应对",
    "  - 数字鸿沟与包容性发展",
    "",
    "• 发展目标",
    "  - 2027年：65%全球城市部署AI智能体",
    "  - 中国AI核心产业规模持续增长",
    "  - 智慧城市成为数字中国建设综合载体"
])

# 第12页：结束页
add_title_slide(prs, "谢谢观看", "AI赋能，智慧未来")

# 保存文件
prs.save('2026年AI在智慧城市中的发展.pptx')
print("✅ PPT创建成功！文件名：2026年AI在智慧城市中的发展.pptx")
