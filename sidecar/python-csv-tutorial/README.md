# Python CSV 读取教程

这是一个完整的 Python CSV 文件读取学习示例，包含从基础到进阶的各种方法。

## 📁 文件说明

- `students.csv` - 示例数据文件（学生信息）
- `read_csv_basic.py` - 使用内置 csv 模块的基础示例
- `read_csv_pandas.py` - 使用 pandas 库的进阶示例
- `README.md` - 本说明文件

## 🚀 快速开始

### 1. 运行基础示例（无需安装额外库）

```bash
python read_csv_basic.py
```

这个示例展示了：
- ✅ 使用 `csv.reader()` 读取整个文件
- ✅ 使用 `csv.DictReader()` 以字典格式读取（推荐）
- ✅ 读取特定列
- ✅ 数据处理和计算（如平均成绩）
- ✅ 条件筛选
- ✅ 数据分组统计

### 2. 运行进阶示例（需要 pandas）

首先安装 pandas：

```bash
pip install pandas
```

然后运行：

```bash
python read_csv_pandas.py
```

这个示例展示了：
- ✅ 使用 pandas 读取 CSV
- ✅ 查看数据基本信息和统计
- ✅ 选择特定列
- ✅ 数据筛选（单条件和多条件）
- ✅ 分组统计
- ✅ 数据排序
- ✅ 保存处理后的数据

## 📚 学习路径

### 初学者
1. 先运行 `read_csv_basic.py`，理解基本的 CSV 读取方法
2. 重点学习 `csv.DictReader()`，这是最实用的方法
3. 尝试修改代码，读取不同的列或添加新的筛选条件

### 进阶学习
1. 安装 pandas 并运行 `read_csv_pandas.py`
2. pandas 提供了更强大的数据分析功能
3. 学习 DataFrame 的各种操作方法

## 💡 核心知识点

### 使用内置 csv 模块

```python
import csv

# 方法 1: csv.reader() - 返回列表
with open('file.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    for row in reader:
        print(row)  # row 是列表

# 方法 2: csv.DictReader() - 返回字典（推荐）
with open('file.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(row['列名'])  # row 是字典
```

### 使用 pandas

```python
import pandas as pd

# 读取 CSV
df = pd.read_csv('file.csv')

# 查看数据
print(df.head())  # 前 5 行
print(df.shape)   # 形状
print(df.columns) # 列名

# 选择列
df['列名']
df[['列1', '列2']]

# 筛选
df[df['成绩'] >= 90]

# 统计
df['成绩'].mean()
df.groupby('专业')['成绩'].mean()
```

## 🎯 实践建议

1. **编码问题**: 中文 CSV 文件记得指定 `encoding='utf-8'`
2. **选择工具**: 
   - 简单读取 → 使用 `csv.DictReader()`
   - 数据分析 → 使用 `pandas`
3. **性能**: pandas 处理大文件更快，功能更强大
4. **错误处理**: 实际项目中要添加 try-except 处理异常

## 🔧 常见问题

**Q: 为什么推荐使用 DictReader 而不是 reader？**  
A: DictReader 返回字典，可以通过列名访问数据，代码更清晰易读。

**Q: 什么时候用 csv 模块，什么时候用 pandas？**  
A: 简单读取用 csv 模块；需要数据分析、统计、处理用 pandas。

**Q: 如何处理大文件？**  
A: 使用 pandas 的 `chunksize` 参数分块读取，或使用 csv 模块逐行处理。

## 📖 扩展学习

- 学习如何写入 CSV 文件（`csv.writer()`, `df.to_csv()`）
- 学习处理不同分隔符的文件（TSV, 自定义分隔符）
- 学习处理缺失值和数据清洗
- 学习 pandas 的更多数据分析功能

## 🎓 练习建议

1. 修改 `students.csv`，添加更多数据
2. 尝试读取其他格式的 CSV 文件
3. 编写代码实现新的统计功能
4. 尝试处理包含缺失值的数据

祝学习愉快！🎉
