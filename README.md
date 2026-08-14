# Agent Foundations Lab

A bilingual static learning site that explains the Agent Runtime loop through Pi:

```text
User → context + tools → LLM → Tool Call → Runtime → OS/tool → Tool Result → LLM → Session
```

## Run locally

No build tool or dependency is required.

```bash
cd agent-foundations-lab
python3 -m http.server 8080
```

Open <http://127.0.0.1:8080>.

## Deploy to GitHub Pages

This is a plain static site. GitHub Pages can publish it directly from the `main` branch root:

1. Create and push a GitHub repository.
2. Repository **Settings** → **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Choose branch `main`, folder `/(root)`, then save.
5. GitHub will publish it at `https://<account>.github.io/<repository>/`.

Quiz answers are stored only in the browser's `localStorage`.
