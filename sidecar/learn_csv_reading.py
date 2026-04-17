"""
Python CSV 文件读取学习会话
===========================

CSV (Comma-Separated Values) 是一种常见的数据存储格式。
Python 提供了多种方式来读取 CSV 文件。
"""

# 方法 1: 使用内置的 csv 模块
import csv

def read_csv_with_csv_module(filename):
    """使用标准库 csv 模块读取"""
    print(f"\n=== 方法 1: csv 模块读取 {filename} ===")
    
    with open(filename, 'r', encoding='utf-8') as file:
        # 创建 CSV 读取器
        csv_reader = csv.reader(file)
        
        # 读取表头
        headers = next(csv_reader)
        print(f"表头: {headers}")
        
        # 读取数据行
        for row in csv_reader:
            print(row)

def read_csv_as_dict(filename):
    """使用 DictReader 以字典形式读取"""
    print(f"\n=== 方法 2: DictReader 读取 {filename} ===")
    
    with open(filename, 'r', encoding='utf-8') as file:
        csv_reader = csv.DictReader(file)
        
        for row in csv_reader:
            print(row)  # 每行是一个字典


# 方法 3: 使用 pandas (功能更强大)
try:
    import pandas as pd
    
    def read_csv_with_pandas(filename):
        """使用 pandas 读取 CSV"""
        print(f"\n=== 方法 3: pandas 读取 {filename} ===")
        
        # 读取 CSV 文件
        df = pd.read_csv(filename)
        
        # 显示基本信息
        print(f"数据形状: {df.shape}")
        print(f"\n前 5 行数据:")
        print(df.head())
        
        # 访问特定列
        if len(df.columns) > 0:
            first_col = df.columns[0]
            print(f"\n第一列 '{first_col}' 的数据:")
            print(df[first_col])
        
        return df
    
except ImportError:
    print("pandas 未安装，跳过 pandas 示例")
    read_csv_with_pandas = None


# 创建示例 CSV 文件用于演示
def create_sample_csv():
    """创建示例 CSV 文件"""
    sample_data = [
        ['姓名', '年龄', '城市'],
        ['张三', '25', '北京'],
        ['李四', '30', '上海'],
        ['王五', '28', '深圳']
    ]
    
    filename = 'sample_data.csv'
    with open(filename, 'w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerows(sample_data)
    
    print(f"已创建示例文件: {filename}")
    return filename


# 主程序
if __name__ == "__main__":
    print("Python CSV 文件读取学习会话")
    print("=" * 50)
    
    # 创建示例文件
    sample_file = create_sample_csv()
    
    # 演示三种读取方法
    read_csv_with_csv_module(sample_file)
    read_csv_as_dict(sample_file)
    
    if read_csv_with_pandas:
        read_csv_with_pandas(sample_file)
    
    print("\n" + "=" * 50)
    print("学习要点:")
    print("1. csv.reader() - 返回列表形式的行")
    print("2. csv.DictReader() - 返回字典形式的行，键为列名")
    print("3. pandas.read_csv() - 返回 DataFrame，功能最强大")
    print("4. 记得使用 encoding='utf-8' 处理中文")
    print("5. 使用 with 语句自动关闭文件")
