"""
方法二：使用 pandas 库
适用场景：需要数据分析、处理、统计的场景
优势：功能强大，支持数据清洗、转换、分析
"""

import pandas as pd

print("=" * 50)
print("1. 基础读取 - pd.read_csv()")
print("=" * 50)

# 读取 CSV 文件
df = pd.read_csv('sample_data_en.csv')
print("完整数据:")
print(df)
print()

# 查看数据信息
print("数据信息:")
print(df.info())
print()

# 查看前几行
print("前 3 行:")
print(df.head(3))

print("\n" + "=" * 50)
print("2. 数据访问和筛选")
print("=" * 50)

# 访问单列
print("所有姓名:")
print(df['name'])
print()

# 访问多列
print("姓名和城市:")
print(df[['name', 'city']])
print()

# 条件筛选
print("年龄大于 30 的人:")
print(df[df['age'] > 30])
print()

# 统计信息
print("数值列统计:")
print(df.describe())

print("\n" + "=" * 50)
print("3. 处理中文 CSV")
print("=" * 50)

df_cn = pd.read_csv('sample_data.csv')
print(df_cn)
print()

# 中文列名访问
print("所有职业:")
print(df_cn['职业'].unique())

print("\n" + "=" * 50)
print("4. 处理常见问题")
print("=" * 50)

# 指定编码
df_utf8 = pd.read_csv('sample_data.csv', encoding='utf-8')
print("指定 UTF-8 编码读取成功")

# 指定分隔符
df_semicolon = pd.read_csv('sample_semicolon.csv', sep=';')
print("\n使用分号分隔符:")
print(df_semicolon)

# 跳过行
df_skip = pd.read_csv('sample_data_en.csv', skiprows=1)
print("\n跳过第一行后:")
print(df_skip.head(2))

# 只读取指定列
df_cols = pd.read_csv('sample_data_en.csv', usecols=['name', 'age'])
print("\n只读取 name 和 age 列:")
print(df_cols)

print("\n" + "=" * 50)
print("5. 数据处理示例")
print("=" * 50)

df = pd.read_csv('sample_data_en.csv')

# 添加新列
df['salary_k'] = df['salary'] / 1000
print("添加薪资（千元）列:")
print(df)
print()

# 分组统计
print("按城市统计平均薪资:")
city_avg = df.groupby('city')['salary'].mean()
print(city_avg)
