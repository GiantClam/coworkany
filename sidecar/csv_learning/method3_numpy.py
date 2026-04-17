#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
方法3: 使用 numpy 库
优点: 高性能数值计算
适用: 纯数值数据的科学计算
"""

try:
    import numpy as np
    
    print("=" * 50)
    print("方法3: 使用 numpy 库")
    print("=" * 50)
    
    # 读取 CSV (跳过表头，只读数值列)
    data = np.genfromtxt('sample_data.csv', delimiter=',', skip_header=1, usecols=(1, 3))
    
    print("\n3.1 读取的数值数据 (年龄和薪资):")
    print(data)
    
    print("\n3.2 计算平均值:")
    print(f"平均年龄: {data[:, 0].mean():.2f}")
    print(f"平均薪资: {data[:, 1].mean():.2f}")
    
    print("\n3.3 计算最大值和最小值:")
    print(f"年龄范围: {data[:, 0].min():.0f} - {data[:, 0].max():.0f}")
    print(f"薪资范围: {data[:, 1].min():.0f} - {data[:, 1].max():.0f}")
    
except ImportError:
    print("numpy 未安装。安装命令: pip install numpy")
