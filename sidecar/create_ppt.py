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
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    
    background = slide.background
    fill = background.fill
    fill.solid()
    fill.fore_color.rgb = RGBColor(0, 102, 204)
    
    title_box = slide.shapes.add_textbox(Inches(1), Inches(2.5), Inches(8), Inches(1))
    title_frame = title_box.text_frame
    title_frame.text = title
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(44)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(255, 255, 255)
    title_para.alignment = PP_ALIGN.CENTER
    
    subtitle_box = slide.shapes.add_textbox(Inches(1), Inches(4), Inches(8), Inches(0.8))
    subtitle_frame = subtitle_box.text_frame
    subtitle_frame.text = subtitle
    subtitle_para = subtitle_frame.paragraphs[0]
    subtitle_para.font.size = Pt(24)
    subtitle_para.font.color.rgb = RGBColor(255, 255, 255)
    subtitle_para.alignment = PP_ALIGN.CENTER

def add_content_slide(prs, title, content_list):
    """添加内容页"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(9), Inches(0.8))
    title_frame = title_box.text_frame
    title_frame.text = title
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(32)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(0, 102, 204)
    
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

def add_two_column_slide(prs, title, left_content, right_content):
    """添加两栏内容页"""
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    
    title_box = slide.shapes.add_textbox(Inches(0.5), Inches(0.5), Inches(9), Inches(0.8))
    title_frame = title_box.text_frame
    title_frame.text = title
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(32)
    title_para.font.bold = True
    title_para.font.color.rgb = RGBColor(0, 102, 204)
    
    left_box = slide.shapes.add_textbox(Inches(0.5), Inches(1.5), Inches(4.5), Inches(5.5))
    left_frame = left_box.text_frame
    left_frame.word_wrap = True
    for i, item in enumerate(left_content):
        if i > 0:
            left_frame.add_paragraph()
        p = left_frame.paragraphs[i]
        p.text = item
        p.font.size = Pt(16)
        p.space_before = Pt(10)
    
    right_box = slide.shapes.add_textbox(Inches(5.2), Inches(1.5), Inches(4.5), Inches(5.5))
    right_frame = right_box.text_frame
    right_frame.word_wrap = True
    for i, item in enumerate(right_content):
        if i > 0:
            right_frame.add_paragraph()
        p = right_frame.paragraphs[i]
        p.text = item
        p.font.size = Pt(16)
        p.space_before = Pt(10)

# 1. 标题页
add_title_slide(prs, 
    "AI在环卫中的应用及2026年展望",
    "智慧环卫：从人海战术到智能赋能")

# 2. 环卫行业定义和发展背景
add_content_slide(prs, 
    "一、环卫行业的定义与发展背景",
    [
        "📌 环卫行业定义",
        "• 城市环境卫生管理的核心产业，涵盖垃圾收集、清扫保洁、垃圾处理等",
        "• 传统环卫依赖人力密集型作业，效率低、成本高、安全风险大",
        "",
        "🔄 行业转型背景",
        "• 数字化转型：物联网、大数据、云计算技术融入环卫管理",
        "• 智能化升级：作业机械化、装备新能源化、运营管理智慧化",
        "• 政策驱动：智慧城市建设、新质生产力发展、绿色低碳目标",
        "• 劳动力挑战：环卫工人老龄化、招工难、作业环境恶劣"
    ])

# 3. AI在环卫中的主要应用场景
add_two_column_slide(prs,
    "二、AI在环卫中的主要应用场景",
    [
        "🚗 无人驾驶环卫车",
        "• L4级自动驾驶清扫车、洒水车",
        "• AI多传感器融合技术",
        "• 厘米级环境建模",
        "• 精准避障、5厘米贴边清扫",
        "• 自主规划路线、自动回仓充电",
        "",
        "🤖 智能环卫机器人",
        "• 自主巡逻垃圾分拣机器人",
        "• 识别20+种垃圾类型",
        "• 从烟头到可乐瓶精准抓取",
        "• 适应复杂工作环境"
    ],
    [
        "♻️ AI垃圾分拣系统",
        "• 视觉识别技术快速分类",
        "• 识别塑料、金属、纸张等材质",
        "• 根据形状、颜色精准分拣",
        "• 提升回收效率，变废为宝",
        "",
        "📊 智慧调度管理平台",
        "• 大数据分析预测垃圾产生量",
        "• AI优化收运路线和频次",
        "• 实时监控人员、车辆、设施",
        "• 减少20%环卫车空驶率",
        "• 全流程数字化管理"
    ])

# 4. 2026年最新技术和趋势
add_content_slide(prs,
    "三、2026年最新技术与趋势",
    [
        "🚀 技术突破",
        "• AI从实验阶段进入规模化执行阶段",
        "• 多模态传感器融合：激光雷达+视觉+毫米波雷达",
        "• 高精度定位与实时建图（SLAM技术）",
        "• 深度学习算法实现复杂场景识别",
        "",
        "📈 市场趋势",
        "• 全球AI清洁市场：2026年37亿美元 → 2036年94亿美元（CAGR 12.45%）",
        "• 无人驾驶环卫车从封闭园区走向城市开放道路",
        "• 全场景立体化无人环卫：地面车辆+无人机巡查+智能调度",
        "• 人形机器人开始配合无人驾驶完成辅助作业",
        "",
        "🌱 发展方向",
        "• 人工智能+行动深入实施，AI与环卫深度融合",
        "• 新能源化：电动环卫车辆普及，降低碳排放",
        "• 数字孪生技术：3D可视化城市环卫管理"
    ])

# 5. 成功案例分析
add_content_slide(prs,
    "四、成功案例分析",
    [
        "🏙️ 成都春熙路步行街",
        "• 云创智行无人环卫车队",
        "• 每日在70万人次密集人流中安全作业",
        "• AI算法实现精准避障与高效清扫",
        "",
        "🏭 广州嘉禾新科压缩站",
        "• 九爪智能立体式AI分拣系统",
        "• 全国首个智能环卫综合体",
        "• 前沿AI分选技术+多模态传感装备",
        "",
        "🌆 杭州智慧环卫",
        "• AI调度系统优化收运路线",
        "• 减少20%环卫车空驶率",
        "• 显著降低运营成本",
        "",
        "🏜️ 新疆阿克苏",
        "• 云创智行三款无人清扫车型组合",
        "• YC-200系列覆盖园区到城市道路",
        "• 高精度定位在楼宇广场间灵活穿行"
    ])

# 6. 未来展望
add_content_slide(prs,
    "五、未来展望",
    [
        "🎯 短期目标（2026-2027）",
        "• 无人驾驶环卫车规模化商用，覆盖主要城市主干道",
        "• AI智能终端和智能体普及率超过70%",
        "• 环卫行业劳动力结构优化，从体力劳动转向技术管理",
        "",
        "🔮 中长期愿景（2028-2030）",
        "• 全场景立体化无人环卫成为标配",
        "• 人形机器人大规模应用于垃圾分拣和辅助作业",
        "• 城市环卫实现秒级响应智能管理",
        "• 环卫数据与智慧城市大脑深度融合",
        "",
        "💡 核心价值",
        "• 提升效率：24小时不间断作业，效率提升50%以上",
        "• 降低成本：减少人力依赖，运营成本下降30%",
        "• 保障安全：减少环卫工人高危作业，降低事故率",
        "• 绿色环保：新能源车辆普及，助力碳中和目标"
    ])

# 7. 结束页
add_title_slide(prs,
    "谢谢观看",
    "AI赋能环卫，共创智慧城市未来")

# 保存文件
prs.save('AI在环卫中的应用及2026年展望.pptx')
print("✅ PPT创建成功！文件名：AI在环卫中的应用及2026年展望.pptx")
