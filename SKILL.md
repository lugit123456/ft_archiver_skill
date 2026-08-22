---
name: ft-archiver
description: 从 Financial Times PressReader 指定日期期次的文本视图抓取全部板块和报道详情，下载原始图片，生成双语归档、中文解读与 glossary。
---

# FT Archiver

## 数据规则

- 唯一列表来源为 `https://ft.pressreader.com/v99c/YYYYMMDD/textview`。
- 每次抓取前先通过 FT `todaysnewspaper/edition/uk` 激活当前 profile 的 PressReader ePaper 授权。
- 日期入口跳转后必须仍是请求日期，否则停止。
- 默认直接进入文本视图；兼容旧页面视图 URL，并按导航顺序抓取全部板块。
- `data-articleid` 是报道唯一键，详情 URL 为 `/v99c/YYYYMMDD/{article_id}`。
- 列表只用于发现候选；标题、作者、正文和图片必须逐篇进入详情页获取。
- 详情正文必须来自 article 路由；以 `...` 或 `…` 结尾的单段内容属于截断预览，必须停止，禁止归档或翻译。
- 已误存的截断预览不参与完成去重；重新抓到全文后沿用原 article ID 原位替换。
- 去除 PressReader 文本中的 soft hyphen 和零宽字符。
- 页码无法可靠获得时保存为 `null`，前端不显示。
- 单篇发布时间无法可靠获得时，时间字段保留为空。
- 保留正文 `body`/`crosshead` 顺序。
- 下载头图和正文图，保存原始 caption、credit、alt 与位置；缺失值保持为空。
- 不生成图片 AI 解读，`image_insights` 保持空数组。
- 每篇完成后原子更新根数据库、每日数据库和总索引。

## 命令

```bash
python sync_ft.py --date 2026-08-18 --dry-run
python sync_ft.py --date 2026-08-18 --limit 1 --no-llm
python sync_ft.py --date 2026-08-18
```

完整配置和字段说明见 `README.md`。
