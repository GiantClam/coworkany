def bubble_sort(arr):
    """
    冒泡排序函数
    时间复杂度: O(n^2)
    空间复杂度: O(1)
    """
    n = len(arr)
    
    for i in range(n):
        # 优化：如果一轮遍历中没有发生交换，说明已经排序完成
        swapped = False
        
        for j in range(0, n - i - 1):
            # 如果当前元素大于下一个元素，交换它们
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        
        # 如果没有发生交换，提前退出
        if not swapped:
            break
    
    return arr


if __name__ == "__main__":
    # 测试用例
    test_cases = [
        [64, 34, 25, 12, 22, 11, 90],
        [5, 1, 4, 2, 8],
        [1, 2, 3, 4, 5],  # 已排序
        [5, 4, 3, 2, 1],  # 逆序
        [42],             # 单个元素
        []                # 空数组
    ]
    
    print("冒泡排序测试结果：\n")
    
    for i, test in enumerate(test_cases, 1):
        original = test.copy()
        sorted_arr = bubble_sort(test)
        print(f"测试 {i}:")
        print(f"  原始数组: {original}")
        print(f"  排序结果: {sorted_arr}")
        print(f"  验证: {'✓ 通过' if sorted_arr == sorted(original) else '✗ 失败'}")
        print()
