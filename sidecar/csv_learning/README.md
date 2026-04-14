# Python CSV 读取学习指南

## 学习目标
掌握使用 Python 读取 CSV 文件的两种主要方法

## 文件说明
- `sample_data.csv` - 示例数据文件
- `example1_csv_module.py` - 使用标准库 csv 模块
- `example2_pandas.py` - 使用 pandas 库

## 运行步骤

### 1. 运行标准库示例
```bash
cd csv_learning
python example1_csv_module.py
```

### 2. 运行 pandas 示例（需要先安装 pandas）
```bash
pip install pandas
python example2_pandas.py
```

## 两种方法对比

| 特性 | csv 模块 | pandas |
|------|---------|--------|
| 安装 | 无需安装 | 需要安装 |
| 学习曲线 | 简单 | 中等 |
| 功能 | 基础读写 | 强大的数据分析 |
| 适用场景 | 简单数据处理 | 复杂数据分析 |
| 性能 | 较快 | 大文件更优 |

## 练习建议
1. 先运行两个示例，观察输出
2. 修改 sample_data.csv，添加更多数据
3. 尝试读取自己的 CSV 文件
4. 练习数据筛选和统计操作
