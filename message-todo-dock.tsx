/**
 * 消息发送时的 Todo 进度显示组件
 * 
 * 特性：
 * - 符合桌面端风格设计，不突兀
 * - 实时显示任务进度
 * - 回复结束后自动收起
 * - 支持展开/折叠
 * - 带动画效果
 */

import { createMemo, createSignal, For, Show, onCleanup, onMount } from "solid-js"
import { useSpring } from "@opencode-ai/ui/motion-spring"

// ============ 类型定义 ============

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled"

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
}

export interface MessageTodoDockProps {
  /** 当前任务列表 */
  todos: TodoItem[]
  /** 是否正在处理中（AI 回复中） */
  isProcessing: boolean
  /** 自定义关闭延迟（毫秒） */
  closeDelay?: number
  /** 点击展开/折叠的回调 */
  onToggle?: (collapsed: boolean) => void
}

// ============ 样式常量（匹配桌面端主题） ============

const STYLES = {
  dock: `
    bg-background-base
    border border-border-weak-base
    rounded-xl
    overflow-hidden
    transition-all duration-300
    ease-[cubic-bezier(0.22,1,0.36,1)]
  `,
  header: `
    flex items-center gap-2
    px-3 py-2
    cursor-pointer
    hover:bg-background-stronger/50
    transition-colors duration-150
  `,
  progressText: `
    text-14-regular text-text-strong
    inline-flex items-baseline
    shrink-0
  `,
  preview: `
    ml-1 min-w-0 overflow-hidden
    flex-1
    text-14-regular text-text-base
    truncate
  `,
  toggleButton: `
    ml-auto
    transition-transform duration-300
    ease-[cubic-bezier(0.34,1,0.64,1)]
  `,
  list: `
    px-3 pb-3
    flex flex-col gap-1.5
    max-h-42 overflow-y-auto
  `,
  todoItem: `
    flex items-start gap-2
    py-1
  `,
  checkbox: `
    size-4 rounded border
    flex items-center justify-center
    shrink-0 mt-0.5
    transition-all duration-200
  `,
  todoText: `
    text-14-regular
    break-words
    transition-all duration-220
    ease-[cubic-bezier(0.22,1,0.36,1)]
  `,
  pulseDot: `
    size-3 rounded-full
    bg-current
    animate-pulse-scale
  `,
} as const

// ============ 辅助组件 ============

/**
 * 脉冲动画指示器（用于 in_progress 状态）
 */
function PulseIndicator() {
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="currentColor"
      class="block"
    >
      <circle
        cx="6"
        cy="6"
        r="3"
        style={{
          animation: "var(--animate-pulse-scale)",
          "transform-origin": "center",
          "transform-box": "fill-box",
        }}
      />
    </svg>
  )
}

/**
 * 复选框组件
 */
function TodoCheckbox(props: {
  status: TodoStatus
}) {
  const isCompleted = props.status === "completed"
  const isInProgress = props.status === "in_progress"
  const isPending = props.status === "pending"

  return (
    <div
      class={STYLES.checkbox}
      classList={{
        "border-border-weak-base bg-transparent": isPending || isInProgress,
        "border-primary bg-primary": isCompleted,
        "text-text-weaker": isPending,
        "text-primary": isInProgress,
        "text-white": isCompleted,
      }}
    >
      <Show when={isCompleted}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
          <path
            d="M2 5L4 7L8 3"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </Show>
      <Show when={isInProgress}>
        <PulseIndicator />
      </Show>
    </div>
  )
}

/**
 * 单个 Todo 项
 */
function TodoListItem(props: {
  todo: TodoItem
}) {
  const isCompleted = props.todo.status === "completed"
  const isCancelled = props.todo.status === "cancelled"
  const isPending = props.todo.status === "pending"

  return (
    <div class={STYLES.todoItem} data-state={props.todo.status}>
      <TodoCheckbox status={props.todo.status} />
      <span
        class={STYLES.todoText}
        classList={{
          "text-text-strong": !isCompleted && !isCancelled,
          "text-text-weak line-through": isCompleted || isCancelled,
          "opacity-90": isPending,
        }}
      >
        {props.todo.content}
      </span>
    </div>
  )
}

// ============ 主组件 ============

/**
 * 消息发送时的 Todo 进度显示 Dock
 * 
 * 使用示例：
 * ```tsx
 * <MessageTodoDock
 *   todos={[
 *     { id: "1", content: "分析需求", status: "completed" },
 *     { id: "2", content: "编写代码", status: "in_progress" },
 *     { id: "3", content: "测试验证", status: "pending" },
 *   ]}
 *   isProcessing={true}
 * />
 * ```
 */
