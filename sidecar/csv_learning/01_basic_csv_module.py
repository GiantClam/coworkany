"""
方法一：使用 Python 内置 csv 模块
适用场景：简单的 CSV 读取，不需要复杂的数据处理
"""

import csv

print("=" * 50)
print("1. 基础读取 - 使用 csv.reader()")
print("=" * 50)

# 读取 CSV 文件（返回列表）
with open('sample_data_en.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    
    # 读取表头
    headers = next(csv_reader)
    print(f"表头: {headers}")
    print()
    
    # 读取数据行
    print("数据内容:")
    for row in csv_reader:
        print(row)

print("\n" + "=" * 50)
print("2. 使用 DictReader - 返回字典格式")
print("=" * 50)

# 使用 DictReader（更方便，返回字典）
with open('sample_data_en.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    for row in csv_reader:
        print(f"姓名: {row['name']}, 年龄: {row['age']}, 城市: {row['city']}, 薪资: {row['salary']}")

print("\n" + "=" * 50)
print("3. 处理中文 CSV 文件")
print("=" * 50)

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    for row in csv_reader:
        print(f"{row['姓名']} - {row['职业']} - {row['城市']}")

print("\n" + "=" * 50)
print("4. 处理不同分隔符")
print("=" * 50)

# 创建一个使用分号分隔的文件示例
with open('sample_semicolon.csv', 'w', encoding='utf-8') as file:
    file.write("name;age;city\n")
    file.write("Alice;28;Beijing\n")
    file.write("Bob;35;Shanghai\n")

# 读取分号分隔的文件
with open('sample_semicolon.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file, delimiter=';')
    for row in csv_reader:
        print(row)
