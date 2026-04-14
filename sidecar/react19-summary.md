# React 19 新特性技术总结

> 发布时间：2024 年 12 月正式稳定版  
> 参考来源：ZeonEdge、ECOSIRE、DEV Community（2026-03）

---

## 概览

React 19 是自 Hooks 以来最重要的一次版本更新。核心目标是让并发渲染真正可用，同时大幅减少处理异步状态、表单、加载态所需的样板代码。

---

## 主要新特性

### 1. Actions —— 替代 useTransition + useState 的表单处理方案

React 18 处理一个简单表单提交需要 40+ 行代码（useTransition、useState、try/catch 全部手写）。React 19 引入 **Actions**：任何传给 `<form action={...}>` 或 `useActionState` 的异步函数都是 Action，框架自动管理 pending / error / success 状态。

```tsx
// React 19
const [state, action, isPending] = useActionState(updateProfileAction, initialState)

return (
  <form action={action}>
    <input name="name" />
    <button disabled={isPending}>{isPending ? 'Saving...' : 'Save'}</button>
  </form>
)
```

### 2. useFormStatus —— 无需 prop drilling 读取表单状态

`useFormStatus`（来自 `react-dom`）可在表单树的任意子组件中读取父 `<form>` 的 pending 状态，彻底消除层层传 prop 的问题。

```tsx
import { useFormStatus } from 'react-dom'

function SubmitButton() {
  const { pending } = useFormStatus()
  return <button disabled={pending}>{pending ? 'Processing...' : 'Submit'}</button>
}
```

### 3. useOptimistic —— 乐观更新

在服务端响应返回前立即更新 UI，若请求失败则自动回滚，无需手动管理临时状态。

```tsx
const [optimisticto dos, addOptimisticto do] = useOptimistic(
  to dos,
  (state, newto do) => [...state, newto do]
)
```

### 4. use() Hook —— 在渲染中读取 Promise 和 Context

`use()` 打破了 Hooks 不能条件调用的限制，可在条件分支和循环中使用。它会在 Promise 未 resolve 时自动挂起组件（配合 Suspense），也可替代 `useContext`。

```tsx
// 读取 Promise（配合 Suspense）
const user = use(userPromise)

// 条件读取 Context（useContext 做不到）
if (isSpecial) {
  const theme = use(ThemeContext)
}
```

### 5. React Compiler（原 React Forget）—— 自动记忆化

React Compiler 在编译阶段自动分析组件树，插入等价于 `useMemo` / `useCallback` / `React.memo` 的优化，开发者无需再手动优化重渲染。2024 年 12 月随 React 19 进入 Beta。

### 6. Server Components 正式稳定

Server Components 从 React 18 的实验性功能升级为稳定 API，与并发渲染模型完全集成。关键特性：

| 特性 | Server Components | Client Components |
|------|------------------|-------------------|
| 运行环境 | 仅服务端 | 服务端（初次）+ 客户端 |
| 可用 Hooks | ❌ | ✅ |
| 直接访问数据库 | ✅ | ❌ |
| 打包体积影响 | 零 | 有 |
| 支持 async/await | ✅ | ❌（需 Suspense） |

### 7. 文档元数据管理

组件内直接写 `<title>`、`<meta>`、`<link>` 标签，React 会自动将其提升到 `<head>`，无需 react-helmet 等第三方库。

```tsx
function BlogPost({ post }) {
  return (
    <>
      <title>{post.title}</title>
      <meta name="description" content={post.excerpt} />
      <article>{post.content}</article>
    </>
  )
}
```

### 8. 资源预加载 API

新增 `preload`、`preinit` 等 API，可在组件内精确控制脚本、样式表、字体的加载时机，提升页面性能。

---

## 升级方式

```bash
# 新项目（推荐 Vite）
npm create vite@latest my-app -- --template react-ts
npm install react@19 react-dom@19

# 已有项目升级
npm install react@19 react-dom@19 @types/react@19 @types/react-dom@19
npx react-codemod update-react-imports .
```

---

## 总结

React 19 的核心价值在于**降低心智负担**：Actions 简化异步表单、`use()` 让数据获取更直观、Compiler 消除手动性能优化、Server Components 稳定落地。对于新项目，建议直接采用 React 19 + Vite 或 Next.js 15 的组合。
