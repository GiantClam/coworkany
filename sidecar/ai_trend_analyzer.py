#!/usr/bin/env python3
"""
AI技术趋势数据分析脚本

功能：
1. 解析研究数据
2. 生成趋势分析图表
3. 输出统计报告
"""

import json
from datetime import datetime
from collections import Counter
import re


class AITrendAnalyzer:
    """AI技术趋势分析器"""
    
    def __init__(self):
        self.data = {
            "trends": [
                {
                    "name": "开源AI模型",
                    "importance": 95,
                    "growth_rate": 85,
                    "adoption_rate": 80,
                    "region": "全球",
                    "key_players": ["中国开源社区", "Meta", "Mistral"],
                    "investment": 50
                },
                {
                    "name": "AI代理技术",
                    "importance": 90,
                    "growth_rate": 95,
                    "adoption_rate": 45,
                    "region": "中国、美国",
                    "key_players": ["百度", "阿里巴巴", "OpenAI"],
                    "investment": 80
                },
                {
                    "name": "AI专用芯片",
                    "importance": 88,
                    "growth_rate": 75,
                    "adoption_rate": 60,
                    "region": "全球",
                    "key_players": ["Arm", "阿里巴巴", "NVIDIA"],
                    "investment": 120
                },
                {
                    "name": "大规模AI投资",
                    "importance": 85,
                    "growth_rate": 90,
                    "adoption_rate": 70,
                    "region": "美国",
                    "key_players": ["OpenAI", "微软", "谷歌"],
                    "investment": 630
                },
                {
                    "name": "AI能源管理",
                    "importance": 75,
                    "growth_rate": 80,
                    "adoption_rate": 35,
                    "region": "全球",
                    "key_players": ["数据中心运营商", "能源公司"],
                    "investment": 45
                }
            ],
            "risks": [
                {"category": "技术风险", "severity": 7, "probability": 60},
                {"category": "商业风险", "severity": 8, "probability": 70},
                {"category": "地缘政治风险", "severity": 9, "probability": 80},
                {"category": "环境风险", "severity": 7, "probability": 65}
            ],
            "regions": {
                "美国": {"strength": 85, "challenges": 70, "investment": 400},
                "中国": {"strength": 80, "challenges": 60, "investment": 200},
                "欧洲": {"strength": 60, "challenges": 75, "investment": 80}
            }
        }
    
    def analyze_trends(self):
        """分析技术趋势"""
        print("=" * 60)
        print("AI技术趋势分析报告")
        print("=" * 60)
        print(f"生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        
        trends = self.data["trends"]
        
        # 按重要性排序
        sorted_trends = sorted(trends, key=lambda x: x["importance"], reverse=True)
        
        print("1. 技术趋势排名（按重要性）")
        print("-" * 60)
        for i, trend in enumerate(sorted_trends, 1):
            print(f"{i}. {trend['name']}")
            print(f"   重要性: {trend['importance']}/100")
            print(f"   增长率: {trend['growth_rate']}%")
            print(f"   采用率: {trend['adoption_rate']}%")
            print(f"   投资额: ${trend['investment']}B")
            print(f"   主要参与者: {', '.join(trend['key_players'])}")
            print()
        
        return sorted_trends
    
    def analyze_growth_potential(self):
        """分析增长潜力"""
        print("\n2. 增长潜力分析")
        print("-" * 60)
        
        trends = self.data["trends"]
        
        # 计算增长潜力得分 = 增长率 * (100 - 采用率) / 100
        for trend in trends:
            potential = trend["growth_rate"] * (100 - trend["adoption_rate"]) / 100
            trend["growth_potential"] = round(potential, 2)
        
        sorted_by_potential = sorted(trends, key=lambda x: x["growth_potential"], reverse=True)
        
        print("技术趋势增长潜力排名：\n")
        for i, trend in enumerate(sorted_by_potential, 1):
            print(f"{i}. {trend['name']}: {trend['growth_potential']} 分")
            print(f"   分析: 增长率{trend['growth_rate']}% × 市场空间{100-trend['adoption_rate']}%")
            print()
    
    def analyze_investment(self):
        """分析投资分布"""
        print("\n3. 投资分布分析")
        print("-" * 60)
        
        trends = self.data["trends"]
        total_investment = sum(t["investment"] for t in trends)
        
        print(f"总投资额: ${total_investment}B\n")
        print("投资分布：\n")
        
        for trend in sorted(trends, key=lambda x: x["investment"], reverse=True):
            percentage = (trend["investment"] / total_investment) * 100
            bar = "█" * int(percentage / 2)
            print(f"{trend['name']:20s} ${trend['investment']:6.1f}B [{percentage:5.1f}%] {bar}")
        
        print(f"\n平均投资: ${total_investment / len(trends):.1f}B")
    
    def analyze_risks(self):
        """分析风险因素"""
        print("\n4. 风险评估")
        print("-" * 60)
        
        risks = self.data["risks"]
        
        print("风险矩阵（严重性 × 概率）：\n")
        
        for risk in sorted(risks, key=lambda x: x["severity"] * x["probability"], reverse=True):
            risk_score = risk["severity"] * risk["probability"] / 10
            print(f"{risk['category']:15s} | 严重性: {risk['severity']}/10 | 概率: {risk['probability']}% | 风险值: {risk_score:.1f}")
        
        avg_severity = sum(r["severity"] for r in risks) / len(risks)
        avg_probability = sum(r["probability"] for r in risks) / len(risks)
        
        print(f"\n平均严重性: {avg_severity:.1f}/10")
        print(f"平均概率: {avg_probability:.1f}%")
        
        if avg_severity > 7 and avg_probability > 60:
            print("\n⚠️  警告: 整体风险水平较高，建议采取风险缓解措施")
    
    def analyze_regional_competition(self):
        """分析地区竞争格局"""
        print("\n5. 地区竞争格局")
        print("-" * 60)
        
        regions = self.data["regions"]
        
        print("地区竞争力对比：\n")
        
        for region, metrics in sorted(regions.items(), key=lambda x: x[1]["strength"], reverse=True):
            print(f"{region}:")
            print(f"  技术实力: {metrics['strength']}/100")
            print(f"  面临挑战: {metrics['challenges']}/100")
            print(f"  投资规模: ${metrics['investment']}B")
            
            # 计算竞争力指数
            competitiveness = (metrics['strength'] * 0.6 + 
                             (100 - metrics['challenges']) * 0.2 + 
                             min(metrics['investment'] / 10, 40) * 0.2)
            print(f"  综合竞争力: {competitiveness:.1f}/100")
            print()
    
    def generate_recommendations(self):
        """生成投资建议"""
        print("\n6. 投资建议")
        print("-" * 60)
        
        trends = self.data["trends"]
        
        # 短期机会（高采用率 + 高增长率）
        short_term = [t for t in trends if t["adoption_rate"] > 50 and t["growth_rate"] > 70]
        
        # 中期机会（中等采用率 + 高增长潜力）
        medium_term = [t for t in trends if 30 < t["adoption_rate"] <= 50 and t["growth_rate"] > 75]
        
        # 长期机会（低采用率 + 高重要性）
        long_term = [t for t in trends if t["adoption_rate"] <= 30 and t["importance"] > 70]
        
        print("短期机会（6-12个月）：")
        for trend in short_term:
            print(f"  • {trend['name']} - 成熟度高，增长稳定")
        
        print("\n中期机会（1-3年）：")
        for trend in medium_term:
            print(f"  • {trend['name']} - 快速增长期，市场空间大")
        
        print("\n长期机会（3-5年）：")
        for trend in long_term:
            print(f"  • {trend['name']} - 早期阶段，战略价值高")
    
    def export_data(self, filename="ai_trends_data.json"):
        """导出数据为JSON"""
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)
        print(f"\n数据已导出到: {filename}")
    
    def generate_summary(self):
        """生成执行摘要"""
        print("\n" + "=" * 60)
        print("执行摘要")
        print("=" * 60)
        
        trends = self.data["trends"]
        
        # 最重要的趋势
        top_trend = max(trends, key=lambda x: x["importance"])
        
        # 增长最快的趋势
        fastest_growing = max(trends, key=lambda x: x["growth_rate"])
        
        # 投资最大的领域
        most_invested = max(trends, key=lambda x: x["investment"])
        
        print(f"\n最重要趋势: {top_trend['name']} (重要性: {top_trend['importance']}/100)")
        print(f"增长最快趋势: {fastest_growing['name']} (增长率: {fastest_growing['growth_rate']}%)")
        print(f"投资最大领域: {most_invested['name']} (投资: ${most_invested['investment']}B)")
        
        total_investment = sum(t["investment"] for t in trends)
        avg_growth = sum(t["growth_rate"] for t in trends) / len(trends)
        
        print(f"\n行业总投资: ${total_investment}B")
        print(f"平均增长率: {avg_growth:.1f}%")
        
        print("\n关键洞察:")
        print("  1. 开源AI正在重塑行业竞争格局")
        print("  2. AI代理是下一个重要应用方向")
        print("  3. 能源效率成为可持续发展关键")
        print("  4. 地缘政治因素深刻影响技术发展")


def main():
    """主函数"""
    analyzer = AITrendAnalyzer()
    
    # 执行分析
    analyzer.analyze_trends()
    analyzer.analyze_growth_potential()
    analyzer.analyze_investment()
    analyzer.analyze_risks()
    analyzer.analyze_regional_competition()
    analyzer.generate_recommendations()
    analyzer.generate_summary()
    
    # 导出数据
    analyzer.export_data()
    
    print("\n" + "=" * 60)
    print("分析完成！")
    print("=" * 60)


if __name__ == "__main__":
    main()
