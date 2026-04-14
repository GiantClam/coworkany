#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CSV 读取基础教程 - 使用内置 csv 模块
演示如何使用 Python 内置的 csv 模块读取 CSV 文件
"""

import csv

print("=" * 60)
print("方法 1: 使用 csv.reader() 读取整个文件")
print("=" * 60)

# 打开 CSV 文件，指定编码为 utf-8
with open('students.csv', 'r', encoding='utf-8') as file:
    # 创建 CSV 读取器对象
    csv_reader = csv.reader(file)
    
    # 读取表头
    header = next(csv_reader)
    print(f"表头: {header}\n")
    
    # 逐行读取数据
    print("所有学生数据:")
    for row in csv_reader:
        print(row)

print("\n" + "=" * 60)
print("方法 2: 使用 csv.DictReader() 读取（推荐）")
print("=" * 60)

# DictReader 会自动将每行转换为字典，键为表头
with open('students.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    print("使用字典格式读取:")
    for row in csv_reader:
        # 每行是一个字典，可以通过列名访问
        print(f"姓名: {row['姓名']}, 专业: {row['专业']}, 成绩: {row['成绩']}")

print("\n" + "=" * 60)
print("方法 3: 读取特定列")
print("=" * 60)

with open('students.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    print("只显示姓名和成绩:")
    for row in csv_reader:
        print(f"{row['姓名']}: {row['成绩']}分")

print("\n" + "=" * 60)
print("方法 4: 数据处理示例 - 计算平均成绩")
print("=" * 60)

with open('students.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    total_score = 0
    count = 0
    
    for row in csv_reader:
        total_score += float(row['成绩'])
        count += 1
    
    average = total_score / count
    print(f"班级平均成绩: {average:.2f}分")

print("\n" + "=" * 60)
print("方法 5: 条件筛选 - 找出成绩优秀的学生")
print("=" * 60)

with open('students.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    print("成绩 >= 90 分的学生:")
    for row in csv_reader:
        if float(row['成绩']) >= 90:
            print(f"{row['姓名']} ({row['专业']}): {row['成绩']}分")

print("\n" + "=" * 60)
print("方法 6: 按专业分组统计")
print("=" * 60)

with open('students.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    # 使用字典存储每个专业的学生
    majors = {}
    
    for row in csv_reader:
        major = row['专业']
        if major not in majors:
            majors[major] = []
        majors[major].append(row['姓名'])
    
    print("各专业学生人数:")
    for major, students in majors.items():
        print(f"{major}: {len(students)}人 - {', '.join(students)}")
