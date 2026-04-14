"""
示例1: 使用标准库 csv 模块读取 CSV 文件
优点: 无需安装额外依赖，轻量级
"""
import csv

print("=" * 50)
print("方法1: 使用 csv.reader (返回列表)")
print("=" * 50)

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    
    # 读取表头
    headers = next(csv_reader)
    print(f"表头: {headers}\n")
    
    # 逐行读取数据
    for i, row in enumerate(csv_reader, 1):
        print(f"第 {i} 行: {row}")

print("\n" + "=" * 50)
print("方法2: 使用 csv.DictReader (返回字典)")
print("=" * 50)

with open('sample_data.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    
    for i, row in enumerate(csv_reader, 1):
        print(f"\n第 {i} 行:")
        print(f"  姓名: {row['姓名']}")
        print(f"  年龄: {row['年龄']}")
        print(f"  城市: {row['城市']}")
        print(f"  职业: {row['职业']}")
