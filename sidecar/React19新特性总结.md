# React 19 新特性技术总结

> React 19 于 2024 年 12 月正式发布，这是自 Hooks 以来最重大的版本更新。

## 核心新特性

### 1. Actions - 异步表单处理革新

React 19 引入了 Actions 概念，彻底简化了表单的异步提交处理。不再需要手动管理 loading、error 状态和 `e.preventDefault()`。

**传统方式的痛点：**
- 每个表单需要 3+ 个 state 变量
- 手动处理 try/catch
- 重复的样板代码

**React 19 方式：**
```jsx
import { useActionState } from 'react'

function ContactForm() {
  const [state, submitAction, isPending] = useActionState(
    async (prevState, formData) => {
      try {
        await submitContact(formData)
        return { status: 'success' }
      } catch (err) {
        return { status: 'error', message: err.message }
      }
    },
    { status: 'idle' }
  )

  return (
    <form action={submitAction}>
      <input name="email" type="email" required />
      <button disabled={isPending}>
        {isPending ? '发送中...' : '发送'}
      </button>
      {state.status === 'error' && <p>{state.message}</p>}
    </form>
  )
}
```

### 2. useFormStatus - 跨组件读取表单状态

无需 prop drilling，子组件可以直接读取父表单的 pending 状态：

```jsx
import { useFormStatus } from 'react-dom'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}>
      {pending ? '提交中...' : '提交'}
    </button>
  )
}
```

### 3. useOptimistic - 乐观更新成为一等公民

让 UI 立即响应用户操作，失败时自动回滚：

```jsx
function LikeButton({ postId, initialLikes }) {
  const [likes, setLikes] = useState(initialLikes)
  const [optimisticLikes, addOptimisticLike] = useOptimistic(
    likes,
    (current, increment) => current + increment
  )

  async function handleLike() {
    addOptimisticLike(1)  // 立即显示 +1
    try {
      const newCount = await likePost(postId)
      setLikes(newCount)  // 更新为服务器真实值
    } catch {
      // 失败时自动回滚到原始值
    }
  }

  return <button onClick={handleLike}>{optimisticLikes} 赞</button>
}
```

**适用场景：** 点赞、关注、书签等成功率高的操作  
**不适用：** 支付、删除等关键操作

### 4. use() Hook - 打破 Hooks 规则限制

这是一个特殊的 Hook，可以在条件语句、循环中调用，支持 Promise 和 Context：

```jsx
function UserProfile({ userPromise }) {
  const user = use(userPromise)  // 组件会 suspend 直到 Promise resolve
  return <div><h2>{user.name}</h2></div>
}

// 条件调用 - 传统 useContext 无法做到
function ThemeButton({ showTheme, children }) {
  if (showTheme) {
    const theme = use(ThemeContext)  // 条件调用合法
    return <button style={{ background: theme.primary }}>{children}</button>
  }
  return <button>{children}</button>
}
```

### 5. ref 作为普通 prop - 告别 forwardRef

不再需要 `forwardRef` 包装器，ref 现在是普通 prop：

```jsx
// React 19 - 简洁直接
function Input({ label, ref }) {
  return <input ref={ref} aria-label={label} />
}

// 使用方式不变
function Parent() {
  const inputRef = useRef(null)
  return <Input label="邮箱" ref={inputRef} />
}
```

### 6. ref 清理函数

ref 回调现在支持返回清理函数，类似 useEffect：

```jsx
<input
  ref={(node) => {
    if (node) {
      node.focus()
      return () => node.blur()  // 卸载时清理
    }
  }}
/>
```

### 7. 组件内直接管理文档元数据

可以在任何组件中渲染 `<title>`、`<meta>`、`<link>`，React 会自动提升到 `<head>`：

```jsx
function BlogPost({ post }) {
  return (
    <article>
      <title>{post.title} - 我的博客</title>
      <meta name="description" content={post.description} />
      <meta property="og:image" content={post.coverImage} />
      {/* 文章内容 */}
    </article>
  )
}
```

### 8. React Server Components (RSC) 正式稳定

服务器组件在 React 18 中是实验性功能，React 19 中正式稳定：
- 零客户端 JavaScript 打包成本
- 直接访问后端资源（数据库、文件系统）
- 与并发渲染模型完全集成

### 9. React Compiler - 自动优化性能

React 19 引入编译器，自动处理性能优化：
- 不再需要手动使用 `useMemo`、`useCallback`、`memo`
- 编译时自动分析和优化组件
- 减少开发者心智负担

## 升级建议

React 19 没有破坏性变更，但有以下注意事项：
- `forwardRef` 仍然可用但被视为遗留 API
- 新项目应直接使用 ref 作为 prop
- Actions 和新 Hooks 可以逐步采用

## 总结

React 19 专注于开发体验提升，减少样板代码，让常见模式（表单处理、乐观更新、ref 传递）变得更简单直接。Server Components 和 Compiler 的稳定则为性能优化提供了新的可能性。

---
*基于 React 19 官方发布（2024年12月）整理*
