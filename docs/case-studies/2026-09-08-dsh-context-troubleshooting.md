# dsh-canary（canary）环境与排障实录：dsh-context 命令失效案

> 原文写于 2026-09-08，整理入 dsh-canary 项目 docs/case-studies/。本文同时是
> canary 方法论的**第一份实战案例**——用一次真实的插件排障过程，说明隔离
> DSH_HOME 环境的用法、`--patch` 禁行法二分、以及对 dsh-canary 本身 verdict
> 分类的启发（见 §5）。
> 关联 issue：[dsh-market/dsh-market#554](https://github.com/dsh-market/dsh-market/issues/554)

## 1. canary 是什么

canary 是一套**隔离的 dsh 验证环境**：独立的 `DSH_HOME`（`~/.dsh-canary`），
与日常使用的主环境（`~/.dsh`）完全隔离——会话、设置、凭据、插件互不影响。

它的用途：

- **插件兼容性验证**：升级/新装插件先在 canary 试，不拿主环境冒险
- **组合冲突排查**：主环境几十个插件出问题时，在 canary 里复现、二分定位
- **危险操作预演**：任何"不确定会不会搞坏配置"的实验

它也是本项目（`@mars.liu/dsh-canary`）的 manual 实例：L0 自动验证做的事，
正是把下面这套手动流程自动化、产品化。

## 2. 快速上手

```sh
# 全新环境：安装待验证插件（以 dsh-context 为例）
DSH_HOME=~/.dsh-canary dsh plugin --profile web add dsh-context

# 启动（自动开浏览器；换端口即可多实例并存）
DSH_HOME=~/.dsh-canary dsh web --port 3180

# 克隆主环境 profile 做组合复现（含全部插件与 node_modules）
cp -R ~/.dsh/profiles/web ~/.dsh-canary/profiles/web-main
DSH_HOME=~/.dsh-canary dsh --profile web-main --port 3181

# 关键武器：--patch 叠加"禁用行"补丁，不必改动 profile 本身
DSH_HOME=~/.dsh-canary dsh --profile web-main --patch /tmp/bisect.yml --port 3181
```

### API key 从环境变量取（免首启输入）

`~/.dsh-canary/settings.yaml`：

```yaml
llm-deepseek:
  apiKeyEnv: DEEPSEEK_API_KEY
```

启动时进程环境里带 `DEEPSEEK_API_KEY` 即可，密钥不落盘：
`DEEPSEEK_API_KEY=xxx DSH_HOME=~/.dsh-canary dsh web --port 3180`

### 注意事项（实战踩坑）

- **token 是启动时一次性打印的**：URL 必须从启动日志原样复制
  （`grep -o "http://127.0.0.1:PORT/?token=.*" <log>`）；手抄必错
- **curl 探测会消耗/干扰 token**，被 web 的浏览器信任机制挡住是正常的——
  交互验证只能用真实浏览器
- 用 `--patch` 叠加多层时，注意**别把同一补丁文件拼接两次**（行重复无害但
  会让你误判轮次）；每轮重启前核对 `grep -c "disabled: true" <patch>`

## 3. 实战案例：dsh-context 的 /context 命令失效

### 3.1 症状

主环境（dsh 0.1.2-rc.1 + 33 个插件）启用 `dsh-context@0.46.0` 后：

- 输入 `/context` 不弹窗，命令像普通消息一样被发出
- `/` 命令面板里没有 context 项（内置命令如 compact 正常）
- 宿主日志零报错、浏览器 console 无显眼报错——**静默失效**
- 期间宿主进程 pid 多次变化，一度误判为"调用即崩溃"
  （事后证明是我们自己 kill/重启造成的巧合）

### 3.2 排障路径

```
假设 1：宿主没重载 patch（启用插件与宿主启动同秒，存在竞态）
  → 用户重启主环境后仍失效 → 排除

假设 2：dsh-context 0.46.0 版本回归（发布仅 20 小时）
  → canary 单插件环境 0.45.0 正常；升到 0.46.0 仍正常 → 排除

假设 3：主环境插件组合冲突
  → 克隆主 profile 到 canary（web-main）复现成功 → 实锤，进入二分
```

### 3.3 六轮二分（`--patch` 禁行法）

| 轮 | 禁用范围 | 结果 | 结论 |
|---|---|---|---|
| 1 | web-all 聚合 19 行 | 失效 | 元凶不在 web-all |
| 2 | + 富编辑器 + 侧栏替换 | 失效 | 不在编辑器/侧栏 |
| 3 | + 前一半独立插件（12 个） | **生效** | 元凶在这 12 个里 |
| 4 | 12 个对半分（A1 恢复） | 失效 | 元凶在 A1 六个里 |
| 5 | A1 再对半（genui/balance/pins 禁） | 失效 | 元凶在 market/ppt/convmap |
| 6 | 在第 4 轮基线上**仅追加禁用 dsh-market** | **生效** | **元凶 = dshmarket** |

> 说明：第 6 轮并非"全局只禁一行"，而是在已证明无害的 A2 禁用基线上仅追加
> `dsh-market` 一项——差分归因依然唯一。现场补丁 `/tmp/bisect-r4..r6.yml`
> 的首行注释均停留在 "round 4"（复制模板未改），核对内容以
> `grep -o 'id: …' <patch>` 为准，不要信注释。

> 教训：第 4 轮曾因补丁拼接失误，实际内容与第 3 轮相同（`/tmp/bisect-r3.yml`
> 至今残留 54 行 = 两遍拼接的痕迹），"生效"是假信号。
> 每轮必须核对补丁行数再让用户测试。

### 3.4 根因

`dshmarket@1.45.0` 的 client manifest 注入 `@deepseek-ai/dsh-client-runtime`——
该 seam 在 dsh 0.1.2-rc.1 上不完整（已知 aionui-panel 因同一 seam 直接 fail
boot 的前科）。dshmarket 不崩溃，但其 client 初始化失败被静默吞掉，**阻断了
同页后续 client 插件模块的加载/注册链**，dsh-context 的命令因此从未注册。

最小复现组合：`dsh-base + dsh-web-app + dsh-context + dshmarket`。

### 3.5 处置

- 已提交 issue：[dsh-market/dsh-market#554](https://github.com/dsh-market/dsh-market/issues/554)
- 主环境取舍：插件市场为日常必需 → **dsh-market 启用、dsh-context 禁用**
  （取舍理由已注释在主环境 `cordis.patch.yml`）
- 恢复路径：dshmarket 修复发版 → canary 升级验证共存 → 主环境两行布尔对调

## 4. 方法论沉淀

1. **先分轨**：宿主问题看全局稳定版，项目集成问题看项目锁定的 tag
   （本项目双轨：主环境 0.1.2-rc.1 / knowledge 集成 0.1.3-alpha.2）
2. **静默失效比崩溃难排**：无报错时唯一可靠的手段就是隔离复现 + 二分
3. **`--patch` 禁行法**是 dsh 插件二分的标准武器：不动物理安装，只叠逻辑层，
   每轮一个 YAML、重启 12 秒、log n 轮收敛
4. **每轮验证补丁内容**（行数 + id 清单），拼接失误会产生假信号浪费一轮
5. 浏览器 console 里的 `contentscript.js`/`injected.js` 报错是扩展噪音；
   但排除扩展嫌疑只需一句反证：同一浏览器下 canary 正常 → 扩展无罪

## 5. 对 dsh-canary 的启发：L0 verdict 的盲区

本案对 dsh-canary 是一记警钟：**dshmarket 破坏了 dsh-context，但 dshmarket
自己 boot-ok**。当前 L0 的判定维度全部围绕"这个组合能不能起来"：

| verdict | 本案中 dshmarket 会得到 |
|---|---|
| boot-fail / hang / crash | 不会触发（它自己能起来） |
| probe-pass（自身 primary service 可解析） | 大概率通过（它自己的服务没坏） |
| **它杀死了同页其他 client 插件的注册链** | **任何维度都看不见** |

即：加害者无罪，受害者（dsh-context）如果不进 probe 名单也无人报错。缺口在
**victim 视角**——boot 存活 ≠ 页面生态健康。可能的演进方向（未定案）：

1. **新 verdict 维度**：`probe-collateral`——在 probe overlay 中除了探测候选
   插件自身，还探测组合里**既有** client 插件的注册面（命令/面板/服务是否
   仍注册）。候选加入前后对比，注册面缩水即降级 `ok`。
2. **functional probe 升维**：从 presence-level（服务可解析）扩展到
   registration-level（UI 命令、slash command 等注册成功），本案中
   dsh-context 的 `/context` 未注册正是这类信号。
3. 保守起步：至少在 diagnostics 里输出"组合内 N 个 client 插件注册了 M 个"，
   作为人工研判线索而非 block 条件。

## 附录 A：手动 canary 环境现状与可复用命令（2026-09-08 整理时点）

环境现状：

- `~/.dsh-canary/profiles/`：`web`（单插件验证用）、`web-main`（主环境完整
  克隆，含 `node_modules` 与 `cordis.patch.yml`）
- 3180 / 3181 两个实例当前**未在运行**（排障结束后已关闭，随时可按下述命令
  重启；`--patch` 是叠加层，profile 不受影响）
- 现场补丁 `/tmp/bisect-r3.yml` ~ `/tmp/bisect-r6.yml` 仍在（注意首行注释
  有误，见 §3.3 说明）

可复用手动工作流：

```sh
# 0) API key 走环境变量（~/.dsh-canary/settings.yaml 已配 apiKeyEnv）
export DSH_HOME=~/.dsh-canary

# 1) 启动单插件验证实例（web，3180）
DEEPSEEK_API_KEY=xxx dsh web --profile web --port 3180 \
  2>&1 | tee /tmp/canary-web.log
grep -o 'http://127.0.0.1:3180/?token=.*' /tmp/canary-web.log   # 复制进浏览器

# 2) 启动组合复现实例（web-main 克隆，3181），叠加二分补丁
DEEPSEEK_API_KEY=xxx dsh --profile web-main --port 3181 \
  --patch /tmp/bisect-r6.yml 2>&1 | tee /tmp/canary-main.log
grep -o 'http://127.0.0.1:3181/?token=.*' /tmp/canary-main.log

# 3) 每轮二分三步：改补丁 → 核对内容 → 重启验证
grep -o 'id: [a-z@/.-]*' /tmp/bisect-rN.yml          # 核对禁用清单（别信注释）
grep -c 'disabled: true' /tmp/bisect-rN.yml          # 核对行数

# 4) 结束后清理监听
# lsof -iTCP:3181 -sTCP:LISTEN   → kill <pid>
```

交互验证只能用真实浏览器（curl 会消耗/干扰一次性 token，见 §2）。
