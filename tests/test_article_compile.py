from __future__ import annotations

import json
import logging
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from sync_ft import (
    DEFAULTS,
    _summary_length_bounds,
    compile_article_record,
)


def _config(*, max_retries: int = 0) -> dict[str, object]:
    config = {key: dict(value) for key, value in DEFAULTS.items()}
    config["crawl"]["max_retries"] = max_retries  # type: ignore[index]
    config["glossary"]["enabled"] = False  # type: ignore[index]
    return config


def _natural_summary() -> str:
    sentence = "文章围绕核心问题展开分析，并用关键事实解释相关风险以及政策选择。"
    paragraph = sentence * 5
    return "\n\n".join([paragraph, paragraph, paragraph])


class _FakeCompletions:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = payloads
        self.requests: list[dict[str, object]] = []

    def create(self, **kwargs: object) -> SimpleNamespace:
        self.requests.append(kwargs)
        payload = self.payloads[len(self.requests) - 1]
        message = SimpleNamespace(content=json.dumps(payload, ensure_ascii=False))
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


def _client(payloads: list[dict[str, object]]) -> tuple[SimpleNamespace, _FakeCompletions]:
    completions = _FakeCompletions(payloads)
    client = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return client, completions


class ArticleCompileTests(unittest.TestCase):
    def test_translation_and_summary_use_separate_requests_without_schema_changes(self) -> None:
        summary = _natural_summary()
        client, completions = _client([
            {
                "paragraphs": [
                    {"zh_text": "第一段自然译文。", "role": "crosshead"},
                    {"zh_text": "第二段自然译文。", "role": "body"},
                ],
            },
            {"title_zh": "自然中文标题", "summary_md": summary},
        ])

        article = compile_article_record(
            client,
            _config(),
            issue_date="2026-08-08",
            section="Leaders",
            title="A test article",
            url="https://example.com/article",
            body="First source paragraph.\n\nSecond source paragraph.",
            article_id="art_test_001",
            log_=logging.getLogger("test"),
            images=["images/example.jpg"],
        )

        self.assertIsNotNone(article)
        assert article is not None
        self.assertEqual(len(completions.requests), 2)
        translation_prompt = completions.requests[0]["messages"][1]["content"]  # type: ignore[index]
        summary_prompt = completions.requests[1]["messages"][1]["content"]  # type: ignore[index]
        self.assertIn("不写摘要", translation_prompt)
        self.assertIn("不是专名", translation_prompt)
        self.assertIn("不机械写成", translation_prompt)
        self.assertIn("必须写 Google、Reddit、Instagram、TikTok、Sensor Tower", translation_prompt)
        self.assertIn("不得写“谷歌”“红迪”“照片墙”“抖音海外版”“传感器塔”", translation_prompt)
        self.assertNotIn('"summary_md"', translation_prompt)
        self.assertIn("这不是逐段翻译", summary_prompt)
        self.assertIn("政治和外交语境", summary_prompt)
        self.assertIn("必须写 Google、Reddit、Instagram、TikTok、Sensor Tower", summary_prompt)
        self.assertNotIn('"paragraphs":', summary_prompt)
        self.assertEqual(article["title_zh"], "自然中文标题")
        self.assertEqual(article["summary_md"], summary)
        self.assertEqual([item["role"] for item in article["paragraphs"]], ["body", "body"])
        self.assertTrue(article["compiled_article"])
        self.assertEqual(article["compile_status"], "complete")
        self.assertEqual(
            set(article),
            {
                "id", "issue_date", "section", "title", "title_zh", "url",
                "summary_md", "content_raw", "content_markdown", "paragraphs",
                "images", "image_placements", "image_insights", "compiled_article", "compile_status",
                "glossary_entries", "term_annotations", "glossary_analysis_complete",
                "glossary_version",
            },
        )

    def test_translation_validation_retries_without_repeating_summary(self) -> None:
        client, completions = _client([
            {"paragraphs": []},
            {"paragraphs": [{"zh_text": "完整译文。", "role": "body"}]},
            {"title_zh": "中文标题", "summary_md": _natural_summary()},
        ])

        with patch("sync_ft.time.sleep", return_value=None):
            article = compile_article_record(
                client,
                _config(max_retries=1),
                issue_date="2026-08-08",
                section="Leaders",
                title="Retry translation",
                url="https://example.com/retry",
                body="Only one source paragraph.",
                article_id="art_test_002",
                log_=logging.getLogger("test"),
            )

        self.assertIsNotNone(article)
        self.assertEqual(len(completions.requests), 3)
        self.assertIn("忠实翻译全文", completions.requests[0]["messages"][0]["content"])  # type: ignore[index]
        self.assertIn("忠实翻译全文", completions.requests[1]["messages"][0]["content"])  # type: ignore[index]
        self.assertIn("原创编辑稿", completions.requests[2]["messages"][0]["content"])  # type: ignore[index]

    def test_source_image_metadata_is_preserved_without_image_llm_request(self) -> None:
        client, completions = _client([
            {"paragraphs": [{"zh_text": "正文译文。", "role": "body"}]},
            {"title_zh": "中文标题", "summary_md": _natural_summary()},
        ])
        placement = {
            "path": "images/example.jpg",
            "placement": "lead",
            "after_paragraph_index": None,
            "caption": "",
            "credit": "FT",
            "alt_text": "The City of London. Higher productivity could ease fiscal strains.",
        }

        article = compile_article_record(
            client,
            _config(),
            issue_date="2026-08-21",
            section="FRONT PAGE",
            title="Productivity revival",
            url="https://example.com/productivity",
            body="A complete source paragraph.",
            article_id="art_test_image_001",
            log_=logging.getLogger("test"),
            images=["images/example.jpg"],
            image_placements=[placement],
        )

        self.assertIsNotNone(article)
        assert article is not None
        self.assertEqual(len(completions.requests), 2)
        stored_placement = article["image_placements"][0]
        self.assertEqual(stored_placement["alt_text"], placement["alt_text"])
        self.assertEqual(stored_placement["credit"], "FT")
        self.assertNotIn("description_zh", stored_placement)
        self.assertEqual(article["image_insights"], [])
        self.assertNotIn("description_zh", placement)
        self.assertTrue(article["compiled_article"])

    def test_existing_chinese_caption_is_not_promoted_to_image_insight(self) -> None:
        client, completions = _client([
            {"paragraphs": [{"zh_text": "正文译文。", "role": "body"}]},
            {"title_zh": "中文标题", "summary_md": _natural_summary()},
        ])
        article = compile_article_record(
            client,
            _config(),
            issue_date="2026-08-21",
            section="FRONT PAGE",
            title="Chinese caption",
            url="https://example.com/chinese-caption",
            body="A complete source paragraph.",
            article_id="art_test_image_002",
            log_=logging.getLogger("test"),
            images=["images/example.jpg"],
            image_placements=[{
                "path": "images/example.jpg",
                "placement": "lead",
                "caption": "伦敦金融城资料照片",
                "credit": "FT",
                "alt_text": "",
            }],
        )

        self.assertIsNotNone(article)
        assert article is not None
        self.assertEqual(len(completions.requests), 2)
        self.assertEqual(article["image_insights"], [])
        self.assertNotIn("description_zh", article["image_placements"][0])

    def test_summary_length_expands_with_source_size(self) -> None:
        self.assertEqual(
            _summary_length_bounds([{"en_text": "word " * 900}]),
            (420, 650),
        )
        self.assertEqual(
            _summary_length_bounds([{"en_text": "word " * 901}]),
            (520, 800),
        )
        self.assertEqual(
            _summary_length_bounds([{"en_text": "word " * 1801}]),
            (620, 1000),
        )


if __name__ == "__main__":
    unittest.main()
