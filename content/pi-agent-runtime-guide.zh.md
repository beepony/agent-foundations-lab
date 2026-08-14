# Pi Agent：从一句话到查看桌面文件的完整工作机制

> 场景：你对 Pi 说：**“帮我看一下桌面上有哪些文件。”**  
> 目标：理解 Agent 如何调用模型、工具、操作系统、会话存储和终端界面。  
> 本文使用 ASCII 图，而非 Mermaid，方便在 Sublime Text 的 Markdown 预览中直接查看。

---

## 1. 先建立一个正确认识

Pi 不会自己“理解”你的中文，也不会自己决定运行 `ls`、`find` 等命令。

Pi 是一个 **Agent Harness / Runtime（智能体运行环境）**。大模型负责理解和决策；Pi 负责：

- 把用户输入、系统规则、历史记录和工具说明组织成模型请求；
- 接收模型提出的工具调用请求；
- 让工具与本机 Shell、文件系统等外部世界交互；
- 将工具结果安全地、结构化地交回模型；
- 保存会话并在终端里展示整个过程。

可以用一句话概括：

> **模型负责想；Pi 负责让模型可靠地看见和行动。**

---

## 2. 一张总览图

```text
┌─────────┐
│   你    │
└────┬────┘
     │ 输入：“帮我看一下桌面上有哪些文件”
     ▼
┌──────────────────────────┐
│ Pi TUI（终端交互界面）     │
│ 接收输入、显示过程与结果    │
└────┬─────────────────────┘
     ▼
┌──────────────────────────┐
│ AgentSession / Agent Core │
│ 会话、上下文、工具、队列    │
└────┬─────────────────────┘
     │ 发送：规则 + 历史 + 工具 schema + 用户问题
     ▼
┌──────────────────────────┐
│         大模型 API         │
│ 理解任务，决定调用工具      │
└────┬─────────────────────┘
     │ tool call：bash("find ~/Desktop ...")
     ▼
┌──────────────────────────┐
│ Pi Tool Runtime           │
│ 参数、取消、输出收集与转换  │
└────┬─────────────────────┘
     ▼
┌──────────────────────────┐
│ Shell / macOS 文件系统     │
│ zsh/bash → find/ls → Desktop│
└────┬─────────────────────┘
     │ stdout / stderr / exit code
     ▼
┌──────────────────────────┐
│ ToolResult + Session JSONL│
│ 结果记录、交还模型          │
└────┬─────────────────────┘
     │ 追加一次模型请求
     ▼
┌──────────────────────────┐
│ 大模型生成最终自然语言回答   │
└────┬─────────────────────┘
     ▼
┌─────────┐
│   你    │
└─────────┘
```

通常至少有两次模型请求：

1. **决策请求**：模型读到问题后，决定要使用哪个工具；
2. **总结请求**：模型读到工具返回的真实目录内容后，组织成给人的回答。

---

## 3. 参与者：每个组件到底负责什么？

| 组件 | 主要职责 | 不负责什么 |
|---|---|---|
| Pi TUI | 输入、展示文本/工具调用/结果、处理快捷键 | 不理解自然语言，不决定命令 |
| `AgentSession` | 管理会话、工具、消息队列、持久化、上下文压缩 | 不自己判断应该调用何种工具 |
| Agent Core | 驱动“模型 → 工具 → 模型”的循环 | 不直接访问桌面 |
| Model Runtime | 按选定的 Provider 和 Model 发起网络请求 | 不执行本机程序 |
| 大模型 | 理解意图、选择工具、解释工具结果 | 没有本机文件系统访问权 |
| Tool Registry | 向模型公开可用工具及参数结构 | 不替模型做决策 |
| `bash` / `ls` / `find` 工具 | 执行受控的本机操作、返回结果 | 不理解“桌面文件”背后的用户意图 |
| Shell 和 macOS | 运行命令、读取文件系统 | 不知道 Pi、模型或会话 |
| Session Manager | 用 JSONL 保存消息、工具结果、模型切换等 | 不参与推理 |
| Extension / Skill | 额外增加工具、规则、界面或事件处理 | 默认不是 Pi 最小核心的一部分 |

---

