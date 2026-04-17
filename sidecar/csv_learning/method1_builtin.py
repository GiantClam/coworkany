#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方法1: 使用 Python 内置的 csv 模块
优点: 无需安装额外库，轻量级
适用: 简单的 CSV 读取需求
"""

import csv

print("=" * 50)
print("方法1: 使用内置 csv 模块")
print("=" * 50)

# 读取方式1: 使用 csv.reader (返回列表)
print("\n1.1 使用 csv.reader:")
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    header = next(csv_reader)  # 读取表头
    print(f"表头: {header}")
    print("\n数据行:")
    for row in csv_reader:
        print(row)

# 读取方式2: 使用 csv.DictReader (返回字典)
print("\n\n1.2 使用 csv.DictReader:")
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    for row in csv_reader:
        print(f"姓名: {row['name']}, 年龄: {row['age']}, 城市: {row['city']}, 薪资: {row['salary']}")
