# Git 状况与规则（myqy fork）

> 本文件记录本 fork 当前的 Git 布局、分支模型、提交与推送规则。任何 AI agent 或贡献者在做
> 分支、提交、推送、拉取或合并上游等操作前，必须先读本文件；它覆盖 `AGENTS.md` 中与 git
> 相关的通用描述。隐私与脱敏口径仍以 `AGENTS.md`「隐私与本地环境信息」为准。

最后更新：2026-09-30

## 1. 远程仓库布局

| 远程名 | 地址 | 权限 | 用途 |
| --- | --- | --- | --- |
| `origin` | `https://github.com/H1A396/myqy-Serpent.git` | 可写 | 本 fork，日常 push 目标 |
| `upstream` | `https://github.com/dolag233/Serpent.git` | 只读 | 原项目，仅用于拉取更新与发起 PR |

规则：

- **只向 `origin` 推送**；永远不要向 `upstream` 推送。
- 拉取上游更新只走 `upstream`。不要使用 GitHub 网页上的「Sync fork」按钮：它只会更新同名
  分支，在功能分支上会提示丢弃本地提交。
- 不从 `upstream/main` 直接开发。`main` 是发布基线，已剥离 `docs/internal/`、`.beads/`、
  `.github/`，日常开发一律基于 `upstream/dev`。

## 2. 分支模型

- 长期开发分支基于 **`upstream/dev`**。
- 当前主开发分支：`feature/web-share-on-latest`，跟踪 `origin/feature/web-share-on-latest`，
  基点 `ce53624f`。
- 本地可能保留历史迭代分支（旧版本快照）作备份，默认不推送。
- 命名沿用上游惯例：新功能 `feature/<名称>`，修复 `fix/<名称>`。

## 3. 提交信息规范

- **语言**：提交信息优先使用中文，除非专有名词或技术术语需要保留英文（如 `web-share`、
  `library-service`、类型名、命令名）。
- **标题必须与本次改动相符**：标题要准确概括这次做了什么，禁止与内容不符的泛化标题（例如把
  新增功能写成 `chore`、把界面改动写成 `refactor`）。改动跨多个主题时，按主题拆成多个提交，
  不要用一个标题掩盖一堆不相干内容。
- **格式**：Conventional Commits —— `<type>(<scope>): <简述>`；必要时在标题末尾附工单号，
  例如 `fix(viewer): 切换视频资产后连贯自动播放 (Serpent-xxxxxxxx)`。
  常用 `type`：`feat`（新功能）、`fix`（缺陷修复）、`docs`（文档）、`test`（测试）、
  `refactor`（重构）、`perf`（性能）、`build`（构建/打包）、`chore`（杂项）。
- 正文（可选）用于说明动机、影响面与验证结果；不要用正文替代准确的标题。

## 4. 提交身份

- 提交身份使用**仓库级** `git config` 的 `user.name` / `user.email`，已固定为 fork 所有者的
  GitHub 账号。**不要**改成上游作者或任何其他人的身份。
- 历史教训：早期提交曾误用上游作者的姓名与邮箱（2026-09-30 已整体改写修正）；新增提交务必
  先确认 `git config user.name` / `user.email` 正确。
- 不在提交内容里写入任何本机路径、用户名、机器名、域名、主机名或凭据（见 `AGENTS.md`
  隐私条款）。

## 5. 提交与推送的时机（强制）

- **本地提交**：每次对话（会话）结束前，必须把本次改动提交到本地仓库，不要把未提交的改动
  留在工作区。提交前先跑与改动范围匹配的门禁（见 `AGENTS.md`「测试范围分级」）。
- **推送远程**：**只有用户明确要求时才允许 `git push`**，不得自作主张推送。
- **合适的推送时机**（满足任一即可，由 AI 主动询问用户后执行，避免频繁推送）：
  1. 本地未推送的提交累计达到 **5 个及以上**；
  2. 距上一次推送已超过 **12 小时**（通常意味着跨了半天或跨天的工作）；
  3. 完成一个可交付的里程碑：一个功能做完并通过门禁、一批缺陷修复收口，或一段工作告一段落；
  4. 用户明确要求推送 —— 此时直接执行，无需再问。
- 目的：在「云端备份」与「不频繁打扰」之间取平衡。未推送期间改动只存在本地、有丢失风险，
  因此不要长期堆积；也不要每个小提交都推。
- 推送目标永远是 `origin`（见 §1）。

## 6. 与上游同步

```bash
git fetch upstream --tags --prune
git merge upstream/dev          # 在功能分支上执行
```

- 合并上游后，按 `AGENTS.md`「测试范围分级」重跑与改动范围匹配的门禁；触及资源库相关路径时
  必须完整跑 `npm run test:library-availability`。
- **禁止**把 `upstream/main` 合并进功能分支。

## 7. 已知的合并冲突点

本 fork 相对上游的自有改动会在这几处反复冲突，合并上游时按「保留本 fork 内容」处理，逐个
确认上游没有引入等价改动：

- `AGENTS.md`：文件末尾的 `<!-- BEGIN myqy-fork-rules -->` 到 `<!-- END myqy-fork-rules -->`
  声明块为本 fork 所有，冲突时保留本 fork 版本。
- `docs/myqy/`：完全属于本 fork，上游没有对应文件。
- web-share 功能涉及的源码与协议文件（`src/myqy-web-share/`、`src/worker/web-share-*`、
  `src/shared/web-share.ts` 及相关协议与界面文件）：以本 fork 当前实现为准。

## 8. 本地专有忽略项

以下内容通过 `.gitignore` 排除，不随仓库发布：

- IDE 本机状态：`.vs/`、`.idea/`、`*.suo`、`*.user`。
- 本机环境类速查文档（含本机隧道 / 域名 / 端口等个人环境信息）。

新增此类本机文件时，一律先加进 `.gitignore`，不要提交。

## 9. 发布与向上游提交

- 向上游贡献时，PR 的 base 必须是 `upstream` 的 **`dev`** 分支（见上游
  `docs/developer/contributing.md`）。
- 不要把本 fork 的内部文件（`.beads/`、`.github/`、`docs/internal/`）带进面向 `main` 的
  发布流程。
