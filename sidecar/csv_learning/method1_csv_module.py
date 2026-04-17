#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方法一：使用标准库 csv 模块读取 CSV
"""

import csv

print("=" * 50)
print("方法 1: 使用 csv.reader()")
print("=" * 50)

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    
    # 读取表头
    headers = next(csv_reader)
    print(f"表头: {headers}\n")
    
    # 读取数据行
    print("数据行:")
    for i, row in enumerate(csv_reader, 1):
        print(f"第 {i} 行: {row}")

print("\n" + "=" * 50)
print("方法 2: 使用 csv.DictReader() (推荐)")
print("=" * 50)

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    print("\n以字典形式读取每一行:")
    for i, row in enumerate(csv_reader, 1):
        print(f"\n第 {i} 行:")
        print(f"  姓名: {row['name']}")
        print(f"  年龄: {row['age']}")
        print(f"  城市: {row['city']}")
        print(f"  薪资: {row['salary']}")

print("\n" + "=" * 50)
print("方法 3: 筛选数据")
print("=" * 50)

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    print("\n年龄大于 30 的员工:")
    for row in csv_reader:
        if int(row['age']) > 30:
            print(f"  {row['name']} - {row['age']}岁 - {row['city']}")
