import math

# 计算1到1000的阶乘并保存到文件
with open('factorials_1_to_1000.txt', 'w', encoding='utf-8') as f:
    f.write('1到1000的阶乘计算结果\n')
    f.write('=' * 50 + '\n\n')
    
    for i in range(1, 1001):
        factorial_value = math.factorial(i)
        f.write(f'{i}! = {factorial_value}\n\n')

print('已完成计算')
print('结果已保存到 factorials_1_to_1000.txt')
print('\n一些统计信息:')
print(f'- 1000! 有 {len(str(math.factorial(1000)))} 位数字')
print(f'- 500! 有 {len(str(math.factorial(500)))} 位数字')
print(f'- 100! 有 {len(str(math.factorial(100)))} 位数字')
