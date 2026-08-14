# Pi Agent: The Complete Path from One Sentence to Listing Desktop Files

> Scenario: you tell Pi, **“Show me the files on my Desktop.”**
>
> Goal: understand how an Agent interacts with a model, tools, the operating system, session storage, and the terminal interface.

---

## 1. Start with the right mental model

Pi does not understand this sentence by itself, and it does not mechanically translate it into `ls ~/Desktop`.

Pi is an **Agent Harness / Runtime**. The model interprets language and makes decisions. Pi does the surrounding engineering work:

- assemble user input, system rules, history, and tool descriptions into a model request;
- receive the model’s request to call a tool;
- run that tool against a shell, filesystem, or another external system;
- turn the observation into a structured Tool Result and give it back to the model;
- save the trace and render the process in the terminal.

> **The model thinks. Tools connect to the external world. The runtime makes the loop reliable, controllable, and inspectable.**

The model is not handed a terminal window or macOS file permissions. It can only emit text and structured requests for tools that Pi has made available.

---

## 2. One-page overview

```text
┌─────────┐
│  You    │
└────┬────┘
     │ “Show me the files on my Desktop.”
     ▼
┌──────────────────────────┐
│ Pi TUI                   │
│ Input, status, rendering │
└────┬─────────────────────┘
     ▼
┌──────────────────────────┐
│ AgentSession / Agent Core│
│ Context, queues, tools   │
└────┬─────────────────────┘
     │ system prompt + history + tool schemas + user message
     ▼
┌──────────────────────────┐
│ LLM Provider API         │
│ decides to request a tool│
└────┬─────────────────────┘
     │ Tool Call: bash("find ~/Desktop ...")
     ▼
┌──────────────────────────┐
│ Pi Tool Runtime          │
│ validates, dispatches    │
└────┬─────────────────────┘
     ▼
┌──────────────────────────┐
│ Shell / macOS filesystem │
└────┬─────────────────────┘
     │ stdout / stderr / exit code
     ▼
┌──────────────────────────┐
│ Tool Result + Session    │
└────┬─────────────────────┘
     │ result becomes model context
     ▼
┌──────────────────────────┐
│ LLM writes final answer  │
└────┬─────────────────────┘
     ▼
┌─────────┐
│  You    │
└─────────┘
```

A simple tool task normally contains at least two model requests:

1. the model decides which tool to use and emits a Tool Call;
2. the model reads the Tool Result and turns the observed fact into an answer.

---

## 3. The participants and their boundaries

| Component | What it does | What it does not do |
|---|---|---|
| Pi TUI | Receives typing, displays messages, Tool Calls, results, and status | Does not understand the task or choose commands |
| `AgentSession` | Manages sessions, tools, queues, persistence, retries, and compaction | Does not independently decide which tool should be called |
| Agent Core | Drives the model → tool → model loop | Does not directly list your Desktop |
| Model Runtime / Provider | Sends requests to the selected provider and model | Does not execute local programs |
| LLM | Interprets intent, selects tools, plans, and explains results | Does not have direct filesystem access |
| Tool Registry | Describes the enabled tools and their schemas | Does not choose a tool for the model |
| Tool implementation | Performs controlled operations and returns a result | Does not understand the user’s broader goal |
| Shell / operating system | Runs commands and applies OS permissions | Does not know the model, the session, or the user’s intent |
| Session Manager | Persists messages and run history as JSONL | Does not perform reasoning |
| Skills / Extensions | Add instructions, tools, UI, events, or policies | Are not all part of Pi’s minimal core |

A useful rule is: **never collapse these responsibilities into “the AI did it.”** When debugging or designing an Agent, ask which component observed, decided, authorized, executed, stored, and rendered each step.

---

# 4. The detailed path, step by step

## Step 0: What Pi prepared before you typed

Before the user message arrives, Pi has already assembled a working environment.

### 0.1 It knows the current working directory

Pi has a current working directory (cwd), such as:

```text
/Users/bw
```

