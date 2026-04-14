#!/usr/bin/env python3
"""
AI技术趋势数据分析脚本
分析AI行业投资、市场份额和技术发展趋势
"""

import json
import matplotlib.pyplot as plt
import pandas as pd
from datetime import datetime
import numpy as np

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False


class AITrendsAnalyzer:
    """AI趋势分析器"""
    
    def __init__(self):
        self.data = self._load_sample_data()
    
    def _load_sample_data(self):
        """加载示例数据（基于研究报告）"""
        return {
            'investments': {
                'OpenAI': 122,  # billion USD
                'Big Tech AI Infrastructure': 630,
                'Total Market': 850
            },
            'market_share': {
                'Open Source Models': 45,
                'Closed Source Models': 35,
                'Hybrid Solutions': 20
            },
            'regional_dominance': {
                'US': 40,
                'China': 35,
                'Europe': 15,
                'Others': 10
            },
            'adoption_by_sector': {
                'Manufacturing': 25,
                'Logistics': 20,
                'Robotics': 18,
                'Healthcare': 15,
                'Finance': 12,
                'Others': 10
            },
            'us_startups_using_chinese_models': 80  # percentage
        }
    
    def analyze_investments(self):
        """分析投资数据"""
        print("\n=== AI投资分析 ===")
        investments = self.data['investments']
        
        total = investments['Total Market']
        openai_share = (investments['OpenAI'] / total) * 100
        bigtech_share = (investments['Big Tech AI Infrastructure'] / total) * 100
        
        print(f"OpenAI融资: ${investments['OpenAI']}B")
        print(f"大科技公司AI基础设施投资: ${investments['Big Tech AI Infrastructure']}B")
        print(f"总市场规模: ${total}B")
        print(f"OpenAI占比: {openai_share:.1f}%")
        print(f"大科技公司占比: {bigtech_share:.1f}%")
        
        return investments
    
    def analyze_market_share(self):
        """分析市场份额"""
        print("\n=== AI模型市场份额分析 ===")
        market_share = self.data['market_share']
        
        for model_type, share in market_share.items():
            print(f"{model_type}: {share}%")
        
        return market_share
    
    def analyze_regional_trends(self):
        """分析地区趋势"""
        print("\n=== 地区AI主导地位分析 ===")
        regional = self.data['regional_dominance']
        
        for region, share in regional.items():
            print(f"{region}: {share}%")
        
        # 特别关注
        us_startups = self.data['us_startups_using_chinese_models']
        print(f"\n关键发现: {us_startups}% 美国初创公司使用中国开源模型")
        
        return regional
    
    def plot_investment_breakdown(self):
        """绘制投资分布图"""
        investments = self.data['investments']
        
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
        
        # 饼图
        labels = list(investments.keys())
        sizes = list(investments.values())
        colors = ['#ff9999', '#66b3ff', '#99ff99']
        explode = (0.1, 0.05, 0)
        
        ax1.pie(sizes, explode=explode, labels=labels, colors=colors,
                autopct='%1.1f%%', shadow=True, startangle=90)
        ax1.set_title('AI Investment Distribution (Billion USD)', fontsize=14, pad=20)
        
        # 柱状图
        ax2.bar(labels, sizes, color=colors, alpha=0.7)
        ax2.set_ylabel('Investment (Billion USD)', fontsize=12)
        ax2.set_title('AI Investment Comparison', fontsize=14, pad=20)
        ax2.tick_params(axis='x', rotation=15)
        
        plt.tight_layout()
        plt.savefig('ai_investments.png', dpi=300, bbox_inches='tight')
        print("\n图表已保存: ai_investments.png")
        plt.close()
    
    def plot_market_share(self):
        """绘制市场份额图"""
        market_share = self.data['market_share']
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        labels = list(market_share.keys())
        sizes = list(market_share.values())
        colors = ['#ff6b6b', '#4ecdc4', '#45b7d1']
        
        wedges, texts, autotexts = ax.pie(sizes, labels=labels, colors=colors,
                                            autopct='%1.1f%%', startangle=45)
        
        ax.set_title('AI Model Market Share 2024-2025', fontsize=16, pad=20)
        
        plt.setp(autotexts, size=10, weight="bold")
        plt.tight_layout()
        plt.savefig('ai_market_share.png', dpi=300, bbox_inches='tight')
        print("图表已保存: ai_market_share.png")
        plt.close()
    
    def plot_regional_dominance(self):
        """绘制地区主导地位图"""
        regional = self.data['regional_dominance']
        
        fig, ax = plt.subplots(figsize=(10, 6))
        
        regions = list(regional.keys())
        shares = list(regional.values())
        colors = ['#e74c3c', '#f39c12', '#3498db', '#95a5a6']
        
        bars = ax.barh(regions, shares, color=colors, alpha=0.8)
        
        ax.set_xlabel('Market Share (%)', fontsize=12)
        ax.set_title('Regional AI Dominance 2024-2025', fontsize=16, pad=20)
        ax.set_xlim(0, 50)
        
        # 添加数值标签
        for i, bar in enumerate(bars):
            width = bar.get_width()
            ax.text(width + 1, bar.get_y() + bar.get_height()/2,
                   f'{shares[i]}%', ha='left', va='center', fontsize=10)
        
        plt.tight_layout()
        plt.savefig('ai_regional_dominance.png', dpi=300, bbox_inches='tight')
        print("图表已保存: ai_regional_dominance.png")
        plt.close()
    
    def plot_sector_adoption(self):
        """绘制行业采用率图"""
        adoption = self.data['adoption_by_sector']
        
        fig, ax = plt.subplots(figsize=(12, 6))
        
        sectors = list(adoption.keys())
        percentages = list(adoption.values())
        colors = plt.cm.viridis(np.linspace(0, 1, len(sectors)))
        
        bars = ax.bar(sectors, percentages, color=colors, alpha=0.8)
        
        ax.set_ylabel('Adoption Rate (%)', fontsize=12)
        ax.set_title('AI Adoption by Sector 2024-2025', fontsize=16, pad=20)
        ax.tick_params(axis='x', rotation=45)
        ax.set_ylim(0, 30)
        
        # 添加数值标签
        for bar in bars:
            height = bar.get_height()
            ax.text(bar.get_x() + bar.get_width()/2., height,
                   f'{height}%', ha='center', va='bottom', fontsize=9)
        
        plt.tight_layout()
        plt.savefig('ai_sector_adoption.png', dpi=300, bbox_inches='tight')
        print("图表已保存: ai_sector_adoption.png")
        plt.close()
    
    def generate_summary_report(self):
        """生成汇总报告"""
        print("\n" + "="*60)
        print("AI技术趋势分析报告")
        print("="*60)
        
        self.analyze_investments()
        self.analyze_market_share()
        self.analyze_regional_trends()
        
        print("\n=== 关键洞察 ===")
        print("1. 开源AI模型市场份额达到45%，超过闭源模型")
        print("2. 中国在AI领域的影响力快速增长，占全球35%")
        print("3. 80%的美国初创公司依赖中国开源模型")
        print("4. 制造业和物流是AI应用的主要领域")
        print("5. AI投资总额超过$850B，但存在泡沫风险")
        
        print("\n=== 风险提示 ===")
        print("⚠️  投资回报率不确定性")
        print("⚠️  技术主权和供应链风险")
        print("⚠️  地缘政治竞争加剧")
        
        print("\n" + "="*60)
    
    def export_data(self, filename='ai_trends_data.json'):
        """导出数据为JSON"""
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        print(f"\n数据已导出: {filename}")
    
    def run_full_analysis(self):
        """运行完整分析"""
        print("开始AI技术趋势分析...")
        print(f"分析时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 生成文本报告
        self.generate_summary_report()
        
        # 生成图表
        print("\n生成可视化图表...")
        self.plot_investment_breakdown()
        self.plot_market_share()
        self.plot_regional_dominance()
        self.plot_sector_adoption()
        
        # 导出数据
        self.export_data()
        
        print("\n✅ 分析完成！")
        print("生成的文件:")
        print("  - ai_investments.png")
        print("  - ai_market_share.png")
        print("  - ai_regional_dominance.png")
        print("  - ai_sector_adoption.png")
        print("  - ai_trends_data.json")


def main():
    """主函数"""
    analyzer = AITrendsAnalyzer()
    analyzer.run_full_analysis()


if __name__ == '__main__':
    main()
