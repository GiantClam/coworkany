import pandas as pd

# 基本读取
df = pd.read_csv('sample.csv')
print("基本读取:")
print(df.head())
print(f"\n形状: {df.shape}")
print(f"列名: {list(df.columns)}")

# 指定编码
df_encoded = pd.read_csv('sample.csv', encoding='utf-8')

# 跳过行
df_skip = pd.read_csv('sample.csv', skiprows=1)

# 指定列
df_cols = pd.read_csv('sample.csv', usecols=['col1', 'col2'])

# 处理缺失值
df_na = pd.read_csv('sample.csv', na_values=['NA', 'null', ''])

print("\n读取成功！")