# 4. 详细过程：逐步发生了什么？

## 步骤 0：Pi 启动时已经做了哪些准备？

在你输入前，Pi 已完成运行环境初始化。

### 0.1 确定当前工作目录

Pi 有一个当前工作目录（Current Working Directory，cwd）。例如本次环境可能是：

```text
/Users/bw
```

而“桌面”通常对应：

```text
/Users/bw/Desktop
```

模型可以在工具参数中使用绝对路径，也可能使用 Shell 可识别的简写：

```bash
~/Desktop
```

其中 `~` 会被 Shell 展开为当前用户的主目录，例如 `/Users/bw`。

### 0.2 加载规则与上下文文件

Pi 会按范围读取 `AGENTS.md` 或 `CLAUDE.md` 等上下文文件，例如：

```text
~/.pi/agent/AGENTS.md             全局规则
父目录中的 AGENTS.md / CLAUDE.md  项目或目录规则
当前目录中的 AGENTS.md            当前项目规则
```

这些内容会影响模型的行为，例如：

- 有哪些可用工具；
- 读取文件应该使用 `read` 还是 `bash`；
- 哪些命令或目录受到限制；
- 是否应先读取某个 Skill；
- 输出的格式和语言。

### 0.3 注册工具，并把工具说明交给模型

Pi 会将当前启用的工具提供给模型。不同安装方式、Extension 和启动参数下，可用工具可能不同。

常见的内建或环境提供工具包括：

```text
read    读取文件或图片
write   写入新文件
edit    精准修改已有文件
bash    执行 Shell 命令
find    查找文件
ls      列出目录
grep    搜索文本
```

模型看到的并不是可执行程序本体，而是“工具说明书”。例如概念上，`bash` 的定义类似：

```json
{
  "name": "bash",
  "description": "执行 bash 命令，例如 ls、grep、find。",
  "parameters": {
    "command": "string",
    "timeout": "number，可选"
  }
}
```

这份结构通常被称为 **Tool Schema（工具模式）** 或 **Function Definition（函数定义）**。

> 模型不是天然拥有操作电脑的能力；它是根据工具说明，输出一个“请帮我调用工具”的结构化请求。

---

## 步骤 1：你在终端输入请求

你输入：

```text
帮我看一下桌面上有哪些文件
```

按下 Enter 后，TUI 会把文本交给 `AgentSession.prompt()`。

`AgentSession` 可以看作 Pi 的“会话总管”，它负责：

```text
- 保存与恢复会话
- 管理当前模型、Provider 和思考等级
- 管理当前启用的工具
- 接收 Agent 的事件
- 处理消息队列
- 处理上下文压缩与重试
- 将关键记录写入 JSONL
```

如果你在 Agent 工作中再次按 Enter，Pi 默认会将消息作为 **steering message（引导/插话）** 排队；如果使用 Alt+Enter，则会作为 **follow-up（后续请求）**，等当前工作完全完成后再处理。

---

## 步骤 2：用户消息进入 Session

Pi 会把这句话作为用户消息放入当前会话状态，并默认追加写入 Session JSONL 文件。

