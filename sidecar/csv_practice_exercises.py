"""
CSV 读取练习题
==============

完成以下练习来巩固 CSV 读取技能
"""

import csv

# 练习 1: 读取并统计
def exercise_1():
    """
    练习 1: 读取 sample_data.csv，计算平均年龄
    
    提示: 使用 csv.DictReader() 读取，然后计算年龄列的平均值
    """
    print("\n练习 1: 计算平均年龄")
    print("-" * 40)
    
    # 你的代码写在这里
    total_age = 0
    count = 0
    
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            total_age += int(row['年龄'])
            count += 1
    
    avg_age = total_age / count if count > 0 else 0
    print(f"平均年龄: {avg_age:.1f} 岁")


# 练习 2: 筛选数据
def exercise_2():
    """
    练习 2: 读取数据，只显示年龄大于 26 的人
    """
    print("\n练习 2: 筛选年龄 > 26 的记录")
    print("-" * 40)
    
    with open('sample_data.csv', 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            if int(row['年龄']) > 26:
                print(f"{row['姓名']} - {row['年龄']}岁 - {row['城市']}")


# 练习 3: 写入新的 CSV
def exercise_3():
    """
    练习 3: 创建一个新的 CSV 文件，包含产品信息
    """
    print("\n练习 3: 创建产品信息 CSV")
    print("-" * 40)
    
    products = [
        {'产品名': 'iPhone', '价格': 5999, '库存': 50},
        {'产品名': 'iPad', '价格': 3999, '库存': 30},
        {'产品名': 'MacBook', '价格': 9999, '库存': 20}
    ]
    
    filename = 'products.csv'
    with open(filename, 'w', encoding='utf-8', newline='') as file:
        fieldnames = ['产品名', '价格', '库存']
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        
        writer.writeheader()
        writer.writerows(products)
    
    print(f"已创建 {filename}")
    
    # 读取并显示
    with open(filename, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            print(f"{row['产品名']}: ¥{row['价格']} (库存: {row['库存']})")


# 练习 4: 处理缺失值
def exercise_4():
    """
    练习 4: 创建包含缺失值的 CSV 并处理
    """
    print("\n练习 4: 处理缺失数据")
    print("-" * 40)
    
    # 创建包含空值的数据
    data = [
        ['姓名', '邮箱', '电话'],
        ['Alice', 'alice@example.com', ''],
        ['Bob', '', '13800138000'],
        ['Charlie', 'charlie@example.com', '13900139000']
    ]
    
    filename = 'contacts.csv'
    with open(filename, 'w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerows(data)
    
    # 读取并处理缺失值
    with open(filename, 'r', encoding='utf-8') as file:
        reader = csv.DictReader(file)
        for row in reader:
            email = row['邮箱'] or '未提供'
            phone = row['电话'] or '未提供'
            print(f"{row['姓名']}: 邮箱={email}, 电话={phone}")


if __name__ == "__main__":
    print("=" * 50)
    print("CSV 读取练习")
    print("=" * 50)
    
    exercise_1()
    exercise_2()
    exercise_3()
    exercise_4()
    
    print("\n" + "=" * 50)
    print("练习完成！")
    print("\n进阶挑战:")
    print("- 尝试读取大型 CSV 文件（使用分块读取）")
    print("- 处理不同编码的 CSV 文件")
    print("- 使用 pandas 进行数据分析和可视化")
