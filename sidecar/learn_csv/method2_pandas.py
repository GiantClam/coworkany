#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""方法2: 使用 pandas 库（功能更强大）"""

try:
    import pandas as pd
    
    print("=" * 50)
    print("使用 pandas 读取 CSV")
    print("=" * 50)
    
    # 读取 CSV 文件
    df = pd.read_csv('sample_data.csv')
    
    print("\n1. 显示前几行:")
    print(df.head())
    
    print("\n2. 数据信息:")
    print(df.info())
    
    print("\n3. 统计摘要:")
    print(df.describe())
    
    print("\n4. 访问单列:")
    print(df['姓名'])
    
    print("\n5. 条件筛选（年龄大于30）:")
    print(df[df['年龄'] > 30])
    
    print("\n6. 计算平均年龄:")
    print(f"平均年龄: {df['年龄'].mean():.1f} 岁")
    
except ImportError:
    print("❌ pandas 未安装")
    print("请运行: pip install pandas")