概念上像这样：

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": "上一条消息的 ID",
  "timestamp": "2026-08-14T10:00:00.000Z",
  "message": {
    "role": "user",
    "content": "帮我看一下桌面上有哪些文件"
  }
}
```

默认 Session 文件会保存在：

```text
~/.pi/agent/sessions/
```

Pi 的 Session 使用 JSONL（JSON Lines）：每一行是一个 JSON 对象。这样做的好处是容易追加、恢复、导出和调试。

---

## 步骤 3：Pi 构造模型请求

Pi 不会只把你的这句话裸发给模型。它要构造完整上下文，抽象后大概是：

```text
┌──────────────────────────────────────┐
│ System Prompt                         │
│ “你是一个 coding agent……”              │
│ 工具使用规则、行为约束                  │
├──────────────────────────────────────┤
│ Context Files / Skills                │
│ AGENTS.md、Skill 的专项说明            │
├──────────────────────────────────────┤
│ Tool Definitions                      │
│ read / bash / edit / write 的名称、说明、参数 │
├──────────────────────────────────────┤
│ Conversation History                  │
│ 当前 Session 分支上的历史消息和工具结果  │
├──────────────────────────────────────┤
│ Current User Message                  │
│ “帮我看一下桌面上有哪些文件”             │
└──────────────────────────────────────┘
```

其中“历史消息”不是简单地把所有旧消息无限拼接。长会话接近模型上下文窗口限制时，Pi 可使用 compaction（压缩）：将较早历史概括成摘要，保留最近消息，降低 Token 使用量。

---

## 步骤 4：Pi 通过 Provider 把请求发送给模型

Pi 的 Model Runtime 根据当前设置，选择：

```text
Provider：例如 DeepSeek / Anthropic / OpenAI / Gemini
Model：例如某个具体模型 ID
认证方式：API Key 或订阅登录凭证
传输方式：SSE、WebSocket 或自动选择
```

然后向模型服务发送 HTTP 请求，并开始接收流式响应。

流式响应意味着：模型的文字、思考块（若 Provider 支持）、工具调用块可能会逐段到达。Pi 会把这些增量事件传给终端界面，因此你通常能看到内容逐渐出现，而不是等全部完成。

---

## 步骤 5：大模型决定“我需要观察真实桌面”

模型看到你的问题后，通常会推理：

```text
用户询问的是当前电脑上的真实文件。
我不能凭训练知识回答。
我有 bash / ls / find 等工具。
应该先列出 ~/Desktop 的内容。
```

于是模型可能生成工具调用，例如：

```json
{
  "type": "toolCall",
  "id": "call_abc123",
  "name": "bash",
  "arguments": {
    "command": "find ~/Desktop -maxdepth 1 -type f -print"
  }
}
```

它也可能选择：

```bash
ls -la ~/Desktop
```

或者在工具集中有独立 `ls` / `find` 工具时，直接调用相应工具。

### 重要：谁决定使用什么命令？

| 决策 | 主要责任方 |
|---|---|
| 是否需要读取真实环境 | 大模型 |
| 使用 `bash`、`find`、`ls` 还是其他工具 | 大模型 |
| 命令参数、路径、筛选条件 | 大模型 |
| 工具是否存在、是否启用 | Pi Runtime / 配置 |
| 工具调用如何真正执行 | Pi 工具实现 |
| Shell 如何访问文件系统 | 操作系统 |

换句话说，Pi 提供“手和眼”，模型决定何时、如何使用它们。

---

## 步骤 6：Pi 接住 Tool Call，并调度对应工具

模型不能直接执行本机命令；它只能返回一个结构化的“工具调用意图”。

Pi 的 Agent Runtime 收到后，会：

```text
1. 找到 name = "bash" 对应的工具定义；
2. 读取 arguments.command；
3. 为本次操作创建可取消的 AbortSignal；
4. 发出工具调用事件，供 TUI 和 Extension 观察；
5. 调用 bash 工具的 execute()；
6. 等待工具成功、失败、超时或被取消。
```

因此，你在 Pi 终端里看到的：

```text
$ find ~/Desktop -maxdepth 1 -type f -print
```

是 TUI 对“工具调用事件”的渲染，不是模型真的拥有一个终端窗口。

---

## 步骤 7：`bash` 工具如何和 macOS 交互？

Pi 的本地 `bash` 工具通过 Node.js 的子进程能力启动 Shell。概念上类似：

```ts
spawn(shell, shellArguments + [command], {
  cwd: currentWorkingDirectory,
  env: environment,
  stdio: [/* stdin, stdout, stderr */]
})
```

实际链路：

```text
Pi bash 工具
  │ Node.js child_process.spawn()
  ▼
macOS 的 Shell（zsh / bash）
  │ 解释命令和 ~ 路径
  ▼
find 或 ls 等系统命令
  │ 系统调用
  ▼
macOS 文件系统
  │ 返回目录条目
  ▼
stdout / stderr + exit code
  │
  ▼
