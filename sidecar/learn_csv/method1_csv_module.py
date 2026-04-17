#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""方法1: 使用标准库 csv 模块"""

import csv

print("=" * 50)
print("方法1: 使用 csv.reader")
print("=" * 50)

# 使用 csv.reader 读取
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    
    # 读取表头
    header = next(csv_reader)
    print(f"表头: {header}\n")
    
    # 逐行读取
    for i, row in enumerate(csv_reader, 1):
        print(f"第 {i} 行: {row}")

print("\n" + "=" * 50)
print("方法2: 使用 csv.DictReader (推荐)")
print("=" * 50)

# 使用 DictReader 读取（更方便）
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    for row in csv_reader:
        print(f"{row['姓名']} - {row['年龄']}岁 - {row['城市']} - {row['职业']}")
