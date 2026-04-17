"""
方法3: 处理常见问题和高级用法
"""
import csv
import pandas as pd

# 1. 处理不同编码
print("1. 处理不同编码的文件:")
try:
    with open('sample_data.csv', 'r', encoding='gbk') as file:
        pass
except UnicodeDecodeError:
    print("   GBK 编码失败，尝试 UTF-8")
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        print("   UTF-8 编码成功")

print("\n" + "="*50 + "\n")

# 2. 处理不同分隔符
print("2. pandas 读取不同分隔符:")
# df = pd.read_csv('file.csv', sep=';')  # 分号分隔
# df = pd.read_csv('file.csv', sep='\t')  # Tab 分隔
print("   使用 sep 参数指定分隔符")

print("\n" + "="*50 + "\n")

# 3. 跳过行和指定列
print("3. pandas 高级参数:")
df = pd.read_csv('sample_data.csv', 
                 usecols=['name', 'salary'],  # 只读取指定列
                 skiprows=0)  # 跳过前 N 行（不包括表头）
print(df)

print("\n" + "="*50 + "\n")

# 4. 处理缺失值
print("4. 处理缺失值:")
# df = pd.read_csv('file.csv', na_values=['NA', 'null', ''])
print("   使用 na_values 参数指定缺失值标记")

print("\n" + "="*50 + "\n")

# 5. 大文件分块读取
print("5. 大文件分块读取:")
chunk_size = 2
for i, chunk in enumerate(pd.read_csv('sample_data.csv', chunksize=chunk_size)):
    print(f"   第 {i+1} 块数据:")
    print(chunk)
    print()
