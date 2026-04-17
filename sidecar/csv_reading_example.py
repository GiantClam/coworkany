#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CSV 文件读取示例
演示多种读取 CSV 文件的方法
"""

import csv
import pandas as pd
from pathlib import Path

# ============ 方法 1: 使用 csv 模块 ============
print("=" * 50)
print("方法 1: 使用标准库 csv 模块")
print("=" * 50)

# 创建示例 CSV 文件
sample_data = """姓名,年龄,城市
张三,25,北京
李四,30,上海
王五,28,深圳"""

with open('sample.csv', 'w', encoding='utf-8') as f:
    f.write(sample_data)

# 使用 csv.reader 读取
print("\n1.1 使用 csv.reader:")
with open('sample.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    headers = next(csv_reader)
    print(f"表头: {headers}")
    
    for i, row in enumerate(csv_reader, 1):
        print(f"第 {i} 行: {row}")

# 使用 csv.DictReader 读取
print("\n1.2 使用 csv.DictReader:")
with open('sample.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    for row in csv_reader:
        print(f"{row['姓名']} - {row['年龄']}岁 - {row['城市']}")

# ============ 方法 2: 使用 pandas ============
print("\n" + "=" * 50)
print("方法 2: 使用 pandas（推荐）")
print("=" * 50)

# 基本读取
df = pd.read_csv('sample.csv')
print("\n2.1 完整数据:")
print(df)

print("\n2.2 数据信息:")
print(f"形状: {df.shape}")
print(f"列名: {list(df.columns)}")
print(f"数据类型:\n{df.dtypes}")

print("\n2.3 数据访问:")
print(f"第一行:\n{df.iloc[0]}")
print(f"\n年龄列:\n{df['年龄']}")

print("\n2.4 数据统计:")
print(df.describe())

# ============ 常见场景 ============
print("\n" + "=" * 50)
print("常见场景处理")
print("=" * 50)

# 场景 1: 处理不同分隔符
tsv_data = "姓名\t年龄\t城市\n张三\t25\t北京"
with open('sample.tsv', 'w', encoding='utf-8') as f:
    f.write(tsv_data)

df_tsv = pd.read_csv('sample.tsv', sep='\t')
print("\n3.1 读取 TSV 文件:")
print(df_tsv)

# 场景 2: 跳过行和选择列
print("\n3.2 只读取特定列:")
df_selected = pd.read_csv('sample.csv', usecols=['姓名', '城市'])
print(df_selected)

# 场景 3: 处理缺失值
data_with_na = """姓名,年龄,城市
张三,25,北京
李四,,上海
王五,28,"""

with open('sample_na.csv', 'w', encoding='utf-8') as f:
    f.write(data_with_na)

df_na = pd.read_csv('sample_na.csv')
print("\n3.3 处理缺失值:")
print(df_na)
print(f"\n缺失值统计:\n{df_na.isnull().sum()}")

# 清理临时文件
Path('sample.csv').unlink(missing_ok=True)
Path('sample.tsv').unlink(missing_ok=True)
Path('sample_na.csv').unlink(missing_ok=True)

print("\n" + "=" * 50)
print("学习完成！")
print("=" * 50)
