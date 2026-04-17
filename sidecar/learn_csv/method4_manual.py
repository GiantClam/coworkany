#!/usr/bin/env python3
"""方法4: 手动解析（了解底层原理）"""

print("=" * 50)
print("方法4: 手动解析 CSV 文件")
print("=" * 50)

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    lines = file.readlines()
    
    # 解析表头
    headers = lines[0].strip().split(',')
    print(f"\n表头: {headers}")
    
    # 解析数据
    print("\n数据内容:")
    for line in lines[1:]:
        values = line.strip().split(',')
        data_dict = dict(zip(headers, values))
        print(f"  {data_dict}")

print("\n" + "=" * 50)
print("方法4说明: 适合简单场景，但不处理复杂情况")
print("（如字段中包含逗号、引号等）")
print("=" * 50)
