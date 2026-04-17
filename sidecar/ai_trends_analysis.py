#!/usr/bin/env python3
"""
AI技术趋势数据分析脚本
分析AI技术趋势的成熟度、影响力、投资热度和风险等级
"""

import json
import matplotlib.pyplot as plt
import numpy as np
from datetime import datetime

# 设置中文字体支持
plt.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'SimHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False


class AITrendAnalyzer:
    """AI技术趋势分析器"""
    
    def __init__(self):
        self.trends_data = {
            '智能体AI': {
                '成熟度': 2,  # 1-5分，1=早期，5=成熟
                '影响力': 5,
                '投资热度': 5,
                '风险等级': 3
            },
            '开源模型': {
                '成熟度': 3,
                '影响力': 5,
                '投资热度': 4,
                '风险等级': 2
            },
            '物理AI': {
                '成熟度': 2,
                '影响力': 4,
                '投资热度': 4,
                '风险等级': 4
            },
            'AI芯片': {
                '成熟度': 4,
                '影响力': 5,
                '投资热度': 5,
                '风险等级': 3
            },
            'AI代理框架': {
                '成熟度': 2,
                '影响力': 3,
                '投资热度': 4,
                '风险等级': 3
            },
            'AI安全': {
                '成熟度': 3,
                '影响力': 4,
                '投资热度': 3,
                '风险等级': 4
            }
        }
        
        self.market_data = {
            '中国半导体市场份额': {
                '2024': 37,
                '2028预测': 42
            },
            '美国AI初创公司使用中国开源模型比例': 80
        }
    
    def calculate_trend_score(self, trend_name):
        """计算综合趋势得分"""
        data = self.trends_data[trend_name]
        # 综合得分 = (成熟度 + 影响力 + 投资热度) / 3 - 风险等级 * 0.2
        score = (data['成熟度'] + data['影响力'] + data['投资热度']) / 3 - data['风险等级'] * 0.2
        return round(score, 2)
    
    def rank_trends(self):
        """对技术趋势进行排名"""
        scores = {}
        for trend in self.trends_data.keys():
            scores[trend] = self.calculate_trend_score(trend)
        
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return ranked
    
    def generate_radar_chart(self, trend_name):
        """生成雷达图"""
        data = self.trends_data[trend_name]
        categories = list(data.keys())
        values = list(data.values())
        
        # 计算角度
        angles = np.linspace(0, 2 * np.pi, len(categories), endpoint=False).tolist()
        values += values[:1]
        angles += angles[:1]
        
        fig, ax = plt.subplots(figsize=(8, 8), subplot_kw=dict(projection='polar'))
        ax.plot(angles, values, 'o-', linewidth=2, label=trend_name)
        ax.fill(angles, values, alpha=0.25)
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(categories)
        ax.set_ylim(0, 5)
        ax.set_title(f'{trend_name} - 技术特征分析', size=16, pad=20)
        ax.legend(loc='upper right', bbox_to_anchor=(1.3, 1.1))
        ax.grid(True)
        
        plt.tight_layout()
        plt.savefig(f'{trend_name}_radar.png', dpi=300, bbox_inches='tight')
        print(f"✓ 已生成雷达图: {trend_name}_radar.png")
        plt.close()
    
    def generate_comparison_chart(self):
        """生成趋势对比柱状图"""
        trends = list(self.trends_data.keys())
        metrics = ['成熟度', '影响力', '投资热度', '风险等级']
        
        fig, axes = plt.subplots(2, 2, figsize=(14, 10))
        fig.suptitle('AI技术趋势多维度对比分析', fontsize=16, fontweight='bold')
        
        for idx, metric in enumerate(metrics):
            ax = axes[idx // 2, idx % 2]
            values = [self.trends_data[trend][metric] for trend in trends]
            colors = plt.cm.viridis(np.linspace(0, 1, len(trends)))
            
            bars = ax.barh(trends, values, color=colors)
            ax.set_xlabel('评分 (1-5)', fontsize=10)
            ax.set_title(metric, fontsize=12, fontweight='bold')
            ax.set_xlim(0, 5.5)
            
            # 添加数值标签
            for bar in bars:
                width = bar.get_width()
                ax.text(width + 0.1, bar.get_y() + bar.get_height()/2, 
                       f'{width:.1f}', ha='left', va='center', fontsize=9)
        
        plt.tight_layout()
        plt.savefig('ai_trends_comparison.png', dpi=300, bbox_inches='tight')
        print("✓ 已生成对比图: ai_trends_comparison.png")
        plt.close()
    
    def generate_ranking_chart(self):
        """生成综合排名图"""
        ranked = self.rank_trends()
        trends = [item[0] for item in ranked]
        scores = [item[1] for item in ranked]
        
        fig, ax = plt.subplots(figsize=(10, 6))
        colors = plt.cm.RdYlGn(np.linspace(0.3, 0.9, len(trends)))
        bars = ax.barh(trends, scores, color=colors)
        
        ax.set_xlabel('综合得分', fontsize=12)
        ax.set_title('AI技术趋势综合排名', fontsize=14, fontweight='bold')
        ax.set_xlim(0, max(scores) + 0.5)
        
        # 添加数值标签
        for bar in bars:
            width = bar.get_width()
            ax.text(width + 0.05, bar.get_y() + bar.get_height()/2, 
                   f'{width:.2f}', ha='left', va='center', fontsize=10, fontweight='bold')
        
        plt.tight_layout()
        plt.savefig('ai_trends_ranking.png', dpi=300, bbox_inches='tight')
        print("✓ 已生成排名图: ai_trends_ranking.png")
        plt.close()
    
    def generate_market_chart(self):
        """生成市场数据图表"""
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))
        
        # 中国半导体市场份额趋势
        years = ['2024', '2028预测']
        shares = [self.market_data['中国半导体市场份额'][year] for year in years]
        ax1.plot(years, shares, marker='o', linewidth=3, markersize=10, color='#2E86AB')
        ax1.fill_between(range(len(years)), shares, alpha=0.3, color='#2E86AB')
        ax1.set_ylabel('市场份额 (%)', fontsize=11)
        ax1.set_title('中国半导体市场份额预测', fontsize=12, fontweight='bold')
        ax1.grid(True, alpha=0.3)
        for i, (year, share) in enumerate(zip(years, shares)):
            ax1.text(i, share + 0.5, f'{share}%', ha='center', fontsize=11, fontweight='bold')
        
        # 开源模型使用情况
        labels = ['使用中国\n开源模型', '其他']
        sizes = [self.market_data['美国AI初创公司使用中国开源模型比例'], 20]
        colors = ['#A23B72', '#F18F01']
        explode = (0.1, 0)
        
        ax2.pie(sizes, explode=explode, labels=labels, colors=colors, autopct='%1.0f%%',
               shadow=True, startangle=90, textprops={'fontsize': 11, 'fontweight': 'bold'})
        ax2.set_title('美国AI初创公司模型使用情况', fontsize=12, fontweight='bold')
        
        plt.tight_layout()
        plt.savefig('ai_market_data.png', dpi=300, bbox_inches='tight')
        print("✓ 已生成市场数据图: ai_market_data.png")
        plt.close()
    
    def export_data(self):
        """导出分析数据为JSON"""
        ranked = self.rank_trends()
        
        export_data = {
            '生成时间': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            '技术趋势详细数据': self.trends_data,
            '市场数据': self.market_data,
            '综合排名': [{'趋势': trend, '得分': score} for trend, score in ranked]
        }
        
        with open('ai_trends_data.json', 'w', encoding='utf-8') as f:
            json.dump(export_data, f, ensure_ascii=False, indent=2)
        
        print("✓ 已导出数据: ai_trends_data.json")
    
    def print_summary(self):
        """打印分析摘要"""
        print("\n" + "="*60)
        print("AI技术趋势分析报告")
        print("="*60)
        
        ranked = self.rank_trends()
        print("\n【综合排名】")
        for i, (trend, score) in enumerate(ranked, 1):
            print(f"{i}. {trend:12s} - 综合得分: {score:.2f}")
        
        print("\n【关键发现】")
        top_trend = ranked[0][0]
        print(f"• 最具潜力趋势: {top_trend}")
        
        high_impact = [t for t, d in self.trends_data.items() if d['影响力'] >= 4]
        print(f"• 高影响力趋势: {', '.join(high_impact)}")
        
        high_risk = [t for t, d in self.trends_data.items() if d['风险等级'] >= 4]
        print(f"• 高风险趋势: {', '.join(high_risk) if high_risk else '无'}")
        
        print("\n【市场洞察】")
        print(f"• 中国半导体市场份额预计从 {self.market_data['中国半导体市场份额']['2024']}% 增至 {self.market_data['中国半导体市场份额']['2028预测']}%")
        print(f"• {self.market_data['美国AI初创公司使用中国开源模型比例']}% 的美国AI初创公司使用中国开源模型")
        
        print("\n" + "="*60 + "\n")


def main():
    """主函数"""
    print("\n🚀 启动AI技术趋势分析...")
    
    analyzer = AITrendAnalyzer()
    
    # 打印摘要
    analyzer.print_summary()
    
    # 生成图表
    print("📊 生成可视化图表...")
    analyzer.generate_comparison_chart()
    analyzer.generate_ranking_chart()
    analyzer.generate_market_chart()
    
    # 为每个趋势生成雷达图
    print("\n📡 生成各趋势雷达图...")
    for trend in analyzer.trends_data.keys():
        analyzer.generate_radar_chart(trend)
    
    # 导出数据
    print("\n💾 导出分析数据...")
    analyzer.export_data()
    
    print("\n✅ 分析完成！所有图表和数据已生成。")
    print("\n生成的文件:")
    print("  • ai_trends_comparison.png - 多维度对比图")
    print("  • ai_trends_ranking.png - 综合排名图")
    print("  • ai_market_data.png - 市场数据图")
    print("  • [趋势名称]_radar.png - 各趋势雷达图")
    print("  • ai_trends_data.json - 原始数据导出")


if __name__ == '__main__':
    main()
