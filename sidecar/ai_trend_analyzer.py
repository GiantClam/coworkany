#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI技术趋势数据分析脚本
分析AI行业的投资、市场规模和增长趋势
"""

import json
import matplotlib.pyplot as plt
import numpy as np
from datetime import datetime
import pandas as pd

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False

class AITrendAnalyzer:
    """AI技术趋势分析器"""
    
    def __init__(self):
        """初始化数据"""
        self.data = {
            "融资数据": {
                "OpenAI": 122.0,  # 单位：十亿美元
                "Nebius": 4.34,
                "大科技AI投资": 630.0
            },
            "市场估值": {
                "OpenAI估值": 852.0,  # 单位：十亿美元
            },
            "芯片市场": {
                "Nvidia市场机会": 1000.0,  # 单位：十亿美元
                "Nvidia之前预测": 500.0
            },
            "电影行业": {
                "2019观影人次": 1.03,  # 单位：十亿人次
                "2025观影人次": 0.832
            }
        }
        
        self.colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8']
    
    def analyze_funding(self):
        """分析融资数据"""
        funding = self.data["融资数据"]
        
        print("=" * 60)
        print("AI行业融资分析")
        print("=" * 60)
        
        total_funding = sum(funding.values())
        print(f"\n总融资额: ${total_funding:.2f}B")
        
        for company, amount in funding.items():
            percentage = (amount / total_funding) * 100
            print(f"{company}: ${amount:.2f}B ({percentage:.1f}%)")
        
        # 计算OpenAI融资占比
        openai_ratio = funding["OpenAI"] / total_funding * 100
        print(f"\nOpenAI融资占总额的 {openai_ratio:.1f}%")
        
        return funding
    
    def analyze_market_growth(self):
        """分析市场增长"""
        chip_market = self.data["芯片市场"]
        
        print("\n" + "=" * 60)
        print("AI芯片市场增长分析")
        print("=" * 60)
        
        growth = chip_market["Nvidia市场机会"] - chip_market["Nvidia之前预测"]
        growth_rate = (growth / chip_market["Nvidia之前预测"]) * 100
        
        print(f"\nNvidia市场机会增长:")
        print(f"  之前预测: ${chip_market['Nvidia之前预测']:.0f}B")
        print(f"  最新预测: ${chip_market['Nvidia市场机会']:.0f}B")
        print(f"  增长额: ${growth:.0f}B")
        print(f"  增长率: {growth_rate:.1f}%")
        
        return chip_market
    
    def analyze_industry_impact(self):
        """分析行业影响"""
        movie = self.data["电影行业"]
        
        print("\n" + "=" * 60)
        print("AI对电影行业的影响分析")
        print("=" * 60)
        
        decline = movie["2019观影人次"] - movie["2025观影人次"]
        decline_rate = (decline / movie["2019观影人次"]) * 100
        
        print(f"\n观影人次变化:")
        print(f"  2019年: {movie['2019观影人次']:.2f}B人次")
        print(f"  2025年: {movie['2025观影人次']:.2f}B人次")
        print(f"  下降: {decline:.2f}B人次 ({decline_rate:.1f}%)")
        print(f"\n分析: 观影人次下降推动印度电影业大规模采用AI技术")
        
        return movie
    
    def calculate_roi_metrics(self):
        """计算投资回报指标"""
        print("\n" + "=" * 60)
        print("投资回报率分析")
        print("=" * 60)
        
        openai_funding = self.data["融资数据"]["OpenAI"]
        openai_valuation = self.data["市场估值"]["OpenAI估值"]
        
        valuation_multiple = openai_valuation / openai_funding
        
        print(f"\nOpenAI投资指标:")
        print(f"  融资额: ${openai_funding:.2f}B")
        print(f"  估值: ${openai_valuation:.2f}B")
        print(f"  估值倍数: {valuation_multiple:.2f}x")
        
        # 计算大科技投资效率
        total_tech_investment = self.data["融资数据"]["大科技AI投资"]
        market_opportunity = self.data["芯片市场"]["Nvidia市场机会"]
        
        print(f"\n行业投资效率:")
        print(f"  大科技AI投资: ${total_tech_investment:.2f}B")
        print(f"  芯片市场机会: ${market_opportunity:.2f}B")
        print(f"  市场机会/投资比: {market_opportunity/total_tech_investment:.2f}x")
    
    def visualize_funding(self, funding_data):
        """可视化融资数据"""
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        # 饼图
        labels = list(funding_data.keys())
        sizes = list(funding_data.values())
        
        ax1.pie(sizes, labels=labels, autopct='%1.1f%%', startangle=90, colors=self.colors)
        ax1.set_title('AI行业融资分布', fontsize=14, fontweight='bold')
        
        # 柱状图
        ax2.bar(range(len(labels)), sizes, color=self.colors)
        ax2.set_xlabel('公司/类别', fontsize=12)
        ax2.set_ylabel('融资额 (十亿美元)', fontsize=12)
        ax2.set_title('AI融资额对比', fontsize=14, fontweight='bold')
        ax2.set_xticks(range(len(labels)))
        ax2.set_xticklabels(labels, rotation=15, ha='right')
        
        # 添加数值标签
        for i, v in enumerate(sizes):
            ax2.text(i, v + 10, f'${v:.1f}B', ha='center', va='bottom', fontweight='bold')
        
        plt.tight_layout()
        plt.savefig('ai_funding_analysis.png', dpi=300, bbox_inches='tight')
        print("\n✓ 融资分析图表已保存: ai_funding_analysis.png")
    
    def visualize_market_growth(self, chip_data):
        """可视化市场增长"""
        fig, ax = plt.subplots(figsize=(10, 6))
        
        categories = ['之前预测', '最新预测']
        values = [chip_data['Nvidia之前预测'], chip_data['Nvidia市场机会']]
        
        bars = ax.bar(categories, values, color=['#FFA07A', '#FF6B6B'], width=0.5)
        
        ax.set_ylabel('市场规模 (十亿美元)', fontsize=12)
        ax.set_title('Nvidia AI芯片市场机会增长', fontsize=14, fontweight='bold')
        ax.set_ylim(0, max(values) * 1.2)
        
        # 添加数值标签
        for bar, value in zip(bars, values):
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'${value:.0f}B',
                   ha='center', va='bottom', fontsize=12, fontweight='bold')
        
        # 添加增长箭头和百分比
        growth_rate = ((values[1] - values[0]) / values[0]) * 100
        ax.annotate('', xy=(1, values[1]), xytext=(0, values[0]),
                   arrowprops=dict(arrowstyle='->', lw=2, color='green'))
        ax.text(0.5, (values[0] + values[1])/2, f'+{growth_rate:.0f}%',
               ha='center', fontsize=14, fontweight='bold', color='green')
        
        plt.tight_layout()
        plt.savefig('ai_market_growth.png', dpi=300, bbox_inches='tight')
        print("✓ 市场增长图表已保存: ai_market_growth.png")
    
    def visualize_industry_trend(self, movie_data):
        """可视化行业趋势"""
        fig, ax = plt.subplots(figsize=(10, 6))
        
        years = ['2019', '2025']
        values = [movie_data['2019观影人次'], movie_data['2025观影人次']]
        
        ax.plot(years, values, marker='o', linewidth=3, markersize=12, color='#4ECDC4')
        ax.fill_between(range(len(years)), values, alpha=0.3, color='#4ECDC4')
        
        ax.set_xlabel('年份', fontsize=12)
        ax.set_ylabel('观影人次 (十亿)', fontsize=12)
        ax.set_title('印度电影业观影人次趋势 (AI应用背景)', fontsize=14, fontweight='bold')
        ax.grid(True, alpha=0.3)
        
        # 添加数值标签
        for i, (year, value) in enumerate(zip(years, values)):
            ax.text(i, value + 0.05, f'{value:.2f}B',
                   ha='center', va='bottom', fontsize=11, fontweight='bold')
        
        # 添加下降标注
        decline_rate = ((values[0] - values[1]) / values[0]) * 100
        ax.text(0.5, (values[0] + values[1])/2 - 0.05, f'↓ {decline_rate:.1f}%',
               ha='center', fontsize=12, fontweight='bold', color='red')
        
        plt.tight_layout()
        plt.savefig('ai_industry_impact.png', dpi=300, bbox_inches='tight')
        print("✓ 行业影响图表已保存: ai_industry_impact.png")
    
    def export_summary_report(self):
        """导出汇总报告"""
        report = {
            "报告生成时间": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "数据摘要": {
                "总融资额": f"${sum(self.data['融资数据'].values()):.2f}B",
                "OpenAI估值": f"${self.data['市场估值']['OpenAI估值']:.2f}B",
                "Nvidia市场机会": f"${self.data['芯片市场']['Nvidia市场机会']:.0f}B",
                "芯片市场增长率": f"{((self.data['芯片市场']['Nvidia市场机会'] - self.data['芯片市场']['Nvidia之前预测']) / self.data['芯片市场']['Nvidia之前预测'] * 100):.1f}%"
            },
            "关键发现": [
                "OpenAI完成史上最大融资轮之一(122B美元)",
                "AI芯片市场机会翻倍至1万亿美元",
                "大科技公司AI投资达630亿美元",
                "印度电影业观影人次下降19.2%，推动AI应用",
                "AI工作负载从训练转向推理和代理任务"
            ],
            "原始数据": self.data
        }
        
        with open('ai_trend_analysis_report.json', 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        print("\n✓ JSON报告已导出: ai_trend_analysis_report.json")
        
        # 导出CSV格式
        df_funding = pd.DataFrame(list(self.data['融资数据'].items()), 
                                  columns=['公司/类别', '融资额(十亿美元)'])
        df_funding.to_csv('ai_funding_data.csv', index=False, encoding='utf-8-sig')
        print("✓ CSV数据已导出: ai_funding_data.csv")
    
    def run_full_analysis(self):
        """运行完整分析"""
        print("\n" + "=" * 60)
        print("AI技术趋势数据分析")
        print("=" * 60)
        print(f"分析时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 执行各项分析
        funding_data = self.analyze_funding()
        chip_data = self.analyze_market_growth()
        movie_data = self.analyze_industry_impact()
        self.calculate_roi_metrics()
        
        # 生成可视化
        print("\n" + "=" * 60)
        print("生成可视化图表")
        print("=" * 60)
        self.visualize_funding(funding_data)
        self.visualize_market_growth(chip_data)
        self.visualize_industry_trend(movie_data)
        
        # 导出报告
        print("\n" + "=" * 60)
        print("导出分析报告")
        print("=" * 60)
        self.export_summary_report()
        
        print("\n" + "=" * 60)
        print("分析完成！")
        print("=" * 60)
        print("\n生成的文件:")
        print("  1. ai_funding_analysis.png - 融资分析图表")
        print("  2. ai_market_growth.png - 市场增长图表")
        print("  3. ai_industry_impact.png - 行业影响图表")
        print("  4. ai_trend_analysis_report.json - JSON格式报告")
        print("  5. ai_funding_data.csv - CSV格式数据")


def main():
    """主函数"""
    analyzer = AITrendAnalyzer()
    analyzer.run_full_analysis()


if __name__ == "__main__":
    main()
