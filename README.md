# Financial Times PressReader 双语归档

本项目从 FT PressReader 报纸预览页获取指定日期的完整板块列表和报道详情，下载原始图片，生成中文标题、逐段中英对照、中文解读与 glossary，并按报纸期次写入本地数据库。

## 数据来源

期次入口格式：

```text
https://ft.pressreader.com/v99c/YYYYMMDD/textview
```

例如 `https://ft.pressreader.com/v99c/20260818/textview`。PressReader 会自动跳转到该日期实际期次的文本视图 URL。

抓取流程：

1. 先访问 FT 的 `todaysnewspaper/edition/uk`，完成 FT 订阅到 PressReader 的 ePaper 授权握手。
2. 打开日期入口并校验跳转后的期次日期。
3. 等待“文本视图”加载；如果传入的是旧页面视图 URL，则自动切换。
4. 依次访问文本视图中的全部板块，只获取板块和稳定 article ID 等候选信息。
5. 每篇都打开 `https://ft.pressreader.com/v99c/YYYYMMDD/{article_id}` 详情页，从详情 DOM 获取标题、作者、完整正文和图片。
6. 拒绝以省略号结尾的截断预览，清理 soft hyphen 后再进入翻译与归档流程。

项目不再读取 FT RSS，也不访问 `ft.com/content/...` 详情页。PressReader 如果只向当前浏览器
profile 返回以省略号结尾的列表预览，程序会明确中止，不会把预览当成详情归档；此时需要确认
项目 profile 已登录 FT，且订阅包含 Digital Edition，再重新运行。

## 安装

```bash
cd /Users/luzhe/Desktop/code/agent_skills/ft_archiver_skill
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

完整翻译需要在 `.env` 配置 `LLM_API_KEY`。PressReader 页面由项目独立 Chromium profile 打开，
该 profile 必须具备完整详情访问权限。

## 使用

```bash
# 自动抓取 FT 当前最新可用期次（适合定时任务）
python sync_ft.py

# 只查看 2026-08-18 的报道列表，不写数据库
python sync_ft.py --date 2026-08-18 --dry-run

# 抓取 1 篇，只保存英文和原始图片
python sync_ft.py --date 2026-08-18 --limit 1 --no-llm

# 完整处理指定期次
python sync_ft.py --date 2026-08-18

# 显式传入日期入口
python sync_ft.py \
  --date 2026-08-18 \
  --preview-url 'https://ft.pressreader.com/v99c/20260818/textview'

# 保存板块和卡片诊断数据
python sync_ft.py --date 2026-08-18 --dry-run --debug-data ./debug

# 从根数据库重建每日数据库和索引
python sync_ft.py --rebuild-outputs
```

未传 `--date` 时，程序使用 FT `todaysnewspaper` 授权入口实际返回的最新可用期次。这个模式适合定时任务：无论在当天晚上、次日凌晨或周末执行，都不依赖运行机器的日期，也不会因“当天期次尚未发布”而发生日期不一致错误。

显式传入 `--date` 时仍使用严格模式；PressReader 返回其他日期会报错，避免历史补抓时误存到错误期次。

## 数据字段

- `guid`：PressReader article ID。
- `issue_date`：报纸期次日期。
- `section`：文本视图中的原始顶层板块。
- `page`：PressReader 未提供可靠文章页码，因此保存为 `null`，前端不显示。
- `published_at_utc`、`published_at_local`、`updated_at_utc`：单篇报道没有可靠发布时间，因此保留字段但保存为空字符串。
- `byline`：PressReader 提供的作者信息。
- `paragraphs`：按原始顺序保存的 `body`/`crosshead` 节点及中英对照。
- `images`：本地图片路径或下载失败时的原始 URL。
- `image_placements`：图片位置、原始 caption、credit 与 alt text。
- `image_insights`：按图片 path 保存 `image_type` 和中文 `description`；说明只翻译来源提供的 caption/alt，不根据图片猜测。

图片位置规则：

- `.article-pic-cover-wrapper` 中的图片标记为 `lead`。
- 正文 `figure` 按 DOM 顺序标记为 `after_paragraph`。
- 无法可靠确定位置时标记为 `unlocated`，前端放在文末。
- PressReader 没有提供 caption、credit 或 alt 时对应字段保持为空，不猜测。
- 中英对照区域只显示中文图片说明；使用 `--refresh-image-descriptions --date YYYY-MM-DD` 可为历史数据回填。

## 输出

```text
database.js
output_results/
├── database_index.js
└── FT/
    └── YYYY-MM-DD/
        ├── database.js
        └── images/
```

每篇完成后都会原子更新根数据库、每日数据库和总索引。`guid` 和详情 URL 均参与全局去重。

## 前端

```bash
python3 -m http.server 8765
```

打开 `http://127.0.0.1:8765/frontend/`。有 `image_placements` 时按原位置显示图片；历史数据没有该字段时继续使用旧顶部图片区域。

## 测试

```bash
python3 -m unittest discover -s tests -v
python3 -m py_compile sync_ft.py
```

单元测试使用本地构造数据，不访问 PressReader。真实页面结构可使用 `--dry-run` 验证。

归档内容仅供个人阅读和研究，不要公开发布付费正文或生成数据库。
