#!/usr/bin/env python3
"""方法3: 使用 pandas 库读取（功能最强大）"""

try:
    import pandas as pd
    
    print("=" * 50)
    print("方法3: 使用 pandas 读取 CSV")
    print("=" * 50)
    
    # 读取 CSV 文件
    df = pd.read_csv('sample_data.csv')
    
    print("\n完整数据表:")
    print(df)
    
    print("\n数据统计信息:")
    print(df.describe())
    
    print("\n按城市筛选（北京）:")
    beijing_data = df[df['城市'] == '北京']
    print(beijing_data)
    
    print("\n" + "=" * 50)
    print("方法3优点: 功能强大，支持数据分析和处理")
    print("需要安装: pip install pandas")
    print("=" * 50)
    
except ImportError:
    print("\n⚠️  pandas 未安装")
    print("安装命令: pip install pandas")