export function MessageTodoDock(props: MessageTodoDockProps) {
  // 展开/折叠状态
  const [isCollapsed, setIsCollapsed] = createSignal(true)
  
  // 关闭动画状态
  const [isClosing, setIsClosing] = createSignal(false)
  
  // 计算进度
  const total = createMemo(() => props.todos.length)
  const done = createMemo(() => 
    props.todos.filter(t => t.status === "completed").length
  )
  
  // 当前活跃的任务（用于预览）
  const activeTodo = createMemo(() =>
    props.todos.find(t => t.status === "in_progress") ??
    props.todos.find(t => t.status === "pending") ??
    props.todos.filter(t => t.status === "completed").at(-1) ??
    props.todos[0]
  )
  
  // 是否应该显示（有任务且处理中）
  const shouldShow = createMemo(() => 
    props.todos.length > 0 && props.isProcessing
  )
  
  // 是否应该关闭（任务完成且不再处理）
  const shouldClose = createMemo(() => 
    props.todos.length > 0 && !props.isProcessing
  )
  
  // 使用弹簧动画控制显示/隐藏
  const showProgress = useSpring(
    () => (shouldShow() ? 1 : 0),
    { visualDuration: 0.3, bounce: 0 }
  )
  
  // 使用弹簧动画控制展开/折叠
  const collapseProgress = useSpring(
    () => (isCollapsed() ? 1 : 0),
    { visualDuration: 0.3, bounce: 0 }
  )
  
  // 计算各种动画值
  const showValue = createMemo(() => Math.max(0, Math.min(1, showProgress())))
  const collapseValue = createMemo(() => Math.max(0, Math.min(1, collapseProgress())))
  
  // 是否完全隐藏
  const isHidden = createMemo(() => showValue() < 0.02)
  
  // 列表是否可见
  const isListVisible = createMemo(() => !isCollapsed() && showValue() > 0.1)
  
  // 自动关闭逻辑
  let closeTimer: number | undefined
  
  const scheduleClose = () => {
    if (closeTimer) window.clearTimeout(closeTimer)
    const delay = props.closeDelay ?? 800 // 默认 800ms 后收起
    closeTimer = window.setTimeout(() => {
      setIsClosing(true)
      // 等动画完成后再完全隐藏
      window.setTimeout(() => {
        setIsClosing(false)
      }, 300)
    }, delay)
  }
  
  // 监听处理状态变化
  createMemo(() => {
    if (shouldClose()) {
      scheduleClose()
    } else {
      if (closeTimer) {
        window.clearTimeout(closeTimer)
        closeTimer = undefined
      }
    }
  })
  
  // 切换展开/折叠
  const toggle = () => {
    const next = !isCollapsed()
    setIsCollapsed(next)
    props.onToggle?.(next)
  }
  
  // 清理定时器
  onCleanup(() => {
    if (closeTimer) window.clearTimeout(closeTimer)
  })
  
  return (
    <div
      class={STYLES.dock}
      classList={{
        "opacity-0 pointer-events-none": isHidden(),
      }}
      style={{
        "max-height": isHidden() 
          ? "0px" 
          : `${Math.max(78, 320 - collapseValue() * (320 - 78))}px`,
        "margin-bottom": `${12 * showValue()}px`,
        opacity: showValue(),
        transform: `translateY(${(1 - showValue()) * 8}px)`,
      }}
    >
      {/* 头部：进度概览 */}
      <div
        class={STYLES.header}
        role="button"
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return
          e.preventDefault()
          toggle()
        }}
      >
        {/* 进度数字 */}
        <span class={STYLES.progressText}>
          <span class="font-medium">{done()}</span>
          <span class="text-text-weak mx-0.5">/</span>
          <span>{total()}</span>
        </span>
        
        {/* 当前任务预览 */}
        <div class={STYLES.preview}>
          <Show when={isCollapsed()}>
            <span class="truncate">{activeTodo()?.content}</span>
          </Show>
        </div>
        
        {/* 展开/折叠按钮 */}
        <button
          class={STYLES.toggleButton}
          style={{
            transform: `rotate(${collapseValue() * 180}deg)`,
          }}
          onClick={(e) => {
            e.stopPropagation()
            toggle()
          }}
          aria-label={isCollapsed() ? "展开" : "折叠"}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
      
      {/* 任务列表 */}
      <div
        class={STYLES.list}
        classList={{
          "pointer-events-none": !isListVisible(),
        }}
        style={{
          visibility: isListVisible() ? "visible" : "hidden",
          opacity: Math.max(0, Math.min(1, (1 - collapseValue()) * showValue())),
          "max-height": isListVisible() ? "168px" : "0px",
        }}
      >
        <For each={props.todos}>
          {(todo) => <TodoListItem todo={todo} />}
        </For>
      </div>
    </div>
  )
}

// ============ 使用示例 ============

/**
 * 在你的消息发送组件中使用：
 * 
 * ```tsx
 * function MessageComposer() {
 *   const [todos, setTodos] = createSignal<TodoItem[]>([])
 *   const [isProcessing, setIsProcessing] = createSignal(false)
 *   
 *   const handleSend = async (message: string) => {
 *     setIsProcessing(true)
 *     
 *     // 模拟任务更新
 *     setTodos([
 *       { id: "1", content: "分析消息内容", status: "in_progress" },
 *       { id: "2", content: "生成回复", status: "pending" },
 *       { id: "3", content: "格式化输出", status: "pending" },
 *     ])
 *     
 *     // ... 发送消息并接收流式响应
 *     
 *     // 任务完成时更新状态
 *     setTodos(prev => prev.map(t => 
 *       t.id === "1" ? { ...t, status: "completed" } : t
 *     ))
 *     
 *     // 所有任务完成后
 *     setIsProcessing(false)
 *   }
 *   
 *   return (
 *     <div class="flex flex-col gap-3">
 *       <MessageTodoDock
 *         todos={todos()}
 *         isProcessing={isProcessing()}
 *       />
 *       <textarea />
 *       <button onClick={handleSend}>发送</button>
 *     </div>
 *   )
 * }
 * ```
 */

export default MessageTodoDock
