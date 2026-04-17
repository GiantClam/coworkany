# Python CSV 读取学习指南

## 📁 文件说明

- `sample_data.csv` - 示例数据文件
- `method1_csv_module.py` - 使用标准库 csv 模块
- `method2_pandas.py` - 使用 pandas 库

## 🚀 快速开始

### 方法一：csv 模块（无需安装额外库）

```bash
python method1_csv_module.py
```

### 方法二：pandas（需要先安装）

```bash
pip install pandas
python method2_pandas.py
```

## 📚 学习要点

### csv 模块
- ✅ 标准库，无需安装
- ✅ 适合简单的 CSV 读写
- ✅ 内存占用小
- ❌ 功能相对有限

### pandas
- ✅ 功能强大，适合数据分析
- ✅ 支持复杂的数据操作
- ✅ 可以轻松筛选、排序、统计
- ❌ 需要额外安装

## 💡 实践建议

1. 先运行 `method1_csv_module.py` 了解基础用法
2. 如果需要数据分析，再学习 pandas
3. 尝试修改代码，添加自己的筛选条件
4. 创建自己的 CSV 文件进行练习

## 🔧 常见问题

**编码问题**：如果遇到乱码，尝试使用 `encoding='gbk'` 或 `encoding='utf-8-sig'`

**路径问题**：确保 Python 脚本和 CSV 文件在同一目录下
