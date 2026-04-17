#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Python CSV 读取学习示例
"""

import csv
import os

# ============================================
# 示例 1: 创建一个示例 CSV 文件
# ============================================
def create_sample_csv():
    """创建示例 CSV 文件"""
    data = [
        ['姓名', '年龄', '城市', '职业'],
        ['张三', '28', '北京', '工程师'],
        ['李四', '32', '上海', '设计师'],
        ['王五', '25', '深圳', '产品经理'],
        ['赵六', '30', '杭州', '数据分析师']
    ]
    
    with open('sample_data.csv', 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerows(data)
    
    print("✓ 已创建 sample_data.csv")


# ============================================
# 示例 2: 使用 csv.reader 读取
# ============================================
def read_with_csv_reader():
    """使用 csv.reader 读取 CSV"""
    print("\n=== 方法 1: csv.reader ===")
    
    with open('sample_data.csv', 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        
        # 读取表头
        headers = next(reader)
        print(f"表头: {headers}")
        
        # 读取数据行
        print("\n数据行:")
        for i, row in enumerate(reader, 1):
            print(f"第 {i} 行: {row}")


# ============================================
# 示例 3: 使用 csv.DictReader 读取（推荐）
# ============================================
def read_with_dict_reader():
    """使用 csv.DictReader 读取 CSV"""
    print("\n=== 方法 2: csv.DictReader (推荐) ===")
    
    with open('sample_data.csv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        
        print("\n以字典形式读取:")
        for row in reader:
            print(f"{row['姓名']}, {row['年龄']}岁, 来自{row['城市']}, 职业: {row['职业']}")


# ============================================
# 示例 4: 使用 pandas 读取（需要安装: pip install pandas）
# ============================================
def read_with_pandas():
    """使用 pandas 读取 CSV"""
    print("\n=== 方法 3: pandas ===")
    
    try:
        import pandas as pd
        
        # 读取 CSV
        df = pd.read_csv('sample_data.csv')
        
        print("\n完整数据:")
        print(df)
        
        print("\n数据信息:")
        print(f"行数: {len(df)}")
        print(f"列名: {df.columns.tolist()}")
        
        print("\n筛选年龄大于 28 的记录:")
        filtered = df[df['年龄'] > 28]
        print(filtered)
        
    except ImportError:
        print("未安装 pandas，跳过此示例")
        print("安装命令: pip install pandas")


# ============================================
# 示例 5: 处理不同分隔符的文件
# ============================================
def read_tsv_file():
    """读取 TSV (Tab 分隔) 文件"""
    print("\n=== 示例 4: 读取 TSV 文件 ===")
    
    # 创建 TSV 示例
    with open('sample_data.tsv', 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f, delimiter='\t')
        writer.writerow(['ID', 'Name', 'Score'])
        writer.writerow(['1', 'Alice', '95'])
        writer.writerow(['2', 'Bob', '87'])
    
    print("✓ 已创建 sample_data.tsv")
    
    # 读取 TSV
    with open('sample_data.tsv', 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f, delimiter='\t')
        for row in reader:
            print(row)


# ============================================
# 主程序
# ============================================
if __name__ == '__main__':
    print("Python CSV 读取学习示例\n")
    print("=" * 50)
    
    # 创建示例文件
    create_sample_csv()
    
    # 演示不同的读取方法
    read_with_csv_reader()
    read_with_dict_reader()
    read_with_pandas()
    read_tsv_file()
    
    print("\n" + "=" * 50)
    print("学习完成！")
    print("\n提示:")
    print("- 小文件用 csv 模块就够了")
    print("- 大数据或需要数据分析用 pandas")
    print("- DictReader 比 reader 更易读")
    print("- 记得指定正确的 encoding")
