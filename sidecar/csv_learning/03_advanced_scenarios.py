"""
高级场景和最佳实践
"""

import csv
import pandas as pd
from pathlib import Path

print("=" * 50)
print("场景 1: 处理大文件（逐行读取）")
print("=" * 50)

# 对于大文件，不要一次性加载到内存
def process_large_csv(filename, chunk_size=1000):
    """逐块处理大 CSV 文件"""
    for chunk in pd.read_csv(filename, chunksize=chunk_size):
        # 处理每个数据块
        print(f"处理 {len(chunk)} 行数据")
        # 这里可以进行数据处理
        
# 示例（使用小文件演示）
process_large_csv('sample_data_en.csv', chunk_size=2)

print("\n" + "=" * 50)
print("场景 2: 处理缺失值")
print("=" * 50)

# 创建包含缺失值的 CSV
with open('data_with_missing.csv', 'w', encoding='utf-8') as f:
    f.write("name,age,city,salary\n")
    f.write("Alice,28,Beijing,15000\n")
    f.write("Bob,,Shanghai,22000\n")  # 缺失年龄
    f.write("Charlie,42,,28000\n")    # 缺失城市
    f.write("David,31,Hangzhou,\n")   # 缺失薪资

df = pd.read_csv('data_with_missing.csv')
print("原始数据（包含缺失值）:")
print(df)
print()

print("缺失值统计:")
print(df.isnull().sum())
print()

# 填充缺失值
df_filled = df.fillna({
    'age': df['age'].mean(),
    'city': 'Unknown',
    'salary': 0
})
print("填充后的数据:")
print(df_filled)

print("\n" + "=" * 50)
print("场景 3: 处理不同编码")
print("=" * 50)

def read_csv_auto_encoding(filename):
    """自动检测编码并读取"""
    encodings = ['utf-8', 'gbk', 'gb2312', 'latin1']
    
    for encoding in encodings:
        try:
            df = pd.read_csv(filename, encoding=encoding)
            print(f"成功使用 {encoding} 编码读取")
            return df
        except UnicodeDecodeError:
            continue
    
    raise ValueError("无法识别文件编码")

# 测试
df = read_csv_auto_encoding('sample_data.csv')
print(df.head())

print("\n" + "=" * 50)
print("场景 4: 导出处理后的数据")
print("=" * 50)

df = pd.read_csv('sample_data_en.csv')

# 数据处理
df['age_group'] = df['age'].apply(lambda x: '青年' if x < 30 else '中年')

# 导出为新的 CSV
df.to_csv('processed_data.csv', index=False, encoding='utf-8')
print("已导出处理后的数据到 processed_data.csv")

# 导出为 Excel（需要 openpyxl 库）
try:
    df.to_excel('processed_data.xlsx', index=False)
    print("已导出为 Excel 格式")
except ImportError:
    print("提示: 安装 openpyxl 可导出 Excel 格式: pip install openpyxl")

print("\n" + "=" * 50)
print("场景 5: 错误处理和验证")
print("=" * 50)

def safe_read_csv(filename):
    """安全读取 CSV 文件"""
    try:
        # 检查文件是否存在
        if not Path(filename).exists():
            raise FileNotFoundError(f"文件不存在: {filename}")
        
        # 读取文件
        df = pd.read_csv(filename, encoding='utf-8')
        
        # 验证数据
        if df.empty:
            raise ValueError("CSV 文件为空")
        
        print(f"成功读取 {filename}")
        print(f"数据形状: {df.shape}")
        return df
        
    except FileNotFoundError as e:
        print(f"错误: {e}")
    except pd.errors.EmptyDataError:
        print("错误: CSV 文件没有数据")
    except pd.errors.ParserError:
        print("错误: CSV 文件格式错误")
    except Exception as e:
        print(f"未知错误: {e}")
    
    return None

# 测试
df = safe_read_csv('sample_data_en.csv')
df_not_exist = safe_read_csv('not_exist.csv')
