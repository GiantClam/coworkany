#!/usr/bin/env python3
"""方法2: 使用 csv.DictReader 以字典形式读取"""

import csv

print("=" * 50)
print("方法2: 使用 csv.DictReader 读取为字典")
print("=" * 50)

# 使用 DictReader 读取
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    print("\n每行数据作为字典:")
    for row in csv_reader:
        print(f"\n  姓名: {row['姓名']}")
        print(f"  年龄: {row['年龄']}")
        print(f"  城市: {row['城市']}")
        print(f"  职业: {row['职业']}")

print("\n" + "=" * 50)
print("方法2优点: 可以通过列名访问数据，更直观")
print("=" * 50)
