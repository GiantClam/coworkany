#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AI技术趋势数据分析脚本
分析AI领域的技术趋势、投资规模和市场动态
"""

import json
from datetime import datetime
from collections import Counter
import statistics

# AI技术趋势数据
ai_trends_data = {
    "report_date": "2025-04",
    "data_sources": 20,
    "recency_days": 30,
    
    "technology_trends": [
        {
            "name": "智能代理 (Agentic AI)",
            "priority": 1,
            "maturity": "emerging",
            "growth_rate": "high",
            "mentions": 8,
            "key_players": ["OpenAI", "Anthropic", "各大科技公司"],
            "applications": ["自主编码", "任务规划", "工具集成"]
        },
        {
            "name": "多模态AI (Multimodal AI)",
            "priority": 2,
            "maturity": "growing",
            "growth_rate": "high",
            "mentions": 6,
            "key_players": ["OpenAI", "Google", "Meta"],
            "applications": ["文本图像处理", "语音识别", "视频分析"]
        },
        {
            "name": "推理模型 (Reasoning Models)",
            "priority": 3,
            "maturity": "emerging",
            "growth_rate": "medium",
            "mentions": 5,
            "key_players": ["DeepSeek", "OpenAI", "研究机构"],
            "applications": ["复杂问题解决", "逻辑推理", "决策支持"]
        },
        {
            "name": "大语言模型 (LLM)",
            "priority": 4,
            "maturity": "mature",
            "growth_rate": "medium",
            "mentions": 10,
            "key_players": ["OpenAI", "Anthropic", "Google", "Meta"],
            "applications": ["内容生成", "对话系统", "代码辅助"]
        },
        {
            "name": "AI基础设施",
            "priority": 5,
            "maturity": "growing",
            "growth_rate": "very_high",
            "mentions": 7,
            "key_players": ["Nvidia", "TSMC", "云服务商"],
            "applications": ["数据中心", "AI芯片", "云计算"]
        }
    ],
    
    "market_data": {
        "infrastructure_investment_billion": 630,
        "tsmc_revenue_growth_percent": 35,
        "ai_stocks_outperform_years": 3,
        "data_center_power_demand": "快速增长"
    },
    
    "challenges": [
        {"name": "需求不确定性", "severity": "high", "impact": "投资回报"},
        {"name": "能源消耗", "severity": "high", "impact": "环境可持续性"},
        {"name": "领域特定推理", "severity": "medium", "impact": "技术能力"},
        {"name": "成本控制", "severity": "medium", "impact": "商业化"}
    ],
    
    "timeline": {
        "2024": "推理型AI主导",
        "2025": "自主代理崛起",
        "2026": "新一代AI能力预测"
    }
}


class AITrendAnalyzer:
    """AI技术趋势分析器"""
    
    def __init__(self, data):
        self.data = data
        self.trends = data["technology_trends"]
        self.market = data["market_data"]
        self.challenges = data["challenges"]
    
    def analyze_trend_priority(self):
        """分析技术趋势优先级分布"""
        print("\n" + "="*60)
        print("技术趋势优先级分析")
        print("="*60)
        
        sorted_trends = sorted(self.trends, key=lambda x: x["priority"])
        
        for trend in sorted_trends:
            print(f"\n优先级 {trend['priority']}: {trend['name']}")
            print(f"  成熟度: {trend['maturity']}")
            print(f"  增长率: {trend['growth_rate']}")
            print(f"  提及次数: {trend['mentions']}")
            print(f"  关键玩家: {', '.join(trend['key_players'][:3])}")
    
    def analyze_mentions(self):
        """分析技术提及频率"""
        print("\n" + "="*60)
        print("技术提及频率分析")
        print("="*60)
        
        mentions = [(t["name"], t["mentions"]) for t in self.trends]
        mentions.sort(key=lambda x: x[1], reverse=True)
        
        total_mentions = sum(m[1] for m in mentions)
        
        print(f"\n总提及次数: {total_mentions}")
        print("\n排名:")
        for i, (name, count) in enumerate(mentions, 1):
            percentage = (count / total_mentions) * 100
            bar = "█" * int(percentage / 2)
            print(f"{i}. {name:30s} {count:3d} 次 ({percentage:5.1f}%) {bar}")
    
    def analyze_maturity(self):
        """分析技术成熟度分布"""
        print("\n" + "="*60)
        print("技术成熟度分布")
        print("="*60)
        
        maturity_count = Counter(t["maturity"] for t in self.trends)
        
        maturity_labels = {
            "emerging": "新兴技术",
            "growing": "成长期",
            "mature": "成熟期"
        }
        
        print()
        for maturity, count in maturity_count.items():
            label = maturity_labels.get(maturity, maturity)
            percentage = (count / len(self.trends)) * 100
            print(f"{label:15s}: {count} 项技术 ({percentage:.1f}%)")
    
    def analyze_growth_rate(self):
        """分析增长率分布"""
        print("\n" + "="*60)
        print("技术增长率分析")
        print("="*60)
        
        growth_count = Counter(t["growth_rate"] for t in self.trends)
        
        growth_labels = {
            "very_high": "极高增长",
            "high": "高增长",
            "medium": "中等增长",
            "low": "低增长"
        }
        
        print()
        for growth, count in sorted(growth_count.items(), 
                                    key=lambda x: ["very_high", "high", "medium", "low"].index(x[0])):
            label = growth_labels.get(growth, growth)
            percentage = (count / len(self.trends)) * 100
            print(f"{label:15s}: {count} 项技术 ({percentage:.1f}%)")
    
    def analyze_market_investment(self):
        """分析市场投资数据"""
        print("\n" + "="*60)
        print("市场投资与增长分析")
        print("="*60)
        
        print(f"\nAI基础设施投资: ${self.market['infrastructure_investment_billion']} 亿美元")
        print(f"TSMC营收增长: {self.market['tsmc_revenue_growth_percent']}%")
        print(f"AI股票跑赢大盘: 连续 {self.market['ai_stocks_outperform_years']} 年")
        print(f"数据中心电力需求: {self.market['data_center_power_demand']}")
        
        # 计算投资强度
        investment_per_trend = self.market['infrastructure_investment_billion'] / len(self.trends)
        print(f"\n平均每项技术趋势投资: ${investment_per_trend:.1f} 亿美元")
    
    def analyze_challenges(self):
        """分析技术挑战"""
        print("\n" + "="*60)
        print("技术挑战分析")
        print("="*60)
        
        severity_count = Counter(c["severity"] for c in self.challenges)
        
        print("\n严重程度分布:")
        for severity, count in severity_count.items():
            print(f"  {severity:10s}: {count} 项挑战")
        
        print("\n详细挑战列表:")
        for i, challenge in enumerate(self.challenges, 1):
            print(f"{i}. {challenge['name']:20s} | 严重度: {challenge['severity']:6s} | 影响: {challenge['impact']}")
    
    def analyze_key_players(self):
        """分析关键参与者"""
        print("\n" + "="*60)
        print("关键参与者分析")
        print("="*60)
        
        all_players = []
        for trend in self.trends:
            all_players.extend(trend["key_players"])
        
        player_count = Counter(all_players)
        
        print("\n参与技术领域最多的公司/组织:")
        for i, (player, count) in enumerate(player_count.most_common(10), 1):
            print(f"{i:2d}. {player:25s}: {count} 个技术领域")
    
    def generate_summary_statistics(self):
        """生成汇总统计"""
        print("\n" + "="*60)
        print("汇总统计")
        print("="*60)
        
        total_trends = len(self.trends)
        total_mentions = sum(t["mentions"] for t in self.trends)
        avg_mentions = statistics.mean(t["mentions"] for t in self.trends)
        
        print(f"\n技术趋势总数: {total_trends}")
        print(f"总提及次数: {total_mentions}")
        print(f"平均提及次数: {avg_mentions:.2f}")
        print(f"数据来源数量: {self.data['data_sources']}")
        print(f"数据时效性: 最近 {self.data['recency_days']} 天")
        
        high_growth = sum(1 for t in self.trends if t["growth_rate"] in ["high", "very_high"])
        print(f"高增长技术数量: {high_growth} ({high_growth/total_trends*100:.1f}%)")
    
    def export_to_json(self, filename="ai_trends_analysis.json"):
        """导出分析结果为JSON"""
        analysis_result = {
            "report_date": datetime.now().isoformat(),
            "source_data": self.data,
            "statistics": {
                "total_trends": len(self.trends),
                "total_mentions": sum(t["mentions"] for t in self.trends),
                "avg_mentions": statistics.mean(t["mentions"] for t in self.trends),
                "high_growth_count": sum(1 for t in self.trends if t["growth_rate"] in ["high", "very_high"])
            }
        }
        
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(analysis_result, f, ensure_ascii=False, indent=2)
        
        print(f"\n分析结果已导出到: {filename}")
    
    def run_full_analysis(self):
        """运行完整分析"""
        print("\n" + "█"*60)
        print("█" + " "*58 + "█")
        print("█" + " "*15 + "AI技术趋势数据分析报告" + " "*15 + "█")
        print("█" + " "*58 + "█")
        print("█"*60)
        
        print(f"\n报告生成时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"数据时间范围: {self.data['report_date']}")
        
        self.analyze_trend_priority()
        self.analyze_mentions()
        self.analyze_maturity()
        self.analyze_growth_rate()
        self.analyze_market_investment()
        self.analyze_challenges()
        self.analyze_key_players()
        self.generate_summary_statistics()
        
        print("\n" + "="*60)
        print("分析完成")
        print("="*60 + "\n")


def main():
    """主函数"""
    analyzer = AITrendAnalyzer(ai_trends_data)
    analyzer.run_full_analysis()
    analyzer.export_to_json()


if __name__ == "__main__":
    main()