The Desktop is normally:

```text
/Users/bw/Desktop
```

A model may request an absolute path or a shell shorthand:

```bash
~/Desktop
```

The shell expands `~` to the current user’s home directory. The model is not doing this expansion itself; the shell does it when the command runs.

### 0.2 It loads instructions and context files

Pi can load context from locations such as:

```text
~/.pi/agent/AGENTS.md
AGENTS.md / CLAUDE.md in parent directories
AGENTS.md / CLAUDE.md in the current project
```

These files can specify conventions, allowed workflows, preferred tools, checks to run, or safety constraints. They become part of the model’s working context.

They might say, for example:

- use `read` rather than `cat` to inspect a text file;
- do not write outside a workspace;
- load a particular Skill before handling a document;
- use a particular output format.

### 0.3 It registers tools and explains them to the model

The enabled tool set depends on Pi configuration, Extensions, and startup options. Common tools include:

```text
read    Read a file or image
write   Create a file
edit    Precisely modify an existing file
bash    Run a shell command
grep    Search text
find    Find files
ls      List a directory
```

The model sees a **Tool Schema**, not the implementation. Conceptually, a bash schema looks like this:

```json
{
  "name": "bash",
  "description": "Run bash commands such as ls, grep, and find.",
  "parameters": {
    "command": "string",
    "timeout": "optional number"
  }
}
```

A schema is a tool instruction manual for the model: its name, purpose, and allowed arguments. It is not executable code, and it does not make Pi choose a command automatically.

---

## Step 1: You submit the request

You type:

```text
Show me the files on my Desktop.
```

When you press Enter, the terminal UI delivers that text to `AgentSession.prompt()`.

`AgentSession` is the session-level coordinator. It is responsible for things such as:

```text
- current model and thinking level
- active tools
- session persistence
- steering and follow-up message queues
- extension hooks
- retry and context compaction
- forwarding events to the TUI
```

If you submit a new message while an Agent is already working, Pi can queue it differently:

- a **steering** message is delivered before the next model call after current tool work;
- a **follow-up** waits until the Agent has fully finished its current work.

This distinction matters when a user changes the task while tools are running.

---

## Step 2: The user message enters the Session

Pi stores the prompt in its session state and normally persists it to a JSONL session file under a path like:

```text
~/.pi/agent/sessions/
```

