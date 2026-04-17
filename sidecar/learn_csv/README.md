# Python CSV 读取学习指南

## 📚 学习目标
掌握使用 Python 读取和处理 CSV 文件的两种主要方法

## 📁 文件说明

- `sample_data.csv` - 示例数据文件
- `method1_csv_module.py` - 标准库 csv 模块示例
- `method2_pandas.py` - pandas 库示例
- `exercise.py` - 练习题（待完成）

## 🎯 核心知识点

### 方法1: csv 模块（标准库）
```python
import csv

# csv.reader - 返回列表
with open('file.csv', 'r', encoding='utf-8') as f:
    reader = csv.reader(f)
    for row in reader:
        print(row)  # ['值1', '值2', '值3']

# csv.DictReader - 返回字典（推荐）
with open('file.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        print(row['列名'])  # 通过列名访问
```

### 方法2: pandas（数据分析首选）
```python
import pandas as pd

df = pd.read_csv('file.csv')
print(df.head())           # 查看前5行
print(df['列名'])          # 访问列
print(df[df['年龄'] > 30]) # 条件筛选
print(df['列名'].mean())   # 统计计算
```

## 🚀 快速开始

1. 运行标准库示例：
```bash
python3 method1_csv_module.py
```

2. 运行 pandas 示例：
```bash
python3 method2_pandas.py
```

3. 完成练习题：
```bash
python3 exercise.py
```

## 💡 常见问题

**Q: 中文乱码怎么办？**
A: 指定正确的编码：`encoding='utf-8'` 或 `encoding='gbk'`

**Q: 什么时候用 csv，什么时候用 pandas？**
A: 简单读取用 csv，数据分析用 pandas

**Q: 如何处理缺失值？**
A: pandas 中使用 `na_values` 参数或 `dropna()` 方法
