---
name: ft-archiver
description: 从 Financial Times PressReader 当前最新或指定日期期次的文本视图抓取全部板块和报道详情，下载并原样展示图片，生成双语归档、中文解读与 glossary。
---

# FT Archiver

## 数据规则

- 唯一列表来源为 `https://ft.pressreader.com/v99c/YYYYMMDD/textview`。
- 每次抓取前先通过 FT `todaysnewspaper/edition/uk` 激活当前 profile 的 PressReader ePaper 授权。
- 未指定日期时，以授权入口实际返回的日期抓取当前最新可用期次，适用于跨午夜和周末的定时任务。
- 显式指定日期时，日期入口跳转后必须仍是请求日期，否则停止。
- 默认直接进入文本视图；兼容旧页面视图 URL，并按导航顺序抓取全部板块。
- `data-articleid` 是报道唯一键，详情 URL 为 `/v99c/YYYYMMDD/{article_id}`。
- 列表只用于发现候选；标题、作者、正文和图片必须逐篇进入详情页获取。
- 详情正文必须来自 article 路由；以 `...` 或 `…` 结尾的单段内容属于截断预览，必须停止，禁止归档或翻译。
- 已误存的截断预览不参与完成去重；重新抓到全文后沿用原 article ID 原位替换。
- 去除 PressReader 文本中的 soft hyphen 和零宽字符。
- 页码无法可靠获得时保存为 `null`，前端不显示。
- 单篇发布时间无法可靠获得时，时间字段保留为空。
- 保留正文 `body`/`crosshead` 顺序。
- 下载头图和正文图，`image_placements` 保存位置及来源元数据，但前端只输出图片本身。
- 不把图片或来源 caption/alt 发送给 LLM，也不生成或翻译图片说明。每张图片生成同路径的 `image_insights`，`description` 默认使用单个空格 `" "`，阻止共享前端回退显示文章标题；以后需要说明时由 Python 写入真实描述。
- 正文翻译、中文标题和中文解读中的人名、公司名、机构名、品牌、平台、App、网站、产品及出版物名称保留英文原文，不音译、意译或替换成中文别称。例如始终写 `Google`、`Reddit`、`Instagram`、`TikTok`、`Sensor Tower`，不得写“谷歌”“红迪”“照片墙”“抖音海外版”“传感器塔”。
- 每篇完成后原子更新根数据库、每日数据库和总索引。

## 命令

```bash
python sync_ft.py
python sync_ft.py --date 2026-08-18 --dry-run
python sync_ft.py --date 2026-08-18 --limit 1 --no-llm
python sync_ft.py --date 2026-08-18
```

完整配置和字段说明见 `README.md`。
