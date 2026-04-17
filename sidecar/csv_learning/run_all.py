#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
运行所有 CSV 读取示例
"""

import subprocess
import sys
import os

def run_script(script_name):
    """运行单个脚本"""
    print("\n" + "=" * 60)
    print(f"正在运行: {script_name}")
    print("=" * 60)
    
    try:
        result = subprocess.run(
            [sys.executable, script_name],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(__file__) or '.'
        )
        print(result.stdout)
        if result.stderr:
            print("错误信息:", result.stderr)
    except Exception as e:
        print(f"运行失败: {e}")

if __name__ == "__main__":
    scripts = [
        'method1_builtin_csv.py',
        'method2_pandas.py',
        'method3_numpy.py'
    ]
    
    print("🎓 Python CSV 读取学习会话")
    print("=" * 60)
    
    for script in scripts:
        run_script(script)
    
    print("\n" + "=" * 60)
    print("✅ 学习会话完成！")
    print("=" * 60)
