# React 19 新特性技术总结

> 发布时间：2024年12月  
> 资料来源：ZeonEdge、ECOSIRE 技术博客

## 概述

React 19 是自 Hooks 以来最重大的版本更新，主要聚焦于简化开发体验、提升性能和稳定化服务端组件。

## 核心新特性

### 1. Actions API

**解决的问题**：简化表单处理和异步状态管理

**React 18 的痛点**：
```javascript
// 需要手动管理 pending、error、success 状态
const [isPending, startTransition] = useTransition()
const [error, setError] = useState(null)
// 40+ 行代码处理一个简单表单
```

**React 19 的解决方案**：
```javascript
// 使用 useActionState，代码量减半
const [state, action, isPending] = useActionState(
  updateProfileAction,
  { error: null, success: false }
)

// 直接在 form 上使用 action
<form action={action}>
  <input name="name" />
  <button disabled={isPending}>保存</button>
</form>
```

**关键优势**：
- 自动处理 pending 状态
- 内置错误处理
- 无需手动 preventDefault()

### 2. use() Hook

**突破性改变**：这是第一个可以在条件语句和循环中使用的 Hook

**功能**：
- 读取 Promise（配合 Suspense）
- 读取 Context
- 支持条件调用

```javascript
function UserProfile({ userPromise }) {
  // 直接在组件中 use Promise，自动 suspend
  const user = use(userPromise)
  return <h1>{user.name}</h1>
}

// 条件使用 Context（useContext 做不到）
if (isSpecial) {
  const theme = use(ThemeContext)
}
```

### 3. React Compiler（原 React Forget）

**革命性变化**：自动优化，告别手动 memoization

**工作原理**：
- 编译时分析组件树
- 自动插入 `useMemo`、`useCallback`、`React.memo`
- 开发者无需手动优化

**示例**：
```javascript
// 你写的代码（无优化）
function ProductCard({ product, onAddToCart }) {
  const price = formatCurrency(product.price)
  return <button onClick={() => onAddToCart(product.id)}>购买</button>
}

// 编译器自动生成（概念上）
const ProductCard = React.memo(function ProductCard({ product, onAddToCart }) {
  const price = useMemo(() => formatCurrency(product.price), [product.price])
  const handleClick = useCallback(() => onAddToCart(product.id), [onAddToCart, product.id])
  // ...
})
```

### 4. Server Components（稳定版）

**特点**：
- 仅在服务端运行，零客户端 bundle
- 可直接访问数据库
- 支持 async/await
- 无生命周期、无状态

```javascript
// Server Component - 直接查询数据库
async function UserProfile({ userId }) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId)
  })
  return <h1>{user.name}</h1>
}
```

### 5. Server Actions

**用途**：替代 API 路由处理数据变更

```javascript
'use server'

export async function createContact(formData) {
  const name = formData.get('name')
  await db.insert(contacts).values({ name })
  revalidatePath('/contacts')  // 刷新缓存
  redirect('/contacts')         // 重定向
}

// 直接在表单中使用
<form action={createContact}>
  <input name="name" />
  <button>创建</button>
</form>
```

### 6. useOptimistic Hook

**功能**：乐观更新，即时 UI 反馈

```javascript
const [optimisticto dos, addOptimisticto do] = useOptimistic(
  to dos,
  (state, newto do) => [...state, newto do]
)

// 立即显示在 UI，服务器失败时自动回滚
addOptimisticto do({ id: tempId, text })
await createto do({ text })  // 实际请求
```

### 7. useFormStatus Hook

**功能**：无需 prop drilling 获取表单状态

```javascript
function SubmitButton() {
  const { pending, data } = useFormStatus()
  return (
    <button disabled={pending}>
      {pending ? '提交中...' : '提交'}
    </button>
  )
}

// 可以在表单树的任何位置使用，无需传递 props
```

### 8. 其他改进

- **资源预加载 API**：`preload()`、`preinit()` 控制资源加载
- **文档元数据**：组件中的 `<title>`、`<meta>` 自动提升到 `<head>`
- **改进的错误处理**：更好的错误边界集成

## 迁移指南

```bash
# 升级到 React 19
npm install react@19 react-dom@19

# 安装 React Compiler
npm install --save-dev babel-plugin-react-compiler

# 检查代码兼容性
npx react-compiler-healthcheck
```

## 总结

React 19 的核心理念是**减少样板代码、自动化优化、简化异步处理**。主要受益场景：

- ✅ 表单密集型应用（Actions + useFormStatus）
- ✅ 数据驱动应用（Server Components + use()）
- ✅ 性能敏感应用（React Compiler）
- ✅ 需要乐观更新的交互（useOptimistic）

**兼容性**：React Compiler 可向下兼容 React 18，其他特性需要 React 19。

---

*参考资料：*
- [React 19 Complete Guide - ZeonEdge](https://zeonedge.com/blog/react-19-complete-guide-actions-use-hook-server-components-compiler)
- [React 19 Server Components Guide - ECOSIRE](https://ecosire.com/blog/react-19-server-components-guide)
- 搜索日期：2024年
