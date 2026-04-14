#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
使用 pandas 读取 CSV 文件的示例
需要先安装: pip install pandas
"""

import pandas as pd

def example1_basic_read():
    """示例1：基本读取"""
    print("=" * 50)
    print("示例1：基本读取 CSV 文件")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    print("前3行数据:")
    print(df.head(3))
    print()


def example2_data_info():
    """示例2：查看数据信息"""
    print("=" * 50)
    print("示例2：查看数据信息")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    
    print("数据形状:", df.shape)
    print("\n列名:", df.columns.tolist())
    print("\n数据类型:")
    print(df.dtypes)
    print("\n统计信息:")
    print(df.describe())
    print()


def example3_column_access():
    """示例3：访问列数据"""
    print("=" * 50)
    print("示例3：访问列数据")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    
    print("所有姓名:")
    print(df['name'].tolist())
    
    print("\n姓名和城市:")
    print(df[['name', 'city']])
    print()


def example4_filter_data():
    """示例4：筛选数据"""
    print("=" * 50)
    print("示例4：筛选年龄大于30的员工")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    filtered = df[df['age'] > 30]
    print(filtered)
    print()
    
    print("多条件筛选（年龄>30 且 工资>10000）:")
    filtered2 = df[(df['age'] > 30) & (df['salary'] > 10000)]
    print(filtered2)
    print()


def example5_groupby():
    """示例5：分组统计"""
    print("=" * 50)
    print("示例5：按城市分组统计")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    
    print("各城市平均工资:")
    city_avg = df.groupby('city')['salary'].mean()
    print(city_avg)
    print()
    
    print("各城市人数:")
    city_count = df.groupby('city').size()
    print(city_count)
    print()


def example6_calculate():
    """示例6：计算新列"""
    print("=" * 50)
    print("示例6：计算新列")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    
    # 计算年薪
    df['annual_salary'] = df['salary'] * 12
    
    # 年龄分组
    df['age_group'] = pd.cut(df['age'], bins=[0, 30, 40, 100], 
                              labels=['青年', '中年', '老年'])
    
    print(df[['name', 'age', 'age_group', 'salary', 'annual_salary']])
    print()


def example7_sort():
    """示例7：排序"""
    print("=" * 50)
    print("示例7：按工资降序排序")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    sorted_df = df.sort_values('salary', ascending=False)
    print(sorted_df[['name', 'salary']])
    print()


def example8_export():
    """示例8：导出数据"""
    print("=" * 50)
    print("示例8：导出筛选后的数据")
    print("=" * 50)
    
    df = pd.read_csv('sample_data.csv')
    high_salary = df[df['salary'] > 10000]
    
    # 导出为新的 CSV 文件
    high_salary.to_csv('high_salary.csv', index=False, encoding='utf-8')
    print("✅ 已导出高薪员工数据到 high_salary.csv")
    print(f"共 {len(high_salary)} 条记录")
    print()


if __name__ == '__main__':
    print("\n🎓 Pandas 学习示例\n")
    
    try:
        example1_basic_read()
        example2_data_info()
        example3_column_access()
        example4_filter_data()
        example5_groupby()
        example6_calculate()
        example7_sort()
        example8_export()
        
        print("✅ 所有示例运行完成！")
        
    except ImportError:
        print("❌ 错误: 未安装 pandas 库")
        print("请运行: pip install pandas")
    except Exception as e:
        print(f"❌ 错误: {e}")
