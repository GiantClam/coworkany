# 计算 1+2+3+...+100 的总和

# 方法1: 使用循环
total = 0
for i in range(1, 101):
    total += i

print(f"使用循环计算: 1+2+3+...+100 = {total}")

# 方法2: 使用求和公式 n*(n+1)/2
n = 100
formula_result = n * (n + 1) // 2
print(f"使用公式计算: 1+2+3+...+100 = {formula_result}")

# 方法3: 使用Python内置sum函数
sum_result = sum(range(1, 101))
print(f"使用sum函数: 1+2+3+...+100 = {sum_result}")