Conceptually, the entry resembles:

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": "previous-entry-id",
  "timestamp": "2026-08-14T10:00:00.000Z",
  "message": {
    "role": "user",
    "content": "Show me the files on my Desktop."
  }
}
```

JSONL means one JSON object per line. It is convenient for append-oriented history, recovery, export, and diagnosis.

---

## Step 3: Pi builds the model request

Pi does not send only the latest sentence. It assembles an entire request context:

```text
┌──────────────────────────────────────┐
│ System Prompt                         │
│ Agent role, rules, behavior guidance  │
├──────────────────────────────────────┤
│ Context files and loaded Skills       │
│ Project-specific instructions         │
├──────────────────────────────────────┤
│ Tool definitions                      │
│ Names, descriptions, argument schemas │
├──────────────────────────────────────┤
│ Conversation history                  │
│ Prior messages and Tool Results       │
├──────────────────────────────────────┤
│ Current user message                  │
│ “Show me the files on my Desktop.”    │
└──────────────────────────────────────┘
```

Long sessions cannot grow forever. When needed, Pi can compact earlier material into a summary while retaining recent and important context. Compaction is lossy, but the full session file remains available for history and inspection.

---

## Step 4: Pi sends the request to a model provider

The Model Runtime uses the selected configuration:

```text
Provider: DeepSeek, Anthropic, OpenAI, Gemini, or another configured provider
Model: a concrete model identifier
Authentication: API key or subscription credentials
Transport: SSE, WebSocket, or automatic selection where supported
```

The provider sends a streaming response. Text, reasoning blocks where available, and Tool Calls can arrive incrementally. Pi converts these updates into events that the terminal UI can render as they arrive.

---

## Step 5: The model decides that it needs an observation

The model can reason approximately like this:

```text
The user asks about current files on a real computer.
This cannot be answered from language knowledge alone.
A suitable directory or shell tool is available.
I should request a tool call first.
```

It may return a structured Tool Call:

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

It might instead request `ls -la ~/Desktop`, or use a dedicated `find` or `ls` tool if one is exposed.

### Who chooses the command?

| Decision | Main owner |
|---|---|
| Whether external observation is needed | LLM |
| Which enabled tool to request | LLM |
| Command, path, and filter arguments | LLM |
| Which tools exist and are enabled | Pi configuration / Runtime |
| How a request is actually executed | Tool implementation |
| How the filesystem enforces permissions | Operating system |

Pi gives the model controlled hands and senses. The model decides how to use them within the tools it has been given.

---

## Step 6: Pi receives and dispatches the Tool Call

A model cannot execute your computer directly. It returns an intention to call a tool. Pi’s runtime then:

```text
1. finds the registered tool named "bash";
2. validates and reads the requested arguments;
3. creates an AbortSignal for cancellation;
4. emits tool events for the UI and Extensions;
5. calls the tool implementation;
6. waits for success, failure, timeout, or cancellation.
```

When the TUI shows:

```text
$ find ~/Desktop -maxdepth 1 -type f -print
```

that is a rendering of a Tool Call event. It is not evidence that the model itself owns a terminal window.

---

## Step 7: How the bash tool reaches macOS

Pi’s local bash tool uses Node.js child-process support to launch the configured shell. In simplified form:

```ts
spawn(shell, shellArguments + [command], {
  cwd: currentWorkingDirectory,
  env: environment,
  stdio: [/* stdin, stdout, stderr */]
})
```

The real path is:

```text
Pi bash tool
  → Node.js child_process.spawn()
  → macOS shell (zsh or bash)
  → find / ls / other program
  → macOS filesystem
  → stdout / stderr / exit code
  → Pi bash tool
```

For example, the shell expands:

```text
~/Desktop
↓
/Users/bw/Desktop
```

If the directory contains files such as:

```text
/Users/bw/Desktop/project-notes.md
/Users/bw/Desktop/screenshot.png
/Users/bw/Desktop/test-data.xlsx
```

the command writes those paths to standard output.

---

## Step 8: Streaming output, truncation, cancellation, and errors

### 8.1 Streaming output

A shell command can write to:

```text
stdout  normal output
stderr  error output
```

Pi can collect output incrementally and emit updates to the TUI while a long command is still running.

### 8.2 Output truncation

A tool result is also model context. Pi should not place unlimited command output into a request. The tool can cap lines or bytes, retain the full output in a temporary controlled location, and tell the model that the displayed result was truncated.

The model can then ask a narrower follow-up question using a path, `offset`, `limit`, `grep`, or a more specific command.

### 8.3 User cancellation

A correct cancellation chain is:

```text
User presses Escape
  → TUI asks AgentSession to abort
  → Runtime propagates an AbortSignal
  → current tool observes the signal
  → bash terminates the shell and relevant process tree
  → operation settles as aborted
  → UI and session state are updated
```

Stopping only the terminal animation is not enough. A background command that keeps running can consume resources, create unexpected side effects, and leave the runtime’s visible state out of sync with reality.

### 8.4 Timeout

If a tool has a timeout budget:

```text
timeout expires
  → runtime/tool terminates the process tree
  → tool returns a timeout failure
  → model receives the failure as a Tool Result
