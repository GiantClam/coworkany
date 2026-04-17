"""
Python 读取 CSV 文件 - 学习教程
================================

本教程演示三种常用的 CSV 读取方法
"""

# ============================================
# 方法 1: 使用内置 csv 模块（标准库）
# ============================================
import csv

print("=" * 50)
print("方法 1: 使用 csv 模块")
print("=" * 50)

# 读取为列表
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    headers = next(csv_reader)  # 读取表头
    print(f"表头: {headers}\n")
    
    for row in csv_reader:
        print(f"{row[0]} - {row[1]}岁 - {row[2]} - {row[3]}")

print("\n")

# 读取为字典（推荐）
with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    print("使用 DictReader（字典格式）:")
    for row in csv_reader:
        print(f"{row['姓名']}: {row['职业']}, 来自{row['城市']}")

print("\n")


# ============================================
# 方法 2: 使用 pandas（数据分析首选）
# ============================================
try:
    import pandas as pd
    
    print("=" * 50)
    print("方法 2: 使用 pandas")
    print("=" * 50)
    
    # 读取 CSV
    df = pd.read_csv('sample_data.csv')
    
    print("完整数据:")
    print(df)
    print("\n")
    
    print("数据信息:")
    print(df.info())
    print("\n")
    
    print("基本统计:")
    print(df.describe())
    print("\n")
    
    # 数据筛选示例
    print("年龄大于 30 的人:")
    print(df[df['年龄'] > 30])
    print("\n")
    
    # 按城市分组
    print("按城市统计人数:")
    print(df['城市'].value_counts())
    
except ImportError:
    print("pandas 未安装，跳过此方法")
    print("安装命令: pip install pandas")

print("\n")


# ============================================
# 方法 3: 使用 numpy（科学计算）
# ============================================
try:
    import numpy as np
    
    print("=" * 50)
    print("方法 3: 使用 numpy")
    print("=" * 50)
    
    # 跳过表头，读取数值数据
    data = np.genfromtxt('sample_data.csv', delimiter=',', 
                         skip_header=1, usecols=[1], encoding='utf-8')
    
    print(f"年龄数据: {data}")
    print(f"平均年龄: {np.mean(data):.1f}")
    print(f"最大年龄: {np.max(data):.0f}")
    print(f"最小年龄: {np.min(data):.0f}")
    
except ImportError:
    print("numpy 未安装，跳过此方法")
    print("安装命令: pip install numpy")


# ============================================
# 实用技巧
# ============================================
print("\n")
print("=" * 50)
print("实用技巧")
print("=" * 50)

# 1. 处理不同编码
print("\n1. 处理编码问题:")
print("   with open('file.csv', encoding='utf-8') as f:")
print("   with open('file.csv', encoding='gbk') as f:")

# 2. 写入 CSV
print("\n2. 写入 CSV 文件:")
with open('output.csv', 'w', newline='', encoding='utf-8') as file:
    writer = csv.writer(file)
    writer.writerow(['姓名', '分数'])
    writer.writerow(['小明', 95])
    writer.writerow(['小红', 88])
print("   已创建 output.csv")

# 3. 处理大文件
print("\n3. 处理大文件（逐行读取）:")
print("   with open('large.csv') as f:")
print("       reader = csv.reader(f)")
print("       for row in reader:")
print("           process(row)  # 逐行处理，节省内存")

print("\n学习会话完成！")
