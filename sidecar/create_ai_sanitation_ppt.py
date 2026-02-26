#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI在环卫中的应用及2026年展望 - PPT生成脚本
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor

def create_presentation():
    # 创建演示文稿
    prs = Presentation()
    prs.slide_width = Inches(10)
    prs.slide_height = Inches(7.5)
    
    # 定义颜色方案
    PRIMARY_COLOR = RGBColor(0, 102, 204)  # 蓝色
    SECONDARY_COLOR = RGBColor(51, 51, 51)  # 深灰色
    ACCENT_COLOR = RGBColor(0, 176, 80)  # 绿色
    
    # 幻灯片1: 封面
    slide1 = prs.slides.add_slide(prs.slide_layouts[6])  # 空白布局
    
    # 添加标题
    title_box = slide1.shapes.add_textbox(Inches(1), Inches(2.5), Inches(8), Inches(1))
    title_frame = title_box.text_frame
    title_frame.text = "AI在环卫中的应用及2026年展望"
    title_para = title_frame.paragraphs[0]
    title_para.font.size = Pt(44)
    title_para.font.bold = True
    title_para.font.color.rgb = PRIMARY_COLOR
    title_para.alignment = PP_ALIGN.CENTER
    
    # 添加副标题
    subtitle_box = slide1.shapes.add_textbox(Inches(1), Inches(4), Inches(8), Inches(0.5))
    subtitle_frame = subtitle_box.text_frame
    subtitle_frame.text = "智慧环卫技术创新与产业发展"
    subtitle_para = subtitle_frame.paragraphs[0]
    subtitle_para.font.size = Pt(24)
    subtitle_para.font.color.rgb = SECONDARY_COLOR
    subtitle_para.alignment = PP_ALIGN.CENTER
    
    # 添加日期
    date_box = slide1.shapes.add_textbox(Inches(1), Inches(6.5), Inches(8), Inches(0.5))
    date_frame = date_box.text_frame
    date_frame.text = "2026年2月"
    date_para = date_frame.paragraphs[0]
    date_para.font.size = Pt(18)
    date_para.font.color.rgb = SECONDARY_COLOR
    date_para.alignment = PP_ALIGN.CENTER
    
    # 幻灯片2: 环卫行业定义和发展背景
    slide2 = prs.slides.add_slide(prs.slide_layouts[1])
    title2 = slide2.shapes.title
    title2.text = "环卫行业定义与发展背景"
    title2.text_frame.paragraphs[0].font.size = Pt(36)
    title2.text_frame.paragraphs[0].font.color.rgb = PRIMARY_COLOR
    
    content2 = slide2.placeholders[1]
    tf2 = content2.text_frame
    tf2.clear()
    
    # 行业定义
    p1 = tf2.paragraphs[0]
    p1.text = "行业定义"
    p1.font.size = Pt(24)
    p1.font.bold = True
    p1.font.color.rgb = ACCENT_COLOR
    p1.space_after = Pt(10)
    
    p2 = tf2.add_paragraph()
    p2.text = "环卫行业是城市公共服务的重要组成部分，涵盖道路清扫、垃圾收运、垃圾分类处理、公共设施维护等领域"
    p2.font.size = Pt(18)
    p2.level = 1
    p2.space_after = Pt(15)
    
    # 发展背景
    p3 = tf2.add_paragraph()
    p3.text = "发展背景"
    p3.font.size = Pt(24)
    p3.font.bold = True
    p3.font.color.rgb = ACCENT_COLOR
    p3.space_after = Pt(10)
    
    p4 = tf2.add_paragraph()
    p4.text = "市场规模：2023年智慧环卫产业规模达668.3亿元，复合年增长率14.94%"
    p4.font.size = Pt(18)
    p4.level = 1
    
    p5 = tf2.add_paragraph()
    p5.text = "政策驱动：国家推动城市精细化管理，多地发布智慧环卫发展规划"
    p5.font.size = Pt(18)
    p5.level = 1
    
    p6 = tf2.add_paragraph()
    p6.text = "技术升级：AI、5G、物联网等技术加速融合，推动行业智能化转型"
    p6.font.size = Pt(18)
    p6.level = 1
    
    p7 = tf2.add_paragraph()
    p7.text = "绿色转型：2025年新能源环卫车渗透率超15%，无人化设备快速普及"
    p7.font.size = Pt(18)
    p7.level = 1
    
    # 幻灯片3: AI应用场景 - 智能环卫车
    slide3 = prs.slides.add_slide(prs.slide_layouts[1])
    title3 = slide3.shapes.title
    title3.text = "AI应用场景一：智能环卫车"
    title3.text_frame.paragraphs[0].font.size = Pt(36)
    title3.text_frame.paragraphs[0].font.color.rgb = PRIMARY_COLOR
    
    content3 = slide3.placeholders[1]
    tf3 = content3.text_frame
    tf3.clear()
    
    p1 = tf3.paragraphs[0]
    p1.text = "无人驾驶清扫车"
    p1.font.size = Pt(22)
    p1.font.bold = True
    p1.font.color.rgb = ACCENT_COLOR
    
    p2 = tf3.add_paragraph()
    p2.text = "激光雷达+视觉融合算法，实现厘米级环境建模"
    p2.font.size = Pt(18)
    p2.level = 1
    
    p3 = tf3.add_paragraph()
    p3.text = "自动避障、贴边作业、行人避让全流程无人化"
    p3.font.size = Pt(18)
    p3.level = 1
    
    p4 = tf3.add_paragraph()
    p4.text = "上海仙途智能：全球30余城市部署300+台无人驾驶清扫车"
    p4.font.size = Pt(18)
    p4.level = 1
    p4.space_after = Pt(15)
    
    p5 = tf3.add_paragraph()
    p5.text = "AI智能识别与精准清扫"
    p5.font.size = Pt(22)
    p5.font.bold = True
    p5.font.color.rgb = ACCENT_COLOR
    
    p6 = tf3.add_paragraph()
    p6.text = "车载摄像头+AI算法精准识别路面垃圾、油污等污染物"
    p6.font.size = Pt(18)
    p6.level = 1
    
    p7 = tf3.add_paragraph()
    p7.text = "实现定向清扫，提升作业效率30%以上"
    p7.font.size = Pt(18)
    p7.level = 1
    
    p8 = tf3.add_paragraph()
    p8.text = "深圳龙田街道：部署24台小中型无人驾驶清扫车+12台智能环卫车"
    p8.font.size = Pt(18)
    p8.level = 1
    
    # 幻灯片4: AI应用场景 - 智能垃圾分拣
    slide4 = prs.slides.add_slide(prs.slide_layouts[1])
    title4 = slide4.shapes.title
    title4.text = "AI应用场景二：智能垃圾分拣"
    title4.text_frame.paragraphs[0].font.size = Pt(36)
    title4.text_frame.paragraphs[0].font.color.rgb = PRIMARY_COLOR
    
    content4 = slide4.placeholders[1]
    tf4 = content4.text_frame
    tf4.clear()
    
    p1 = tf4.paragraphs[0]
    p1.text = "AI机器人分拣系统"
    p1.font.size = Pt(22)
    p1.font.bold = True
    p1.font.color.rgb = ACCENT_COLOR
    
    p2 = tf4.add_paragraph()
    p2.text = "识别率高达95%，每分钟分拣70次（人工仅30-40次）"
    p2.font.size = Pt(18)
    p2.level = 1
    
    p3 = tf4.add_paragraph()
    p3.text = "最大抓取质量1.25千克，适用于多种垃圾类型"
    p3.font.size = Pt(18)
    p3.level = 1
    
    p4 = tf4.add_paragraph()
    p4.text = "群峰重工PEAKS-AI：建筑垃圾智能分拣成功落地"
    p4.font.size = Pt(18)
    p4.level = 1
    p4.space_after = Pt(15)
    
    p5 = tf4.add_paragraph()
    p5.text = "视觉AI回收分拣"
    p5.font.size = Pt(22)
    p5.font.bold = True
    p5.font.color.rgb = ACCENT_COLOR
    
    p6 = tf4.add_paragraph()
    p6.text = "深度学习算法识别塑料、纸张、金属等可回收物"
    p6.font.size = Pt(18)
    p6.level = 1
    
    p7 = tf4.add_paragraph()
    p7.text = "AMP Robotics：美国佛罗里达SSR工厂部署14台智能分拣机器人"
    p7.font.size = Pt(18)
    p7.level = 1
    
    p8 = tf4.add_paragraph()
    p8.text = "广州白云区：AI分拣实现源头减量率40%以上"
    p8.font.size = Pt(18)
    p8.level = 1
    
    # 幻灯片5: AI应用场景 - 智慧调度系统
    slide5 = prs.slides.add_slide(prs.slide_layouts[1])
    title5 = slide5.shapes.title
    title5.text = "AI应用场景三：智慧调度系统"
    title5.text_frame.paragraphs[0].font.size = Pt(36)
    title5.text_frame.paragraphs[0].font.color.rgb = PRIMARY_COLOR
    
    content5 = slide5.placeholders[1]
    tf5 = content5.text_frame
    tf5.clear()
    
    p1 = tf5.paragraphs[0]
    p1.text = "智慧环卫云平台"
    p1.font.size = Pt(22)
    p1.font.bold = True
    p1.font.color.rgb = ACCENT_COLOR
    
    p2 = tf5.add_paragraph()
    p2.text = "物联网+大数据：实时监控车辆作业状态、行驶轨迹、油耗维保"
    p2.font.size = Pt(18)
    p2.level = 1
    
    p3 = tf5.add_paragraph()
    p3.text = "AI路径优化：智能规划清扫路线，降低运营成本15-20%"
    p3.font.size = Pt(18)
    p3.level = 1
    
    p4 = tf5.add_paragraph()
    p4.text = "森鹏物联数字环卫平台：GPS定位+车载智能终端精准管控"
    p4.font.size = Pt(18)
    p4.level = 1
    p4.space_after = Pt(15)
    
    p5 = tf5.add_paragraph()
    p5.text = "智能感知与预测"
    p5.font.size = Pt(22)
    p5.font.bold = True
    p5.font.color.rgb = ACCENT_COLOR
    
    p6 = tf5.add_paragraph()
    p6.text = "智能垃圾桶：传感器实时监测填充水平，自动触发收运"
    p6.font.size = Pt(18)
    p6.level = 1
    
    p7 = tf5.add_paragraph()
    p7.text = "AI预测分析：基于历史数据预测垃圾产生量，优化收运计划"
    p7.font.size = Pt(18)
    p7.level = 1
    
    p8 = tf5.add_paragraph()
    p8.text = "视频监控+AI识别：4000+监控点位实现全流程数字化管理"
    p8.font.size = Pt(18)
    p8.level = 1
    
    # 幻灯片6: 2026年最新技术和趋势
    slide6 = prs.slides.add_slide(prs.slide_layouts[1])
    title6 = slide6.shapes.title
    title6.text = "2026年最新技术与趋势"
    title6.text_frame.paragraphs[0].font.size = Pt(36)
    title6.text_frame.paragraphs[0].font.color.rgb = PRIMARY_COLOR
    
    content6 = slide6.placeholders[1]
    tf6 = content6.text_frame
    tf6.clear()
    
    p1 = tf6.paragraphs[0]
    p1.text = "6G+AI全场景无人环卫"
    p1.font.size = Pt(22)
    p1.font.bold = True
    p1.font.color.rgb = ACCENT_COLOR
    
    p2 = tf6.add_paragraph()
    p2.text = "全球首个6G+AI全场景无人环卫应用落地"
    p2.font.size = Pt(18)
    p2.level = 1
    
    p3 = tf6.add_paragraph()
    p3.text = "融合机器视觉、深度学习、5G/6G通信技术"
    p3.font.size = Pt(18)
    p3.level = 1
    p3.space_after = Pt(12)
    
    p4 = tf6.add_paragraph()
    p4.text = "AI污染检测技术"
    p4.font.size = Pt(22)
    p4.font.bold = True
    p4.font.color.rgb = ACCENT_COLOR
    
    p5 = tf6.add_paragraph()
    p5.text = "Oshkosh展示AI驱动的垃圾车污染物检测技术（CES 2026）"
    p5.font.size = Pt(18)
    p5.level = 1
    
    p6 = tf6.add_paragraph()
    p6.text = "实时识别并拦截污染物，提升回收质量"
    p6.font.size = Pt(18)
    p6.level = 1
    p6.space_after = Pt(12)
    
    p7 = tf6.add_paragraph()
    p7.text = "商业化加速"
    p7.font.size = Pt(22)
    p7.font.bold = True
    p7.font.color.rgb = ACCENT_COLOR
    
    p8 = tf6.add_paragraph()
    p8.text = "无人驾驶环卫设备从示范运营迈入商业化爆发期"
    p8.font.size = Pt(18)
    p8.level = 1
    
    p9 = tf6.add_paragraph()
    p9.text = "2025年新增产能超千台，市场价值预计超3000亿元"
    p9.font.size = Pt(18)
    p9.level = 1
    
    # 幻灯片7: 成功案例分析
    slide7 = prs.slides.add_slide(prs.slide_layouts[1])
    title7 = slide7.shapes.title
    title7.text = "成功案例分析"
    title7.text_frame.paragraphs[0].font.size = Pt(36)
    title7.text_frame.paragraphs[0].font.color.rgb = PRIMARY_COLOR
    
    content7 = slide7.placeholders[1]
    tf7 = content7.text_frame
    tf7.clear()
    
    p1 = tf7.paragraphs[0]
    p1.text = "案例一：深圳龙田街道全域智能环卫"
    p1.font.size = Pt(20)
    p1.font.bold = True
    p1.font.color.rgb = ACCENT_COLOR
    
    p2 = tf7.add_paragraph()
    p2.text = "部署：24台无人驾驶清扫车+12台智能环卫车+1个指挥调度中心"
    p2.font.size = Pt(16)
    p2.level = 1
    
    p3 = tf7.add_paragraph()
    p3.text = "成效：构建「装备智能化+管理数字化」体系，覆盖道路与社区场景"
    p3.font.size = Pt(16)
    p3.level = 1
    p3.space_after = Pt(10)
    
    p4 = tf7.add_paragraph()
    p4.text = "案例二：广州白云区AI垃圾分拣"
    p4.font.size = Pt(20)
    p4.font.bold = True
    p4.font.color.rgb = ACCENT_COLOR
    
    p5 = tf7.add_paragraph()
    p5.text = "技术：AI智能分拣机械臂+图像识别算法"
    p5.font.size = Pt(16)
    p5.level = 1
    
    p6 = tf7.add_paragraph()
    p6.text = "成效：源头减量率达40%以上，率先全国引入AI分拣技术"
    p6.font.size = Pt(16)
    p6.level = 1
    p6.space_after = Pt(10)
    
    p7 = tf7.add_paragraph()
    p7.text = "案例三：重庆九爪智能建筑垃圾分拣"
    p7.font.size = Pt(20)
    p7.font.bold = True
    p7.font.color.rgb = ACCENT_COLOR
    
    p8 = tf7.add_paragraph()
    p8.text = "应用：建筑装修垃圾、混合生活垃圾专业型绿色分拣中心"
    p8.font.size = Pt(16)
    p8.level = 1
    
    p9 = tf7.add_paragraph()
    p9.text = "成效：精细化处理，转化为多种再生资源，赋能"无废城市"建设"
    p9.font.size = Pt(16)
    p9.level = 1
    
    # 幻灯片8: 未来展望
    slide8 = prs.slides.add_slide(prs.slide_layouts[1])
    title8 = slide8.shapes.title
    title8.text = "未来展望"
    title8.text_frame.paragraphs[0].font.size = Pt(36)
    title8.text_frame.paragraphs[0].font.color.rgb = PRIMARY_COLOR
    
    content8 = slide8.placeholders[1]
    tf8 = content8.text_frame
    tf8.clear()
    
    p1 = tf8.paragraphs[0]
    p1.text = "技术融合深化"
    p1.font.size = Pt(22)
    p1.font.bold = True
    p1.font.color.rgb = ACCENT_COLOR
    
    p2 = tf8.add_paragraph()
    p2.text = "AI+6G+物联网+大数据形成完整智慧环卫生态系统"
    p2.font.size = Pt(18)
    p2.level = 1
    
    p3 = tf8.add_paragraph()
    p3.text = "具身智能与机器人技术进一步提升自主作业能力"
    p3.font.size = Pt(18)
    p3.level = 1
    p3.space_after = Pt(12)
    
    p4 = tf8.add_paragraph()
    p4.text = "全域覆盖与规模化"
    p4.font.size = Pt(22)
    p4.font.bold = True
    p4.font.color.rgb = ACCENT_COLOR
    
    p5 = tf8.add_paragraph()
    p5.text = "从示范项目向全域覆盖转变，2026年多地实现100%智能化覆盖"
    p5.font.size = Pt(18)
    p5.level = 1
    
    p6 = tf8.add_paragraph()
    p6.text = "无人驾驶环卫车产能持续扩大，成本逐步下降"
    p6.font.size = Pt(18)
    p6.level = 1
    p6.space_after = Pt(12)
    
    p7 = tf8.add_paragraph()
    p7.text = "循环经济与碳中和"
    p7.font.size = Pt(22)
    p7.font.bold = True
    p7.font.color.rgb = ACCENT_COLOR
    
    p8 = tf8.add_paragraph()
    p8.text = "AI赋能垃圾资源化利用，推动"无废城市"建设"
    p8.font.size = Pt(18)
    p8.level = 1
    
    p9 = tf8.add_paragraph()
    p9.text = "新能源环卫车普及率持续提升，助力城市碳中和目标"
    p9.font.size = Pt(18)
    p9.level = 1
    
    # 幻灯片9: 结束页
    slide9 = prs.slides.add_slide(prs.slide_layouts[6])
    
    thanks_box = slide9.shapes.add_textbox(Inches(1), Inches(3), Inches(8), Inches(1))
    thanks_frame = thanks_box.text_frame
    thanks_frame.text = "谢谢观看"
    thanks_para = thanks_frame.paragraphs[0]
    thanks_para.font.size = Pt(48)
    thanks_para.font.bold = True
    thanks_para.font.color.rgb = PRIMARY_COLOR
    thanks_para.alignment = PP_ALIGN.CENTER
    
    contact_box = slide9.shapes.add_textbox(Inches(1), Inches(4.5), Inches(8), Inches(0.5))
    contact_frame = contact_box.text_frame
    contact_frame.text = "AI赋能智慧环卫，共创绿色未来"
    contact_para = contact_frame.paragraphs[0]
    contact_para.font.size = Pt(24)
    contact_para.font.color.rgb = SECONDARY_COLOR
    contact_para.alignment = PP_ALIGN.CENTER
    
    # 保存文件
    prs.save('AI在环卫中的应用及2026年展望.pptx')
    print("✅ PPT文件已成功创建：AI在环卫中的应用及2026年展望.pptx")
    print(f"📊 共生成 {len(prs.slides)} 张幻灯片")

if __name__ == "__main__":
    create_presentation()
