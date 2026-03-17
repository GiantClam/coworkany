#!/usr/bin/env python3
"""演示 Python 读取 CSV 文件的多种方法"""

# 方法 1: 使用标准库 csv 模块
import csv

print("=== 方法 1: 使用 csv 模块 ===")
# 创建示例 CSV 文件
with open('sample.csv', 'w', newline='', encoding='utf-8') as f:
    writer = csv.writer(f)
    writer.writerow(['姓名', '年龄', '城市'])
    writer.writerow(['张三', '25', '北京'])
    writer.writerow(['李四', '30', '上海'])
    writer.writerow(['王五', '28', '广州'])

# 读取 CSV 文件
with open('sample.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    for row in reader:
        print(row)

print("\n=== 方法 2: 使用 csv.DictReader ===")
# 以字典形式读取
with open('sample.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(f"{row['姓名']}: {row['年龄']}岁, 来自{row['城市']}")

# 方法 3: 使用 pandas (需要安装)
print("\n=== 方法 3: 使用 pandas ===")
try:
    import pandas as pd
    df = pd.read_csv('sample.csv')
    print(df)
    print(f"\n数据形状: {df.shape}")
    print(f"列名: {df.columns.tolist()}")
except ImportError:
    print("pandas 未安装，跳过此方法")
