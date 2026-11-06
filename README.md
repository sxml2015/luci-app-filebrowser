# luci-app-filebrowser（25.12 移植版）

把 [DarkDean89/luci-app-filebrowser](https://github.com/DarkDean89/luci-app-filebrowser)
这个老的文件助手插件，移植到 **coolsnowwolf/lede 当前源码（LuCI feed 为
`openwrt-25.12` 分支，OpenWrt 25.12）** 上使用。

## 为什么不能直接用原版

原版是老 LuCI 时代的写法，在 25.12 上有几个根本问题：

1. **打包方式作废**：原版 Makefile 用 `ar` 手工拼 `.ipk`；25.12 已改用
   **apk** 包格式，且 LuCI 应用必须走 `luci.mk` 的标准包结构。
2. **Lua 运行时已是兼容层**：原版是 Lua 控制器 + `.htm` 模板，在 25.12 里这
   属于被淘汰的 “Lua compatibility mode”，新固件不保证预装
   `luci-compat`/`luci-lua-runtime`。
3. **实现脆弱**：后端用 `ls -lh` 的文本输出再在前端正则解析，文件名带空格就
   会错位；列表顺序、链接判断都靠字符串首字母猜。
4. **有命令注入隐患**：删除/重命名把用户输入直接拼进 `rm -r "..."`、
   `mv "..." "..."` 等 shell 命令；且原代码判断“是否为目录”的 Lua 逻辑有 bug
   （字符串 `"0"` 在 Lua 中为真，删除永远按目录走 `rm -r`）。

## 移植版做了什么

按 25.12 官方示例应用 `luci-app-example`（coolsnowwolf/luci 的
openwrt-25.12 分支）的结构完全重写，功能与原版保持一致：

| 功能 | 原版 | 移植版 |
| --- | --- | --- |
| 目录浏览（前进/后退） | Lua + ls 解析 | JS 视图 + `history.pushState` |
| 文件列表 | 解析 `ls -lh` 文本 | rpcd 返回结构化 JSON（ucode `lsdir`+`stat`） |
| 下载/打开 | Lua ltn12 推流 | RPC 读取 + 浏览器 Blob 下载（≤32 MiB） |
| 上传 | multipart + Lua 文件句柄 | RPC base64 写入（≤32 MiB） |
| 重命名 | shell `mv` | ucode `fs.rename`（目标存在时拒绝覆盖） |
| 删除 | shell `rm -r` | ucode 递归删除（符号链接不跟随，拒绝删 `/`） |
| 符号链接跳转 | ls 文本拼路径 | 后端返回链接目标与解析后的类型（目录/文件/失效） |
| 新建文件夹 | 无 | 新增（`fs.mkdir`） |
| 权限控制 | 靠 LuCI 登录 | menu.d + rpcd ACL（`luci-app-filebrowser`） |

后端 **不拼任何 shell 命令**，路径在服务端做归一化处理（处理 `.`、`..`，
拒绝相对路径）。注意：本插件的设计目标和原版一致，是给**已登录的管理员**
管理整台路由器的文件系统，ACL 只授予本应用的 RPC 对象，请不要把它暴露给
低权限账户。

## 目录结构

```
luci-app-filebrowser/
├── Makefile
├── htdocs/luci-static/resources/view/system/filebrowser.js   # 前端视图
├── po/zh_Hans/filebrowser.po                                  # 简体中文翻译
└── root/
    ├── etc/uci-defaults/90-luci-app-filebrowser
    └── usr/share/
        ├── luci/menu.d/luci-app-filebrowser.json              # 系统菜单入口
        └── rpcd/
            ├── acl.d/luci-app-filebrowser.json                # 权限
            └── ucode/luci.filebrowser                         # 后端（ucode）
```

## 编译安装（在 LEDE 源码树里）

```sh
# 1. 把本目录放进 LEDE 源码（二选一）
cp -r luci-app-filebrowser  <lede源码>/package/luci-app-filebrowser
# 或者放进 LuCI feed，并把 Makefile 里的 include 改成 ../../luci.mk：
# cp -r luci-app-filebrowser <lede源码>/feeds/luci/applications/

# 2. 刷新 feed 并选上
./scripts/feeds update luci
./scripts/feeds install luci-app-filebrowser   # 放在 package/ 时可跳过
make menuconfig   # LuCI > Applications > luci-app-filebrowser 勾选

# 3. 单独编译这个包
make package/luci-app-filebrowser/compile V=s
```

产物在 `bin/packages/<架构>/luci/` 下，是 25.12 的 **`.apk`** 文件，例如
`luci-app-filebrowser-<版本>-r<修订>.apk`。

在已刷好的 25.12 固件上安装自己编译的未签名包：

```sh
apk add --allow-untrusted ./luci-app-filebrowser-*.apk
rm -rf /tmp/luci-indexcache /tmp/luci-modulecache
/etc/init.d/rpcd restart
```

装好后在 LuCI 的 **系统（System）** 菜单下会出现 **文件管理（Document
Management）** 入口（位置与原版一致，排序 60）。

## 已知限制（v1）

- 下载/上传经 RPC base64 传送，单文件上限 **32 MiB**，不适合传固件镜像等
  大文件；大文件请用 scp/sftp。原版的流式下载没有这个上限，这是本次移植
  为换取无 Lua、无 shell 拼命令而付出的取舍，后续可通过增加一个带会话校验的
  CGI 下载端点来恢复流式下载。
- 删除目录为递归删除且不可恢复，界面会要求确认，但请谨慎操作 `/etc`、
  `/usr` 等系统目录。
- 界面为单页应用，依赖 25.12 自带的 LuCI JS 框架；在 24.10 及更早的固件上
  请使用原版或自行回移，本移植版只针对 25.12 验证结构。

## 验证情况

- 目录结构、Makefile、menu.d、ACL 均对照 coolsnowwolf/luci
  `openwrt-25.12` 分支的 `luci-app-example` 校验。
- 前端 JS 通过 `node --check` 语法校验；JSON 文件通过解析校验；后端 ucode
  逻辑按 luci-base 自带 rpcd ucode 脚本的 API 用法编写（`fs` 模块的
  `lsdir/stat/readlink/rename/unlink/mkdir/rmdir/readfile/writefile`）。
- 后端 ucode 已用本地编译的 ucode 解释器 + fs 模块做过**功能实测**（测试
  目录含带空格文件名、二进制文件、指向文件/目录/失效目标的符号链接）：
  列表、路径归一化、拒绝删 `/`、mkdir、rename（拒绝覆盖）、二进制
  write/read 往返、递归删除、删目录型符号链接只删链接不删目标，全部通过。
- **尚未在真实 25.12 设备上刷机实测**：最终请先在测试机上编译安装验证
  一遍（尤其是 rpcd ACL 生效与菜单出现），再用于正式设备。

## 致谢

原插件作者 giaulo / DarkDean89，本仓库为其在新固件上的移植实现。