```

### 8.5 Missing files and permission errors

A filesystem operation may return an error such as:

```text
find: /Users/bw/Desktop: Permission denied
```

Pi should convert it into an error Tool Result rather than hide it. The model can then explain the limitation, ask a user-owned question, or try an allowed alternative. It must not invent a successful directory listing.

---

## Step 9: stdout becomes a structured Tool Result

After execution, Pi wraps the observation in a message linked to the original call ID:

```json
{
  "role": "toolResult",
  "toolCallId": "call_abc123",
  "toolName": "bash",
  "content": [
    {
      "type": "text",
      "text": "/Users/bw/Desktop/project-notes.md\n/Users/bw/Desktop/screenshot.png"
    }
  ],
  "isError": false
}
```

The link is essential:

```text
Assistant Tool Call id: call_abc123
Tool Result toolCallId: call_abc123
```

It lets the model, runtime, session log, and UI all identify which exact call produced this result.

---

## Step 10: Pi sends the Tool Result back to the model

The next model request now contains a local history like:

```text
User: Show me the files on my Desktop.

Assistant: [requested bash tool]

Tool Result:
/Users/bw/Desktop/project-notes.md
/Users/bw/Desktop/screenshot.png
/Users/bw/Desktop/test-data.xlsx
```

The model never reads the hard drive directly. It reads the structured observation that the runtime has chosen to supply.

> **A Tool Result is the model’s sensory input about the external world.**

---

## Step 11: The model writes the final response

With real data available, the model can return a grounded answer such as:

```text
There are three files on the Desktop:

- project-notes.md
- screenshot.png
- test-data.xlsx
```

If it emits no further Tool Calls, the provider completes the response with a stop reason. Pi stores the final assistant message, updates usage and cost information, emits settled events, and renders the response to the user.

---

# 5. The same flow as a sequence diagram

```text
You             Pi TUI        AgentSession       LLM API        bash tool       Shell/filesystem
│                 │                │                │                │                  │
│ user prompt     │                │                │                │                  │
├────────────────>│                │                │                │                  │
│                 ├───────────────>│ save message   │                │                  │
│                 │                │ build context  │                │                  │
│                 │                ├───────────────>│                │                  │
│                 │                │                │ Tool Call      │                  │
│                 │                │<───────────────┤                │                  │
│                 │ render call    │ execute        │                │                  │
│                 │<───────────────┼───────────────>│                │                  │
│                 │                │                │                │ spawn shell      │
│                 │                │                │                ├─────────────────>│
│                 │                │                │                │ output / error   │
│                 │                │                │                │<─────────────────┤
│                 │                │ Tool Result    │                │                  │
│                 │                │<───────────────────────────────┤                  │
│                 │ render result  │ next model call│                │                  │
│                 │<───────────────┼───────────────>│                │                  │
│                 │                │                │ final answer   │                  │
│ final answer     │                │<───────────────┤                │                  │
│<────────────────┤                │ persist trace  │                │                  │
```

---

# 6. What is the Agent loop?

A simplified Agent loop looks like this:

```ts
messages.push(userMessage)