Pi bash 工具
```

例如：

```bash
find ~/Desktop -maxdepth 1 -type f -print
```

Shell 会把 `~` 展开成：

```text
/Users/bw
```

最终被访问的目录就是：

```text
/Users/bw/Desktop
```

假设其中有：

```text
/Users/bw/Desktop/项目说明.md
/Users/bw/Desktop/截图.png
/Users/bw/Desktop/测试数据.xlsx
```

这些文本会从命令的标准输出（stdout）返回给 Pi。

---

## 步骤 8：工具执行过程中的实时输出、截断、取消和错误

### 8.1 实时输出

`bash` 工具会监听子进程的：

```text
stdout：正常输出
stderr：错误输出
```

如果命令运行很久且不断输出，Pi 可以边收到边向 TUI 发更新事件，让界面显示部分结果。

### 8.2 输出截断

如果输出极大，Pi 不会无上限地把所有内容塞入模型上下文。工具会保留有限的行数和字节数；被截断时会提示模型：

```text
输出已截断；完整输出保存到了某个临时文件。
```

这是 Agent 工程中很重要的一点：**工具输出也是上下文，会消耗 Token。**

### 8.3 用户取消

当你按 Escape 时，典型链路是：

```text
你按 Escape
  → TUI 调用 session.abort()
  → Agent / Tool 收到 AbortSignal
  → bash 工具终止 Shell 及其进程树
  → 当前工具调用以 aborted 结束
  → Pi 更新界面和会话状态
```

### 8.4 超时

若工具调用配置了 timeout：

```text
时间超过限制
  → bash 工具终止进程树
  → 返回“命令超时”错误
  → 错误作为工具结果交给模型
```

### 8.5 文件不存在或没有权限

例如目录不存在，Shell 可能返回：

```text
find: /Users/bw/Desktop: No such file or directory
```

Pi 不会把错误吞掉，而是包装成 `isError: true` 的工具结果。模型看到后可：

- 解释错误；
- 尝试其他路径；
- 询问用户；
- 停止执行。

---

## 步骤 9：stdout 变成结构化 Tool Result

工具运行结束后，Pi 将输出转换为结构化消息，并和原始调用 ID 关联：

```json
{
  "role": "toolResult",
  "toolCallId": "call_abc123",
  "toolName": "bash",
  "content": [
    {
      "type": "text",
      "text": "/Users/bw/Desktop/项目说明.md\n/Users/bw/Desktop/截图.png\n/Users/bw/Desktop/测试数据.xlsx"
    }
  ],
  "isError": false
}
```

这里最重要的是 `toolCallId`：

```text
assistant 的 toolCall.id  = call_abc123
工具结果的 toolCallId      = call_abc123
```

这让模型、Pi、会话记录和 UI 都知道：**这个结果属于哪次工具调用。**

工具结果也会追加到 JSONL Session 中，因此之后可以恢复、导出、回放和审查。

---

## 步骤 10：Pi 将结果重新发给模型

此时 Pi 再发起一轮模型请求。模型看到的局部上下文类似：

```text
用户：帮我看一下桌面上有哪些文件

助手：我将调用 bash 工具查看目录。

助手工具调用：
find ~/Desktop -maxdepth 1 -type f -print

工具结果：
/Users/bw/Desktop/项目说明.md
/Users/bw/Desktop/截图.png
/Users/bw/Desktop/测试数据.xlsx
```

注意：模型并没有直接读取你的硬盘。

> 模型只读取 Pi 交给它的 Tool Result。  
> Tool Result 是模型观察真实外部世界的“感官输入”。

---

## 步骤 11：模型生成最终回答

模型此时有了真实数据，于是可以生成：

```text
桌面上目前有 3 个文件：

