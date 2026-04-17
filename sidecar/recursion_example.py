def factorial(n):
    """
    递归计算阶乘
    n! = n × (n-1) × (n-2) × ... × 1
    """
    # 基准条件：最简单的情况
    if n == 0 or n == 1:
        return 1
    
    # 递归调用：把问题分解成更小的子问题
    return n * factorial(n - 1)


# 测试示例
if __name__ == "__main__":
    print("递归计算阶乘示例：")
    for i in range(6):
        print(f"{i}! = {factorial(i)}")
