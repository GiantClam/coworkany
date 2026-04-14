#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
使用 csv 模块读取 CSV 文件的示例
"""

import csv

def example1_basic_reader():
    """示例1：基本的 csv.reader 用法"""
    print("=" * 50)
    print("示例1：使用 csv.reader 读取（返回列表）")
    print("=" * 50)
    
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        csv_reader = csv.reader(file)
        for i, row in enumerate(csv_reader):
            print(f"第 {i} 行: {row}")
            if i >= 2:  # 只显示前3行
                break
    print()


def example2_dict_reader():
    """示例2：使用 DictReader 读取（返回字典）"""
    print("=" * 50)
    print("示例2：使用 csv.DictReader 读取（返回字典）")
    print("=" * 50)
    
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        csv_reader = csv.DictReader(file)
        for i, row in enumerate(csv_reader):
            print(f"姓名: {row['name']}, 年龄: {row['age']}, 城市: {row['city']}")
            if i >= 2:  # 只显示前3行
                break
    print()


def example3_skip_header():
    """示例3：跳过表头"""
    print("=" * 50)
    print("示例3：跳过表头行")
    print("=" * 50)
    
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        csv_reader = csv.reader(file)
        header = next(csv_reader)  # 读取并跳过表头
        print(f"表头: {header}")
        print("数据行:")
        for i, row in enumerate(csv_reader):
            print(f"  {row}")
            if i >= 2:  # 只显示前3行
                break
    print()


def example4_filter_data():
    """示例4：筛选数据"""
    print("=" * 50)
    print("示例4：筛选年龄大于30的员工")
    print("=" * 50)
    
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        csv_reader = csv.DictReader(file)
        for row in csv_reader:
            if int(row['age']) > 30:
                print(f"{row['name']} - {row['age']}岁 - {row['city']}")
    print()


def example5_calculate():
    """示例5：计算统计信息"""
    print("=" * 50)
    print("示例5：计算平均工资")
    print("=" * 50)
    
    total_salary = 0
    count = 0
    
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        csv_reader = csv.DictReader(file)
        for row in csv_reader:
            total_salary += int(row['salary'])
            count += 1
    
    average_salary = total_salary / count if count > 0 else 0
    print(f"总人数: {count}")
    print(f"总工资: {total_salary}")
    print(f"平均工资: {average_salary:.2f}")
    print()


if __name__ == '__main__':
    print("\n🎓 CSV 模块学习示例\n")
    
    example1_basic_reader()
    example2_dict_reader()
    example3_skip_header()
    example4_filter_data()
    example5_calculate()
    
    print("✅ 所有示例运行完成！")
