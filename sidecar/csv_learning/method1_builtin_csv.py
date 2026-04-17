#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方法1: 使用 Python 内置的 csv 模块
优点: 无需安装额外库，轻量级
适用: 简单的 CSV 读取场景
"""

import csv

print("=" * 50)
print("方法1: 使用内置 csv 模块")
print("=" * 50)

# 读取 CSV 文件
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    
    # 读取表头
    headers = next(csv_reader)
    print(f"\n表头: {headers}")
    
    # 读取数据行
    print("\n数据内容:")
    for row in csv_reader:
        print(row)

print("\n" + "-" * 50)

# 使用 DictReader 读取（更方便）
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    print("\n使用 DictReader (字典格式):")
    for row in csv_reader:
        print(f"{row['姓名']}: {row['年龄']}岁, 在{row['城市']}做{row['职业']}")
