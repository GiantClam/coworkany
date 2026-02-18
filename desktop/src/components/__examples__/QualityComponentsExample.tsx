/**
 * Example Usage of Verification and Quality Components
 *
 * This file demonstrates how to use VerificationStatus and CodeQualityReport
 * components in the chat interface.
 */

import React from 'react';
import { VerificationStatus, CodeQualityReport } from '../index';

export const QualityComponentsExample: React.FC = () => {
    return (
        <div className="p-4 space-y-6 bg-gray-100">
            <h2 className="text-xl font-bold">Quality & Verification Components Examples</h2>

            {/* Example 1: Successful Verification */}
            <section>
                <h3 className="text-lg font-semibold mb-2">1. 成功验证示例</h3>
                <VerificationStatus
                    status="passed"
                    message="文件成功写入并验证"
                    score={1.0}
                    evidence={[
                        '文件 src/utils.ts 已存在',
                        '内容与预期匹配',
                        '文件大小: 2.3 KB'
                    ]}
                />
            </section>

            {/* Example 2: Failed Verification */}
            <section>
                <h3 className="text-lg font-semibold mb-2">2. 验证失败示例</h3>
                <VerificationStatus
                    status="failed"
                    message="命令执行失败"
                    score={0.0}
                    evidence={[
                        '退出码: 1',
                        '错误: Command not found: nonexistent-command'
                    ]}
                    suggestions={[
                        '检查错误信息详情',
                        '验证命令语法',
                        '检查是否安装了所需工具'
                    ]}
                />
            </section>

            {/* Example 3: Compact Verification */}
            <section>
                <h3 className="text-lg font-semibold mb-2">3. 紧凑模式</h3>
                <div className="flex gap-2">
                    <VerificationStatus
                        status="passed"
                        message="测试通过"
                        score={1.0}
                        compact
                    />
                    <VerificationStatus
                        status="failed"
                        message="构建失败"
                        score={0.0}
                        compact
                    />
                    <VerificationStatus
                        status="skipped"
                        message="已跳过"
                        score={0.5}
                        compact
                    />
                </div>
            </section>

            {/* Example 4: Excellent Code Quality */}
            <section>
                <h3 className="text-lg font-semibold mb-2">4. 优秀代码质量</h3>
                <CodeQualityReport
                    filePath="src/utils/helpers.ts"
                    score={95}
                    issues={[]}
                    metrics={{
                        cyclomaticComplexity: 2,
                        cognitiveComplexity: 1,
                        linesOfCode: 45,
                        maintainabilityIndex: 92
                    }}
                />
            </section>

            {/* Example 5: Code with Issues */}
            <section>
                <h3 className="text-lg font-semibold mb-2">5. 有问题的代码</h3>
                <CodeQualityReport
                    filePath="src/auth/login.ts"
                    score={65}
                    issues={[
                        {
                            severity: 'error',
                            category: 'security',
                            message: '检测到潜在的 SQL 注入漏洞',
                            line: 42,
                            column: 15,
                            suggestion: '使用参数化查询代替字符串拼接'
                        },
                        {
                            severity: 'warning',
                            category: 'complexity',
                            message: '代码嵌套 6 层，建议最多 4 层',
                            line: 58,
                            suggestion: '考虑提取部分逻辑到单独的函数'
                        },
                        {
                            severity: 'info',
                            category: 'style',
                            message: '发现 console 语句',
                            line: 23,
                            suggestion: '使用专业的日志库代替 console'
                        }
                    ]}
                    metrics={{
                        cyclomaticComplexity: 12,
                        cognitiveComplexity: 18,
                        linesOfCode: 156,
                        maintainabilityIndex: 58
                    }}
                />
            </section>

            {/* Example 6: Poor Code Quality */}
            <section>
                <h3 className="text-lg font-semibold mb-2">6. 需要改进的代码</h3>
                <CodeQualityReport
                    filePath="src/legacy/old-module.js"
                    score={42}
                    issues={[
                        {
                            severity: 'error',
                            category: 'security',
                            message: 'eval() 的使用非常危险',
                            line: 15,
                            suggestion: '完全避免使用 eval()'
                        },
                        {
                            severity: 'error',
                            category: 'security',
                            message: '检测到硬编码的凭据',
                            line: 8,
                            suggestion: '使用环境变量或安全存储'
                        },
                        {
                            severity: 'warning',
                            category: 'complexity',
                            message: '函数参数过多（8个），建议最多 5 个',
                            line: 25,
                            suggestion: '使用配置对象代替多个参数'
                        },
                        {
                            severity: 'warning',
                            category: 'maintainability',
                            message: '空的 catch 块',
                            line: 67,
                            suggestion: '至少记录错误信息'
                        }
                    ]}
                    metrics={{
                        cyclomaticComplexity: 28,
                        cognitiveComplexity: 45,
                        linesOfCode: 320,
                        maintainabilityIndex: 35
                    }}
                />
            </section>

            {/* Example 7: Compact Code Quality */}
            <section>
                <h3 className="text-lg font-semibold mb-2">7. 代码质量紧凑模式</h3>
                <div className="space-y-2">
                    <CodeQualityReport
                        filePath="src/components/Button.tsx"
                        score={88}
                        issues={[]}
                        metrics={{
                            cyclomaticComplexity: 3,
                            cognitiveComplexity: 2,
                            linesOfCode: 78,
                            maintainabilityIndex: 85
                        }}
                        compact
                    />
                    <CodeQualityReport
                        filePath="src/utils/validation.ts"
                        score={72}
                        issues={[
                            {
                                severity: 'warning',
                                category: 'complexity',
                                message: '高复杂度',
                                line: 12
                            }
                        ]}
                        metrics={{
                            cyclomaticComplexity: 8,
                            cognitiveComplexity: 12,
                            linesOfCode: 120,
                            maintainabilityIndex: 68
                        }}
                        compact
                    />
                </div>
            </section>

            {/* Example 8: Combined in Chat Message */}
            <section>
                <h3 className="text-lg font-semibold mb-2">8. 聊天消息中的组合使用</h3>
                <div className="bg-white rounded-lg p-4 border border-gray-200 space-y-3">
                    <p className="text-sm text-gray-700">
                        我已经修复了身份验证模块中的 SQL 注入漏洞，并重构了复杂的嵌套逻辑。
                    </p>

                    <CodeQualityReport
                        filePath="src/auth/authenticate.ts"
                        score={92}
                        issues={[
                            {
                                severity: 'info',
                                category: 'style',
                                message: '可以添加类型注解以提高类型安全',
                                line: 34,
                                suggestion: '添加返回类型: Promise<User | null>'
                            }
                        ]}
                        metrics={{
                            cyclomaticComplexity: 4,
                            cognitiveComplexity: 3,
                            linesOfCode: 89,
                            maintainabilityIndex: 88
                        }}
                    />

                    <VerificationStatus
                        status="passed"
                        message="所有测试通过"
                        score={1.0}
                        evidence={[
                            '15 个测试全部通过',
                            '代码覆盖率: 94%',
                            '无安全警告'
                        ]}
                    />
                </div>
            </section>
        </div>
    );
};

export default QualityComponentsExample;
