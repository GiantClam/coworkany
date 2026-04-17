#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
练习题：CSV 文件读取与处理

完成以下任务来巩固所学知识
"""

import csv

print("=" * 60)
print("练习1: 使用 csv.DictReader 读取文件")
print("=" * 60)
print("任务：读取 sample_data.csv，打印所有在北京工作的员工姓名")
print()

# TODO: 在这里编写你的代码
# 提示：使用 if row['城市'] == '北京' 进行筛选

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    reader = csv.DictReader(file)
    for row in reader:
        if row['城市'] == '北京':
            print(f"✓ {row['姓名']}")

print("\n" + "=" * 60)
print("练习2: 计算平均年龄")
print("=" * 60)
print("任务：计算所有员工的平均年龄")
print()

# TODO: 在这里编写你的代码
# 提示：累加年龄，然后除以总人数

ages = []
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    reader = csv.DictReader(file)
    for row in reader:
        ages.append(int(row['年龄']))

average_age = sum(ages) / len(ages)
print(f"✓ 平均年龄: {average_age:.1f} 岁")

print("\n" + "=" * 60)
print("练习3: 使用 pandas 进行数据分析")
print("=" * 60)
print("任务：找出年龄最大的员工")
print()

try:
    import pandas as pd
    
    # TODO: 在这里编写你的代码
    # 提示：使用 df['年龄'].idxmax() 找到最大值的索引
    
    df = pd.read_csv('sample_data.csv')
    max_age_idx = df['年龄'].idxmax()
    oldest = df.loc[max_age_idx]
    
    print(f"✓ 年龄最大的员工: {oldest['姓名']}, {oldest['年龄']}岁, {oldest['职业']}")
    
except ImportError:
    print("⚠️  需要安装 pandas: pip install pandas")

print("\n" + "=" * 60)
print("🎉 练习完成！")
print("=" * 60)
print("\n进阶挑战：")
print("1. 创建一个新的 CSV 文件，包含你自己的数据")
print("2. 读取并统计每个城市的员工数量")
print("3. 将年龄大于30的员工导出到新文件")
