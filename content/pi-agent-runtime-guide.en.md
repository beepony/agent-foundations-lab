# Pi Agent: From a User Request to a Tool Result

## The core idea

Pi does not understand a request or execute `ls` by itself. The LLM decides what to do; Pi is the runtime that assembles context, dispatches tools, records results, and renders the process.

> The model thinks. Tools connect to the external world. The runtime makes the loop controlled, observable, and recoverable.

## Request lifecycle

```text
User input
→ TUI and AgentSession
→ context + tool schemas
→ LLM decision
→ Tool Call
→ Tool Runtime
→ Shell / filesystem
→ Tool Result
→ LLM answer
→ Session persistence
```

A tool task normally needs at least two model calls: one to decide on a tool, then one to reason over the actual Tool Result.

## Responsibility boundaries

- The TUI receives input and displays events.
- AgentSession manages history, queues, tools, persistence, retries, and compaction.
- The LLM decides whether to use a tool and interprets results.
- Tool Runtime dispatches tools with arguments and cancellation signals.
- Shell and filesystem perform real operations.
- Session JSONL keeps a durable execution trace.

## Tool Call and Tool Result

The model requests an action:

```json
{ "id": "call_01", "name": "bash", "arguments": { "command": "find ~/Desktop -maxdepth 1 -type f" } }
```

The runtime returns an observed fact:

```json
{ "toolCallId": "call_01", "toolName": "bash", "isError": false, "content": [{ "type": "text", "text": "...files..." }] }
```

The model does not directly access the file system. It receives Tool Results as its sensory input.

## Control and safety

Escape must propagate an AbortSignal to the tool and its child processes; stopping only UI output is not a correct cancellation. Huge tool output should be bounded and made pageable. A prompt is not a security boundary: enforce permissions using allowlists, path validation, approval, sandboxing, and OS controls.
