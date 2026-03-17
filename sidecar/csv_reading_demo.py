#!/usr/bin/env python3
"""
Python CSV 文件读取示例
展示使用标准库 csv 模块和 pandas 库读取 CSV 文件
"""

# 方法 1: 使用标准库 csv 模块
import csv

def read_csv_with_csv_module(filename):
    """使用 csv 模块读取 CSV 文件"""
    with open(filename, 'r', encoding='utf-8') as file:
        csv_reader = csv.reader(file)
        headers = next(csv_reader)  # 读取表头
        print(f"表头: {headers}")
        
        for row in csv_reader:
            print(row)

# 方法 2: 使用 csv.DictReader
def read_csv_as_dict(filename):
    """使用 DictReader 将每行读取为字典"""
    with open(filename, 'r', encoding='utf-8') as file:
        csv_reader = csv.DictReader(file)
        for row in csv_reader:
            print(row)  # 每行是一个字典

# 方法 3: 使用 pandas（需要安装: pip install pandas）
def read_csv_with_pandas(filename):
    """使用 pandas 读取 CSV 文件"""
    import pandas as pd
    
    df = pd.read_csv(filename)
    print(df.head())  # 显示前 5 行
    print(f"\n数据形状: {df.shape}")
    print(f"列名: {df.columns.tolist()}")
    
    return df

# 创建示例 CSV 文件
def create_sample_csv():
    """创建一个示例 CSV 文件用于测试"""
    with open('sample.csv', 'w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['姓名', '年龄', '城市'])
        writer.writerow(['张三', '25', '北京'])
        writer.writerow(['李四', '30', '上海'])
        writer.writerow(['王五', '28', '深圳'])
    print("示例文件 sample.csv 已创建")

if __name__ == '__main__':
    # 创建示例文件
    create_sample_csv()
    
    print("\n=== 方法 1: csv.reader ===")
    read_csv_with_csv_module('sample.csv')
    
    print("\n=== 方法 2: csv.DictReader ===")
    read_csv_as_dict('sample.csv')
    
    print("\n=== 方法 3: pandas ===")
    try:
        read_csv_with_pandas('sample.csv')
    except ImportError:
        print("pandas 未安装，跳过此方法")