- 项目说明.md
- 截图.png
- 测试数据.xlsx
```

如果模型不再发起工具调用，Provider 会用类似 `stop` 的结束原因标记本轮输出完成。

Pi 于是：

```text
1. 接收最终 AssistantMessage；
2. 写入 Session JSONL；
3. 更新 Token、缓存命中率和成本统计；
4. 发出 Agent 结束/稳定事件；
5. TUI 将最终文本展示给你。
```

---

# 5. 用时序图再看一遍

```text
你             Pi TUI        AgentSession       LLM API        bash 工具        Shell / 文件系统
│                 │                │                │                │                  │
│ 输入问题         │                │                │                │                  │
├────────────────>│                │                │                │                  │
│                 │ prompt()       │                │                │                  │
│                 ├───────────────>│                │                │                  │
│                 │                │ 保存 user msg  │                │                  │
│                 │                │ 组装上下文     │                │                  │
│                 │                ├───────────────>│                │                  │
│                 │                │                │ 分析并决定调用 bash              │
│                 │                │<───────────────┤ toolCall        │                  │
│                 │ 显示工具调用    │                │                │                  │
│                 │<───────────────┤                │                │                  │
│                 │                │ execute()      │                │                  │
│                 │                ├───────────────────────────────>│                  │
│                 │                │                │                │ spawn zsh/find   │
│                 │                │                │                ├─────────────────>│
│                 │                │                │                │ 目录内容         │
│                 │                │                │                │<─────────────────┤
│                 │                │                │ ToolResult     │                  │
│                 │                │<───────────────────────────────┤                  │
│                 │ 显示工具结果    │                │                │                  │
│                 │<───────────────┤                │                │                  │
│                 │                │ 将 ToolResult 放入下一次请求    │                  │
│                 │                ├───────────────>│                │                  │
│                 │                │                │ 生成最终自然语言回答             │
│                 │                │<───────────────┤                │                  │
│ 最终回答         │                │ 保存 assistant msg              │                  │
│<────────────────┤<───────────────┤                │                │                  │
```

---

# 6. Agent 的核心循环到底是什么？

最简化的 Agent Loop 可以写成伪代码：

```ts
messages.push(userMessage)

while (true) {
  const response = await llm.generate({
    systemPrompt,
    tools,
    messages,
  })

  messages.push(response.assistantMessage)

  if (response.toolCalls.length === 0) {
    showToUser(response.text)
    break
  }

  for (const toolCall of response.toolCalls) {
    const result = await tools.execute(toolCall)
    messages.push(result)
  }
}
```

对于“列桌面文件”的情况，循环通常跑两次：

```text
第 1 圈：用户问题 → 模型请求 bash 工具
第 2 圈：工具结果 → 模型输出自然语言答案
```

对于“修复一个项目中的 Bug”这类复杂任务，循环可能运行很多次：

```text
读文件 → 搜索代码 → 修改文件 → 运行测试 → 读取报错 → 再修改 → 再测试 → 最终回答
```

这就是 Coding Agent 能持续完成复杂工作的根本机制。

---

# 7. 为什么说 Tool Result 是 Agent 的“感官”？

大模型本身只有输入上下文和输出文本/结构化调用能力。它没有真实世界的直接访问权限。

不同工具为它提供不同“感官”：

| 工具 | 模型借此感知什么？ |
|---|---|
| `read` | 文件内容、代码、图片 |
| `find` / `ls` | 文件和目录结构 |
| `grep` | 某个关键词在文件中的位置 |
| `bash` | 命令执行结果、Git 状态、测试结果、系统信息 |
| 浏览器工具 | 网页和 DOM 内容 |
| 数据库工具 | 业务数据、查询结果 |
| HTTP/API 工具 | 外部服务返回的数据 |
| 子 Agent | 另一个专门执行单元的报告 |

因此，一个 Agent 并不是“模型突然变得无所不能”，而是：

```text
模型的规划能力
+ 结构化工具调用协议
+ 外部工具带回的事实
+ Runtime 管理的循环和状态
= 可行动的 Agent
```

---

# 8. Pi 中的会话为什么重要？

Pi 默认将 Session 存为 JSONL，且使用 `id` 和 `parentId` 形成树，而不是只有一条不可分叉的聊天记录。

这支持：

```text
/resume  恢复旧会话
/tree    回到某个历史节点继续，保留多个分支
/fork    从某条用户消息创建新会话
/clone   复制当前分支
/compact 长会话压缩上下文
/export  导出 HTML 或 JSONL
```

Session 中可记录：

```text
- 用户消息
- 助手消息
- tool call 与 tool result
- 模型切换
- thinking level 切换
- 上下文压缩摘要
- 扩展写入的 custom state 或 custom message
```

这意味着 Pi 不只是“终端聊天窗口”；它是一个带历史、状态、分支和可恢复能力的 Agent Runtime。

---

# 9. Extension 和 Skill 会在哪里介入？

Pi 的核心设计是保持最小，同时允许扩展。

## Skill

Skill 本质上通常是一份按需加载的 Markdown 指令。它可以告诉模型：

```text
遇到某类任务时：
1. 先读哪些文件；
2. 使用什么工具；
3. 遵守哪些限制；
4. 如何验证结果。
```

它主要改变的是模型的“工作方法”和上下文，而不是直接执行代码。

## Extension

Extension 是 TypeScript 代码，可更深地介入运行时，例如：

```text
- 注册自定义工具
- 在 tool_call 前做校验或审批
- 替换工具实现
- 增加命令和快捷键
- 监听 Agent 事件
- 自定义 TUI 界面
- 接入远程 Shell、沙箱、MCP 或业务 API
- 实现子 Agent、Plan Mode 等高级工作流
```

因此，一个 Extension 可以把原本的：

```text
bash → 本机 Shell
```

替换为：

```text
bash → 审批层 → Docker 沙箱 / SSH 服务器 / 云端执行器
```

模型依然只是在调用名为 `bash` 的抽象工具；底层执行位置可以改变。

---

# 10. 安全边界：模型为什么不能直接接管电脑？

模型的输出只是文本或结构化 Tool Call，不能直接在你的系统执行。

真正执行动作的是 Pi 注册的工具。也就是说，权限边界应放在：

```text
模型
  ↓ 请求
