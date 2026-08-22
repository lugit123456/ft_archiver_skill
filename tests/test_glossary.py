from __future__ import annotations

import json
import logging
import unittest
from types import SimpleNamespace

from sync_ft import (
    DEFAULTS,
    GLOSSARY_VERSION,
    _apply_glossary_terms,
    enrich_article_glossary,
    extract_zh_english_candidates,
)


SAMPLE_ZH = (
    "弗拉基米尔·泽连斯基（Volodymyr Zelensky）对内阁进行了改组，"
    "导致尤莉娅·斯维里登科（Yuliia Svyrydenko）在任总理仅一年后辞职。"
    "国防部长米哈伊洛·费多罗夫（Mykhailo Fedorov）也被撤职。"
)
DESCRIPTION = (
    "这是用于回归验证的中文背景说明，明确交代人物身份、所处政治环境以及他在本文所述"
    "内阁改组中的作用，帮助读者理解相关人事变化为何重要，同时不引入文章之外未经证实的事实。"
)


def _config() -> dict[str, object]:
    config = {key: dict(value) for key, value in DEFAULTS.items()}
    config["glossary"]["max_retries"] = 0  # type: ignore[index]
    return config


def _term(name: str, *, paragraph_index: int = 1, surface: str | None = None) -> dict[str, object]:
    return {
        "term": name,
        "term_zh": "",
        "type": "person",
        "description_zh": DESCRIPTION,
        "occurrences": [{
            "paragraph_index": paragraph_index,
            "text_field": "zh_text",
            "surface": surface or name,
            "occurrence": 1,
        }],
    }


class _FakeCompletions:
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        self.payloads = payloads
        self.calls = 0

    def create(self, **_: object) -> SimpleNamespace:
        payload = self.payloads[self.calls]
        self.calls += 1
        message = SimpleNamespace(content=json.dumps(payload, ensure_ascii=False))
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])


class GlossaryTests(unittest.TestCase):
    def test_ignores_country_abbreviation_and_preposition_fragments(self) -> None:
        paragraphs = [{
            "zh_text": "美国（U.S.）与中国银行（Bank of China）的合作并不等于解释 of China。",
        }]
        candidates = extract_zh_english_candidates(paragraphs)
        surfaces = {item["surface"] for item in candidates}
        self.assertNotIn("U.S", surfaces)
        self.assertNotIn("of China", surfaces)
        self.assertIn("Bank of China", surfaces)

    def setUp(self) -> None:
        self.article = {
            "title": "Ukraine reshuffle",
            "paragraphs": [{"en_text": "", "zh_text": SAMPLE_ZH, "role": "body"}],
        }

    def test_extracts_all_parenthesized_person_names(self) -> None:
        candidates = extract_zh_english_candidates(self.article["paragraphs"], 32)
        self.assertEqual(
            [item["surface"] for item in candidates],
            ["Volodymyr Zelensky", "Yuliia Svyrydenko", "Mykhailo Fedorov"],
        )

    def test_repairs_missing_candidates_with_second_request(self) -> None:
        completions = _FakeCompletions([
            {"terms": [_term("Volodymyr Zelensky")]},
            {"terms": [_term("Yuliia Svyrydenko"), _term("Mykhailo Fedorov")]},
        ])
        client = SimpleNamespace(chat=SimpleNamespace(completions=completions))

        result = enrich_article_glossary(client, _config(), self.article, logging.getLogger("test"))

        self.assertEqual(completions.calls, 2)
        self.assertTrue(result["glossary_analysis_complete"])
        self.assertEqual(result["glossary_version"], GLOSSARY_VERSION)
        self.assertEqual(
            [item["term"] for item in result["glossary_entries"]],
            ["Volodymyr Zelensky", "Yuliia Svyrydenko", "Mykhailo Fedorov"],
        )

    def test_recovers_wrong_paragraph_and_surface_case(self) -> None:
        result = _apply_glossary_terms(
            self.article,
            [_term("Volodymyr Zelensky", paragraph_index=99, surface="volodymyr zelensky")],
            complete=True,
        )

        self.assertEqual(result["term_annotations"][0]["paragraph_index"], 1)
        self.assertEqual(result["term_annotations"][0]["surface"], "Volodymyr Zelensky")

    def test_rejects_mismatched_term_and_surface(self) -> None:
        result = _apply_glossary_terms(
            self.article,
            [_term("Vladimir Putin", surface="Volodymyr Zelensky")],
            complete=True,
        )

        self.assertEqual(result["glossary_entries"], [])
        self.assertEqual(result["term_annotations"], [])

    def test_failed_request_is_not_marked_complete(self) -> None:
        class BrokenCompletions:
            def create(self, **_: object) -> None:
                raise ValueError("invalid request")

        client = SimpleNamespace(chat=SimpleNamespace(completions=BrokenCompletions()))
        result = enrich_article_glossary(client, _config(), self.article, logging.getLogger("test"))

        self.assertFalse(result["glossary_analysis_complete"])
        self.assertEqual(result["glossary_version"], 0)


if __name__ == "__main__":
    unittest.main()
