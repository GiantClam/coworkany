#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方法二：使用 pandas 读取 CSV（需要先安装：pip install pandas）
"""

try:
    import pandas as pd
    
    print("=" * 50)
    print("使用 pandas 读取 CSV")
    print("=" * 50)
    
    # 读取 CSV
    df = pd.read_csv('sample_data.csv')
    
    print("\n1. 查看前几行:")
    print(df.head())
    
    print("\n2. 查看数据信息:")
    print(df.info())
    
    print("\n3. 查看统计信息:")
    print(df.describe())
    
    print("\n4. 访问特定列:")
    print(df['name'])
    
    print("\n5. 筛选数据（年龄 > 30）:")
    filtered = df[df['age'] > 30]
    print(filtered)
    
    print("\n6. 按薪资排序:")
    sorted_df = df.sort_values('salary', ascending=False)
    print(sorted_df)
    
    print("\n7. 计算平均薪资:")
    avg_salary = df['salary'].mean()
    print(f"平均薪资: {avg_salary:.2f}")
    
    # 保存处理后的数据
    filtered.to_csv('filtered_output.csv', index=False)
    print("\n已保存筛选结果到 filtered_output.csv")
    
except ImportError:
    print("未安装 pandas 库")
    print("请运行: pip install pandas")
