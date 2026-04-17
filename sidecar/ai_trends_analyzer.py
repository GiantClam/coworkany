#!/usr/bin/env python3
"""
AI技术趋势数据分析脚本
分析AI技术趋势报告中的数据，生成可视化图表和统计报告
"""

import json
import matplotlib.pyplot as plt
import matplotlib
from datetime import datetime
from collections import Counter

# 设置中文字体支持
matplotlib.rcParams['font.sans-serif'] = ['Arial Unicode MS', 'SimHei', 'DejaVu Sans']
matplotlib.rcParams['axes.unicode_minus'] = False

class AITrendsAnalyzer:
    """AI技术趋势分析器"""
    
    def __init__(self):
        self.trends_data = {
            "trends": [
                {
                    "name": "全自动AI研究员",
                    "category": "研究与开发",
                    "importance": 5,
                    "timeline": "4周前",
                    "company": "OpenAI"
                },
                {
                    "name": "AI基准测试方法革新",
                    "category": "研究与开发",
                    "importance": 4,
                    "timeline": "近期",
                    "company": "行业共识"
                },
                {
                    "name": "世界模型训练",
                    "category": "应用与工具",
                    "importance": 4,
                    "timeline": "近期",
                    "company": "Niantic"
                },
                {
                    "name": "AI数学工具",
                    "category": "应用与工具",
                    "importance": 3,
                    "timeline": "近期",
                    "company": "Axiom Math"
                },
                {
                    "name": "AI内容验证",
                    "category": "政策与伦理",
                    "importance": 4,
                    "timeline": "近期",
                    "company": "Microsoft"
                },
                {
                    "name": "计算能力持续增长",
                    "category": "研究与开发",
                    "importance": 5,
                    "timeline": "持续",
                    "company": "行业趋势"
                },
                {
                    "name": "AI军事应用",
                    "category": "政策与伦理",
                    "importance": 4,
                    "timeline": "近期",
                    "company": "OpenAI"
                },
                {
                    "name": "区域AI热潮",
                    "category": "市场趋势",
                    "importance": 3,
                    "timeline": "近期",
                    "company": "OpenClaw"
                }
            ]
        }
    
    def analyze_categories(self):
        """分析技术趋势的类别分布"""
        categories = [trend["category"] for trend in self.trends_data["trends"]]
        category_counts = Counter(categories)
        
        print("\n=== 技术类别分析 ===")
        for category, count in category_counts.most_common():
            percentage = (count / len(categories)) * 100
            print(f"{category}: {count}项 ({percentage:.1f}%)")
        
        return category_counts
    
    def analyze_importance(self):
        """分析重要性分布"""
        importance_scores = [trend["importance"] for trend in self.trends_data["trends"]]
        
        print("\n=== 重要性分析 ===")
        print(f"平均重要性: {sum(importance_scores) / len(importance_scores):.2f}/5")
        print(f"最高重要性: {max(importance_scores)}/5")
        print(f"最低重要性: {min(importance_scores)}/5")
        
        importance_dist = Counter(importance_scores)
        for score in sorted(importance_dist.keys(), reverse=True):
            print(f"重要性{score}星: {importance_dist[score]}项")
        
        return importance_scores
    
    def analyze_companies(self):
        """分析主要参与公司"""
        companies = [trend["company"] for trend in self.trends_data["trends"]]
        company_counts = Counter(companies)
        
        print("\n=== 主要参与者分析 ===")
        for company, count in company_counts.most_common():
            print(f"{company}: {count}项技术趋势")
        
        return company_counts
    
    def plot_category_distribution(self, category_counts):
        """绘制类别分布饼图"""
        plt.figure(figsize=(10, 6))
        colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A']
        plt.pie(category_counts.values(), labels=category_counts.keys(), 
                autopct='%1.1f%%', startangle=90, colors=colors)
        plt.title('AI技术趋势类别分布', fontsize=16, pad=20)
        plt.axis('equal')
        plt.tight_layout()
        plt.savefig('category_distribution.png', dpi=300, bbox_inches='tight')
        print("\n✓ 已生成: category_distribution.png")
    
    def plot_importance_distribution(self, importance_scores):
        """绘制重要性分布柱状图"""
        plt.figure(figsize=(10, 6))
        importance_dist = Counter(importance_scores)
        scores = sorted(importance_dist.keys())
        counts = [importance_dist[score] for score in scores]
        
        bars = plt.bar(scores, counts, color='#4ECDC4', edgecolor='black', linewidth=1.2)
        plt.xlabel('重要性评分', fontsize=12)
        plt.ylabel('技术趋势数量', fontsize=12)
        plt.title('AI技术趋势重要性分布', fontsize=16, pad=20)
        plt.xticks(scores)
        plt.grid(axis='y', alpha=0.3)
        
        # 在柱状图上添加数值标签
        for bar in bars:
            height = bar.get_height()
            plt.text(bar.get_x() + bar.get_width()/2., height,
                    f'{int(height)}',
                    ha='center', va='bottom', fontsize=10)
        
        plt.tight_layout()
        plt.savefig('importance_distribution.png', dpi=300, bbox_inches='tight')
        print("✓ 已生成: importance_distribution.png")
    
    def plot_company_participation(self, company_counts):
        """绘制公司参与度横向柱状图"""
        plt.figure(figsize=(10, 6))
        companies = list(company_counts.keys())
        counts = list(company_counts.values())
        
        y_pos = range(len(companies))
        bars = plt.barh(y_pos, counts, color='#FF6B6B', edgecolor='black', linewidth=1.2)
        plt.yticks(y_pos, companies)
        plt.xlabel('技术趋势数量', fontsize=12)
        plt.title('主要参与者技术贡献', fontsize=16, pad=20)
        plt.grid(axis='x', alpha=0.3)
        
        # 在柱状图上添加数值标签
        for i, bar in enumerate(bars):
            width = bar.get_width()
            plt.text(width, bar.get_y() + bar.get_height()/2.,
                    f'{int(width)}',
                    ha='left', va='center', fontsize=10, fontweight='bold')
        
        plt.tight_layout()
        plt.savefig('company_participation.png', dpi=300, bbox_inches='tight')
        print("✓ 已生成: company_participation.png")
    
    def generate_summary_report(self):
        """生成汇总统计报告"""
        report = {
            "report_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "total_trends": len(self.trends_data["trends"]),
            "categories": {},
            "importance_stats": {},
            "top_companies": []
        }
        
        # 类别统计
        categories = [trend["category"] for trend in self.trends_data["trends"]]
        category_counts = Counter(categories)
        report["categories"] = dict(category_counts)
        
        # 重要性统计
        importance_scores = [trend["importance"] for trend in self.trends_data["trends"]]
        report["importance_stats"] = {
            "average": round(sum(importance_scores) / len(importance_scores), 2),
            "max": max(importance_scores),
            "min": min(importance_scores),
            "distribution": dict(Counter(importance_scores))
        }
        
        # 公司统计
        companies = [trend["company"] for trend in self.trends_data["trends"]]
        company_counts = Counter(companies)
        report["top_companies"] = [
            {"name": company, "count": count} 
            for company, count in company_counts.most_common(5)
        ]
        
        # 保存JSON报告
        with open('analysis_summary.json', 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        
        print("\n✓ 已生成: analysis_summary.json")
        return report
    
    def run_full_analysis(self):
        """运行完整分析流程"""
        print("=" * 50)
        print("AI技术趋势数据分析")
        print("=" * 50)
        
        # 执行各项分析
        category_counts = self.analyze_categories()
        importance_scores = self.analyze_importance()
        company_counts = self.analyze_companies()
        
        # 生成可视化图表
        print("\n=== 生成可视化图表 ===")
        self.plot_category_distribution(category_counts)
        self.plot_importance_distribution(importance_scores)
        self.plot_company_participation(company_counts)
        
        # 生成汇总报告
        print("\n=== 生成汇总报告 ===")
        summary = self.generate_summary_report()
        
        print("\n" + "=" * 50)
        print("分析完成！")
        print("=" * 50)
        print("\n生成的文件:")
        print("  - category_distribution.png (类别分布图)")
        print("  - importance_distribution.png (重要性分布图)")
        print("  - company_participation.png (公司参与度图)")
        print("  - analysis_summary.json (汇总报告)")
        print("\n")

def main():
    """主函数"""
    analyzer = AITrendsAnalyzer()
    analyzer.run_full_analysis()

if __name__ == "__main__":
    main()
