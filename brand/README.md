# Brand assets

`logo.png` is the master, 1024x1024 with transparency. Nothing in the running agent reads it: eve has no logo, avatar or icon setting anywhere in `defineAgent` or elsewhere, and it serves no static directory. This file lives here rather than in `public/` for that reason, since `public/` in a Vercel repository reads as "served at the root", and this is not.

It has three homes, all of them outside this repository, and all uploaded by hand:

| Where | What it becomes | Set at |
| --- | --- | --- |
| GitHub App `baymiai` | The avatar beside `baymiai[bot]` on every comment it posts | Settings → Developer settings → GitHub Apps → Display information |
| Slack app | The icon beside its name in the digest thread and in DMs | Slack app settings → Basic Information → Display Information |
| Linear OAuth app | The agent's avatar in an Agent Session | Linear settings → API → OAuth applications |

The GitHub one is worth doing first: it appears on every pull request summary and every answered mention, which is where most people will see the agent at all.

Re-export from the master rather than from a copy that has been through an upload, and keep it square. The master is palette-encoded at quality 90, which is visually identical to the original truecolor export and a fifth of its size.
