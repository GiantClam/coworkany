# Python 读取 CSV 文件 - 学习笔记

## 📚 三种主要方法

### 方法 1: csv.reader (基础方法)
```python
import csv

with open('file.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.reader(file)
    headers = next(csv_reader)  # 跳过表头
    for row in csv_reader:
        print(row)  # row 是列表 ['值1', '值2', ...]
```

**优点**: 内置模块，无需安装  
**缺点**: 返回列表，需要记住列的索引  
**适用**: 简单的 CSV 读取任务

---

### 方法 2: csv.DictReader (字典方法)
```python
import csv

with open('file.csv', 'r', encoding='utf-8') as file:
    csv_reader = csv.DictReader(file)
    for row in csv_reader:
        print(row['列名'])  # row 是字典 {'列名': '值'}
```

**优点**: 可以用列名访问数据，代码更清晰  
**缺点**: 比 csv.reader 稍慢  
**适用**: 需要按列名访问数据

---

### 方法 3: pandas.read_csv (数据分析方法)
```python
import pandas as pd

df = pd.read_csv('file.csv')
print(df.head())           # 查看前几行
print(df['列名'].mean())   # 计算平均值
print(df[df['年龄'] > 25]) # 筛选数据
```

**优点**: 功能强大，支持数据分析、筛选、统计  
**缺点**: 需要安装 pandas (pip install pandas)  
**适用**: 数据分析、数据处理任务

---

## 🔧 常用参数

### csv 模块参数
```python
csv.reader(file, delimiter=',', quotechar='"')
# delimiter: 分隔符 (默认逗号)
# quotechar: 引号字符
```

### pandas 参数
```python
pd.read_csv(
    'file.csv',
    encoding='utf-8',      # 编码
    sep=',',               # 分隔符
    header=0,              # 表头行号
    names=['列1', '列2'],  # 自定义列名
    usecols=[0, 1, 2],     # 只读取指定列
    skiprows=1,            # 跳过前 N 行
    nrows=100              # 只读取前 N 行
)
```

---

## 💡 实用技巧

### 1. 处理不同编码
```python
# 常见编码: utf-8, gbk, gb2312
with open('file.csv', 'r', encoding='gbk') as file:
    reader = csv.reader(file)
```

### 2. 处理大文件 (逐行读取)
```python
with open('large.csv', 'r') as file:
    reader = csv.reader(file)
    for row in reader:
        process(row)  # 逐行处理，不占用大量内存
```

### 3. 写入 CSV
```python
import csv

with open('output.csv', 'w', encoding='utf-8', newline='') as file:
    writer = csv.writer(file)
    writer.writerow(['列1', '列2'])  # 写入表头
    writer.writerow(['值1', '值2'])  # 写入数据
```

---

## 📊 选择建议

| 场景 | 推荐方法 |
|------|---------|
| 简单读取，性能优先 | csv.reader |
| 需要列名访问 | csv.DictReader |
| 数据分析、统计 | pandas |
| 大文件处理 | csv.reader (逐行) |
| 复杂数据清洗 | pandas |

---

## 🎯 练习文件

- `sample_data.csv` - 示例数据文件
- `learn_csv_reading.py` - 学习脚本

运行命令: `python3 learn_csv_reading.py`