Tool Schema / Tool Registry
  ↓ 调度
权限与审批策略（可由 Extension 实现）
  ↓
具体工具实现
  ↓
Shell / 文件系统 / 网络 / 数据库
```

Pi 的哲学是：它默认保持最小，不内置固定的权限弹窗、沙箱方案或子 Agent 方案；你可以运行在容器中，或通过 Extension 加入符合自己环境的审批和安全策略。

这提醒我们：

> “模型会不会调用危险命令”是模型行为问题；  
> “危险命令能不能真正执行”必须由 Runtime 和工具层控制。

---

# 11. 对 Agent 学习者最重要的三点启发

## 11.1 LLM 是大脑，但不是整个 Agent

LLM 负责：

```text
理解意图、选择工具、规划下一步、解释结果。
```

但它不负责：

```text
访问文件、执行命令、保存会话、终止进程、展示 UI、限制权限。
```

这些是 Harness / Runtime 的职责。

## 11.2 工具输出必须成为模型的下一轮上下文

模型执行工具后，不是“自动知道结果”，而是需要 Runtime 将结果包装为 Tool Result，再发回模型。

```text
模型请求工具
→ Runtime 执行
→ Runtime 生成 ToolResult
→ ToolResult 加入下一轮模型上下文
→ 模型据此推理
```

这就是 Agent 的观察—行动闭环。

## 11.3 生产级难点在控制系统，而不在 Tool Call 格式

一个 Demo 很容易：

```text
用户 → 模型 → 工具 → 模型回答
```

生产系统还必须处理：

```text
多轮循环、工具并发、超时、取消、重试、权限、会话恢复、
上下文压缩、输出截断、成本统计、可观测性、审计和扩展。
```

这些“模型以外的工程”决定了 Agent 是否真正可用。

---

# 12. 最终总结

当你让 Pi “看一下桌面有哪些文件”时，真实发生的不是一句自然语言直接变成系统命令，而是一个闭环：

```text
用户意图
  → Pi 组装上下文和工具说明
  → 大模型决定调用工具
  → Pi 调度工具
  → Shell / 操作系统读取真实世界
  → Pi 将结果记录并包装为 ToolResult
  → 大模型根据真实结果生成回答
  → Pi 保存会话并呈现给用户
```

最简短地说：

> **模型负责决定“看什么、怎么问”；工具负责实际“看”；Pi 负责让两者可靠地来回协作。**

---

## 参考：Pi 本地相关实现与文档

- Pi 总览：`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- 会话格式：`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `AgentSession` 类型：`dist/core/agent-session.d.ts`
- `bash` 工具实现：`dist/core/tools/bash.js`
- `read` 工具实现：`dist/core/tools/read.js`