while (true) {
  const response = await llm.generate({ systemPrompt, tools, messages })
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

For this Desktop task, the loop commonly runs twice:

```text
Loop 1: user question → model requests a directory tool
Loop 2: Tool Result → model writes a final answer
```

For a coding task it can run many times:

```text
read files → search code → edit → run tests → read failure → edit again → rerun tests → answer
```

The loop is the mechanism that turns a model with language ability into an Agent that can observe and act.

---

# 7. Why Tool Results are an Agent’s senses

A model only receives context and produces text or structured calls. Different tools give it different observations:

| Tool | What it can observe |
|---|---|
| `read` | source code, documents, and supported images |
| `find` / `ls` | directory and file structure |
| `grep` | where a term occurs in files |
| `bash` | test output, Git state, system information, command output |
| browser tool | pages and DOM-derived information |
| database tool | query results |
| HTTP/API tool | external service responses |
| subagent tool | another agent’s report |

This is why an Agent is not simply “a more capable LLM.” It is a loop of planning, structured calls, controlled execution, and new facts.

---

# 8. Why Session history matters

Pi sessions are JSONL histories with IDs and parent IDs, so they can form a tree rather than only one irreversible chat line.

This supports:

```text
/resume  restore a prior session
/tree    move to an earlier node while preserving branches
/fork    create a new session from an earlier user message
/clone   duplicate the active branch
/compact summarize older context
/export  export HTML or JSONL
```

A session can record:

```text
- user messages
- assistant messages
- Tool Calls and Tool Results
- model and thinking-level changes
- compaction summaries
- extension-owned custom state and custom messages
```

A durable trajectory lets an engineer answer questions such as:

```text
What did the model actually see?
Which tool was called and with what arguments?
What failed?
Why did the final answer have this evidence?
```

---

# 9. Where Skills and Extensions participate

## Skill

A Skill is generally a focused instruction package, often Markdown, that tells a model how to handle a type of task:

```text
1. What to inspect first
2. Which tools to prefer
3. Which constraints to obey
4. How to validate the work
```

It mainly changes the model’s working context and method.

## Extension

An Extension is TypeScript code that can participate more deeply in the runtime:

```text
- register or replace tools
- add commands and keyboard shortcuts
- intercept tool calls or results
- add approval and path-protection policies
- render custom TUI components
- connect remote shells, sandboxes, MCP, or business APIs
- implement subagents or plan-mode workflows
```

For example, a model may keep requesting a `bash` tool while an Extension changes the implementation from:

```text
bash → local shell
```

to:

```text
bash → policy gate → Docker sandbox / SSH host / cloud executor
```

The model uses the abstraction; the runtime controls where and how execution occurs.

---

# 10. Why the model cannot simply take over a computer

The model emits text and Tool Calls. A real action happens only when a registered tool accepts and executes the request.

A healthy enforcement stack looks like:

```text
Model request
  → Tool Schema / registry
  → Runtime policy and approval
  → concrete tool implementation
  → Shell / filesystem / network / database
```

A System Prompt that says “do not run dangerous commands” is useful guidance, but it is not enforcement. Models can misunderstand, hallucinate, or be influenced by prompt injection. Real safeguards should be enforceable and testable:

```text
- minimum necessary tool set
- allowlists and deny lists
- path validation and canonical-path checks
- read-only credentials and least privilege
- user approval gates
- containers, VMs, or remote sandboxes
- network restrictions
- auditable logs
```

The key distinction is:

> The model may request a dangerous action. The runtime and tools must decide whether that action can actually happen.

---

# 11. Three lessons for Agent builders

## 11.1 The LLM is the brain, not the whole Agent

The model can interpret intent, choose a tool, plan a next step, and explain a result. It does not itself provide filesystem access, process control, persistence, UI rendering, or security enforcement.

## 11.2 Tool output must become the next model context

The model does not automatically know what a tool observed. The runtime must execute the tool, create a Tool Result, append it to the trajectory, and include it in the next request:

```text
model requests tool
→ runtime executes tool
→ runtime creates Tool Result
→ Tool Result enters next model context
→ model reasons from the fact
```

## 11.3 Production difficulty is control systems, not Tool Call syntax

A demonstration can be short:

```text
user → model → tool → model answer
```

A production Agent must also handle:

```text
multi-step loops, parallel work, timeout, cancellation, retries,
permissions, recovery, compaction, output limits, observability,
audit, extensions, and security testing.
```

These runtime concerns determine whether an Agent is trustworthy in practice.

---

# 12. Final summary

The Desktop example is not a natural-language sentence magically turning into a system command. It is a closed loop:

```text
user intent
→ Pi assembles context and tool schemas
→ model chooses an observation
→ Pi dispatches a controlled tool
→ the OS or external system returns a fact
→ Pi records and wraps the fact as a Tool Result
→ model writes a grounded answer
→ Pi persists and presents the trace
```

> **The model decides what to observe and how to ask. The tool performs the observation. The runtime makes their collaboration reliable.**

---

## Reference: relevant Pi files and documentation

- Pi overview: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Session format: `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md`
- `AgentSession` types: `dist/core/agent-session.d.ts`
- bash tool: `dist/core/tools/bash.js`
- read tool: `dist/core/tools/read.js`
