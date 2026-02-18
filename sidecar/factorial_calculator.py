import math

print("计算1到1000的阶乘\n")
print("=" * 60)

# 计算所有阶乘
factorials = {}
for n in range(1, 1001):
    factorials[n] = math.factorial(n)

# 显示前20个阶乘的完整值
print("\n前20个阶乘:")
print("-" * 60)
for n in range(1, 21):
    print(f"{n:3d}! = {factorials[n]}")

# 显示一些关键节点的位数
print("\n\n关键节点的位数:")
print("-" * 60)
key_points = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
for n in key_points:
    digits = len(str(factorials[n]))
    print(f"{n:4d}! 有 {digits:5d} 位数字")

# 显示1000!的前100位和后100位
print("\n\n1000! 的前100位:")
print("-" * 60)
factorial_1000_str = str(factorials[1000])
print(factorial_1000_str[:100])

print("\n\n1000! 的后100位:")
print("-" * 60)
print(factorial_1000_str[-100:])

print(f"\n\n总计算数量: 1000个阶乘")
print(f"1000! 总共有 {len(factorial_1000_str)} 位数字")
