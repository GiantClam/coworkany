#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
CSV 读取进阶教程 - 使用 pandas 库
pandas 是数据分析的强大工具，提供更多功能和更好的性能
"""

try:
    import pandas as pd
    
    print("=" * 60)
    print("方法 1: 使用 pandas 读取整个 CSV 文件")
    print("=" * 60)
    
    # 读取 CSV 文件到 DataFrame
    df = pd.read_csv('students.csv')
    
    # 显示前几行数据
    print("前 5 行数据:")
    print(df.head())
    
    print("\n" + "=" * 60)
    print("方法 2: 查看数据基本信息")
    print("=" * 60)
    
    print(f"\n数据形状 (行数, 列数): {df.shape}")
    print(f"\n列名: {df.columns.tolist()}")
    print(f"\n数据类型:")
    print(df.dtypes)
    
    print("\n基本统计信息:")
    print(df.describe())
    
    print("\n" + "=" * 60)
    print("方法 3: 读取特定列")
    print("=" * 60)
    
    # 选择单列
    print("\n只显示姓名列:")
    print(df['姓名'])
    
    # 选择多列
    print("\n显示姓名和成绩:")
    print(df[['姓名', '成绩']])
    
    print("\n" + "=" * 60)
    print("方法 4: 数据筛选")
    print("=" * 60)
    
    # 筛选成绩 >= 90 的学生
    high_scores = df[df['成绩'] >= 90]
    print("\n成绩 >= 90 分的学生:")
    print(high_scores[['姓名', '专业', '成绩']])
    
    # 多条件筛选
    cs_high_scores = df[(df['专业'] == '计算机科学') & (df['成绩'] >= 85)]
    print("\n计算机科学专业且成绩 >= 85 的学生:")
    print(cs_high_scores[['姓名', '成绩']])
    
    print("\n" + "=" * 60)
    print("方法 5: 数据统计和分组")
    print("=" * 60)
    
    # 计算平均成绩
    print(f"\n班级平均成绩: {df['成绩'].mean():.2f}分")
    print(f"最高成绩: {df['成绩'].max():.2f}分")
    print(f"最低成绩: {df['成绩'].min():.2f}分")
    
    # 按专业分组统计
    print("\n各专业平均成绩:")
    major_stats = df.groupby('专业')['成绩'].agg(['mean', 'count'])
    major_stats.columns = ['平均成绩', '学生人数']
    print(major_stats)
    
    print("\n" + "=" * 60)
    print("方法 6: 数据排序")
    print("=" * 60)
    
    # 按成绩降序排列
    sorted_df = df.sort_values('成绩', ascending=False)
    print("\n按成绩排名:")
    print(sorted_df[['姓名', '专业', '成绩']])
    
    print("\n" + "=" * 60)
    print("方法 7: 保存处理后的数据")
    print("=" * 60)
    
    # 保存筛选后的数据到新文件
    high_scores.to_csv('high_scores.csv', index=False, encoding='utf-8')
    print("\n已将成绩优秀的学生保存到 high_scores.csv")
    
    # 保存统计结果
    major_stats.to_csv('major_statistics.csv', encoding='utf-8')
    print("已将专业统计结果保存到 major_statistics.csv")

except ImportError:
    print("=" * 60)
    print("pandas 库未安装")
    print("=" * 60)
    print("\n要使用 pandas，请先安装:")
    print("  pip install pandas")
    print("\n或者使用 conda:")
    print("  conda install pandas")
    print("\npandas 是数据分析的强大工具，强烈推荐安装！")
