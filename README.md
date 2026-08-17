# Agent Foundations Lab

> 一个用 **Pi（Agent）请求生命周期** 讲清楚 Agent Runtime 原理的双语静态学习站。

📘 **在线体验**：[https://beepony.github.io/agent-foundations-lab/](https://beepony.github.io/agent-foundations-lab/)

---

## 它讲什么

整个 Agent Runtime 循环用一句话讲完：

```
User → context + tools → LLM → Tool Call → Runtime → OS/tool → Tool Result → LLM → Session
```

学完后你能讲清楚：

- 一句话怎么从用户传给模型（上下文 / 系统提示词 / 工具说明）
- 模型怎样**请求**工具，而不是直接操作你的电脑
- Pi 的 Pipeline 怎样把工具结果交还模型
- 工具失败、用户取消、输出超限时，系统怎样兜底

---

## 🚀 30 秒跑起来

零依赖，零构建：

```bash
git clone https://github.com/beepony/agent-foundations-lab.git
cd agent-foundations-lab
python3 -m http.server 8080
```

浏览器打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)。

> 任何静态服务器都行：`npx serve`、`ruby -run -e httpd . -p 8080`、`caddy file-server` 都 OK。

---

## 📂 仓库结构

```
.
├── index.html        # 中文首页（默认入口）
├── en/               # 英文版首页
├── learn/            # 教程页（按章节排版的长文）
├── quiz/             # 知识测验（独立答题环境，不显示教程）
├── results/          # 答题结果 + 每题解析
├── content/          # 教程 / 题目原始数据（JSON / Markdown）
├── assets/           # CSS / 图片 / 字体
└── .pi/              # Pi 相关的辅助脚本与示例
```

**核心约定**：

- **双语架构**：`index.html`（中文，默认） + `en/`（英文），互跳不丢状态
- **Quiz 答案只存浏览器 `localStorage`**，没有任何后端，提交后跳到 `results/` 展示
- **`.nojekyll` 已就位**，GitHub Pages 直接当静态站发，不会被 Jekyll 处理掉以 `_` / `.` 开头的文件

---

## 🌍 部署到 GitHub Pages

这个站是纯静态的，Pages 直接发 `main` 分支根目录：

1. 推到 GitHub 仓库
2. **Settings → Pages**
3. **Build and deployment** 选 *Deploy from a branch*
4. Branch 选 `main`，folder 选 `/(root)`，保存
5. 几分钟后访问 `https://<account>.github.io/<repository>/`

> 想用自定义域名：把 `CNAME` 写到仓库根目录，Pages 会自动接管。

---

## 🎓 学习路径

按顺序走最扎实：

| 步骤 | 路径 | 作用 |
| --- | --- | --- |
| 01 | `learn/` | 通读教程，建立概念 |
| 02 | `learn/#lifecycle` | 回头看一遍核心数据流 |
| 03 | `quiz/` | 100 分自测，**纯净环境，看不到教程** |
| 04 | `results/` | 查每题对错 + 应该回到哪一章复习 |

---

## 🤝 怎么贡献

最适合的几种贡献方式：

- **修内容错别字 / 改进讲法**：直接改 `content/` 下的源文件
- **加章节**：在 `content/` 加新文件，然后在 `learn/` 引入
- **加题目**：在 `content/quiz/` 加题，`results/` 解析页会自动渲染
- **翻译**：英文版缺内容时，欢迎补 `en/` 下对应文件

提 PR 前建议本地跑一遍 `python3 -m http.server`，确认中英两版 + quiz + results 都能正常打开。

---

## 📄 License

MIT（按仓库现状；如有变更以仓库内 LICENSE 为准）。
