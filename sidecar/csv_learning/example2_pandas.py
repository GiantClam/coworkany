"""
示例2: 使用 pandas 读取 CSV 文件
优点: 功能强大，适合数据分析
需要安装: pip install pandas
"""
import pandas as pd

print("=" * 50)
print("使用 pandas 读取 CSV")
print("=" * 50)

# 读取 CSV 文件
df = pd.read_csv('sample_data.csv')

print("\n1. 查看前几行数据:")
print(df.head())

print("\n2. 查看数据信息:")
print(df.info())

print("\n3. 查看数据统计:")
print(df.describe())

print("\n4. 访问特定列:")
print(df['姓名'])

print("\n5. 筛选数据 (年龄大于 28):")
print(df[df['年龄'] > 28])

print("\n6. 按城市分组统计:")
print(df.groupby('城市')['年龄'].mean())
