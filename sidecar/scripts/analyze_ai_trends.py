#!/usr/bin/env python3
"""
AI 趋势数据分析脚本
- 读取内置趋势样本数据
- 计算趋势频次、平均影响分、同比变化
- 输出文本分析结果与CSV汇总
"""

import csv
from collections import defaultdict
from statistics import mean

DATA = [
    {"year": 2024, "trend": "agent", "mentions": 28, "impact_score": 7.1},
    {"year": 2025, "trend": "agent", "mentions": 49, "impact_score": 8.0},
    {"year": 2026, "trend": "agent", "mentions": 72, "impact_score": 8.7},
    {"year": 2024, "trend": "multimodal", "mentions": 33, "impact_score": 7.4},
    {"year": 2025, "trend": "multimodal", "mentions": 58, "impact_score": 8.2},
    {"year": 2026, "trend": "multimodal", "mentions": 76, "impact_score": 8.8},
    {"year": 2024, "trend": "infrastructure", "mentions": 41, "impact_score": 7.6},
    {"year": 2025, "trend": "infrastructure", "mentions": 67, "impact_score": 8.3},
    {"year": 2026, "trend": "infrastructure", "mentions": 81, "impact_score": 8.9},
    {"year": 2024, "trend": "governance", "mentions": 19, "impact_score": 6.8},
    {"year": 2025, "trend": "governance", "mentions": 36, "impact_score": 7.7},
    {"year": 2026, "trend": "governance", "mentions": 54, "impact_score": 8.4},
]


def analyze(data):
    grouped = defaultdict(list)
    for row in data:
        grouped[row["trend"]].append(row)

    summary = []
    for trend, rows in grouped.items():
        rows = sorted(rows, key=lambda x: x["year"])
        total_mentions = sum(r["mentions"] for r in rows)
        avg_impact = mean(r["impact_score"] for r in rows)

        yoy_growth = []
        for i in range(1, len(rows)):
            prev = rows[i - 1]["mentions"]
            curr = rows[i]["mentions"]
            growth = (curr - prev) / prev * 100 if prev else 0
            yoy_growth.append(round(growth, 2))

        summary.append({
            "trend": trend,
            "total_mentions": total_mentions,
            "avg_impact_score": round(avg_impact, 2),
            "yoy_growth_%": yoy_growth,
            "latest_mentions_2026": rows[-1]["mentions"],
        })

    summary.sort(key=lambda x: (x["latest_mentions_2026"], x["avg_impact_score"]), reverse=True)
    return summary


def save_csv(summary, path="reports/ai_trends_summary.csv"):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["trend", "total_mentions", "avg_impact_score", "yoy_growth_%", "latest_mentions_2026"])
        for row in summary:
            writer.writerow([
                row["trend"],
                row["total_mentions"],
                row["avg_impact_score"],
                "|".join(map(str, row["yoy_growth_%"])),
                row["latest_mentions_2026"],
            ])


def main():
    summary = analyze(DATA)
    print("=== AI Trends Analysis Summary ===")
    for s in summary:
        print(
            f"- {s['trend']}: total_mentions={s['total_mentions']}, "
            f"avg_impact={s['avg_impact_score']}, "
            f"yoy_growth={s['yoy_growth_%']}, latest_2026={s['latest_mentions_2026']}"
        )

    save_csv(summary)
    print("\nCSV 输出完成: reports/ai_trends_summary.csv")


if __name__ == "__main__":
    main()
