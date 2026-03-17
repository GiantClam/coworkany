#!/usr/bin/env python3
"""演示 Python 读取 CSV 文件的多种方法"""

# 方法 1: 使用标准库 csv 模块
import csv

print("=== 方法 1: 使用 csv.reader ===")
with open('sample_data.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    headers = next(reader)
    print(f"列名: {headers}")
    for row in reader:
        print(row)

print("\n=== 方法 2: 使用 csv.DictReader ===")
with open('sample_data.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(f"{row['name']}: {row['age']}岁, 来自{row['city']}")

# 方法 3: 使用 pandas (如果可用)
try:
    import pandas as pd
    print("\n=== 方法 3: 使用 pandas ===")
    df = pd.read_csv('sample_data.csv')
    print(df)
    print(f"\n数据形状: {df.shape}")
    print(f"平均年龄: {df['age'].mean():.1f}")
except ImportError:
    print("\n=== pandas 未安装，跳过方法 3 ===")
