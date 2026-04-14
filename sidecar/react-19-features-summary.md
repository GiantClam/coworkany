# React 19 新特性技术总结

## 概述

React 19 是自 Hooks 以来最重大的版本更新，于 2024 年 12 月发布稳定版。这次更新主要解决了 React 开发中最常见的痛点：表单处理、加载状态、错误边界和重渲染性能开销。

## 核心新特性

### 1. Actions API

Actions 是处理异步操作的新标准方式，特别是表单提交。它大幅简化了之前需要 `useTransition` + `useState` + 错误处理的繁琐模式。

**React 18 旧方式**（40+ 行代码）：
```javascript
function UpdateProfileForm() {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  
  async function handleSubmit(e) {
    e.preventDefault()
    // 手动管理所有状态...
  }
}
```

**React 19 新方式**（代码量减半）：
```javascript
import { useActionState } from 'react'

function UpdateProfileForm() {
  const [state, action, isPending] = useActionState(
    updateProfileAction,
    { error: null, success: false }
  )
  
  return <form action={action}>...</form>
}
```

### 2. use() Hook

`use()` 是一个突破性的 Hook，打破了 React 之前的规则——**可以在条件语句和循环中调用**。它用于读取 Promise 或 Context 的当前值。

**特点**：
- 可以直接在渲染中读取 Promise
- 与 Suspense 系统集成
- 可以条件调用（不同于 useContext）
- Promise 未解析时会挂起组件

```javascript
function UserProfile({ userPromise }) {
  const user = use(userPromise) // 挂起直到 Promise 解析
  return <div>{user.name}</div>
}
```

### 3. React Compiler（原 React Forget）

编译器在构建时自动分析组件树，自动插入 `useMemo`、`useCallback` 和 `React.memo`，无需手动优化。

**开发者编写**：
```javascript
function ProductCard({ product, onAddToCart }) {
  const formattedPrice = formatCurrency(product.price)
  const discountedPrice = product.price * (1 - product.discount)
  // 无需手动 memoization
}
```

**编译器自动输出**：
```javascript
const ProductCard = React.memo(function ProductCard({ product, onAddToCart }) {
  const formattedPrice = useMemo(() => formatCurrency(product.price), [product.price])
  const discountedPrice = useMemo(...)
  // 自动优化
})
```

### 4. Server Components（稳定版）

Server Components 在 React 18 中是实验性功能，React 19 中已完全稳定并与并发渲染模型集成。

**关键特性**：
- 仅在服务器端运行
- 可直接访问数据库/文件系统
- 零客户端 bundle 体积影响
- 支持 async/await
- 无生命周期、无状态、无浏览器 API

```javascript
// Server Component - 直接数据库查询
async function UserProfile({ userId }) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId)
  })
  return <div>{user.name}</div>
}
```

### 5. 其他实用 Hooks

**useFormStatus**：读取父表单状态，无需 prop drilling
```javascript
function SubmitButton() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>
    {pending ? 'Processing...' : 'Submit'}
  </button>
}
```

**useOptimistic**：即时 UI 反馈
```javascript
const [optimisticto dos, addOptimisticto do] = useOptimistic(
  to dos,
  (state, newto do) => [...state, newto do]
)
// 立即显示在 UI 中，服务器失败时自动回滚
```

### 6. Server Actions

带有 `'use server'` 指令的异步函数，在服务器上运行，替代大多数数据变更的 API 路由。

```javascript
'use server'
export async function createContact(formData) {
  const name = formData.get('name')
  await db.insert(contacts).values({ name })
  revalidatePath('/dashboard/contacts')
  redirect('/dashboard/contacts')
}
```

### 7. 资源管理改进

- **资源预加载 API**：`preload`、`preinit` 让你从组件中控制资源加载
- **文档元数据**：`<title>`、`<meta>`、`<link>` 标签在组件中自动提升到 `<head>`

## 迁移指南

```bash
# 安装 React 19
npm install react@19 react-dom@19

# 安装 React Compiler
npm install --save-dev babel-plugin-react-compiler

# 检查代码兼容性
npx react-compiler-healthcheck
```

## 总结

React 19 的三大核心变化：

1. **Actions** 处理异步状态转换，无需 useTransition + useState + 错误处理样板代码
2. **use() Hook** 直接在渲染中读取 Promise，使基于 Suspense 的数据获取更符合人体工程学
3. **React Compiler** 自动插入优化代码，永远不需要手动编写 useMemo/useCallback

这些改进不仅仅是语法糖，而是从根本上解决了 React 开发中的常见痛点，让并发模式真正可用。

---

**参考资料**：
- [React 19 Complete Guide - ZeonEdge](https://zeonedge.com/blog/react-19-complete-guide-actions-use-hook-server-components-compiler)
- [React 19 Server Components Guide - ECOSIRE](https://ecosire.com/blog/react-19-server-components-guide)
- 发布时间：2024年12月（稳定版）
