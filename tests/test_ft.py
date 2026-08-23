from __future__ import annotations

import json
import tempfile
import unittest
from unittest.mock import Mock, patch
from pathlib import Path

from sync_ft import (
    _group_articles_by_issue,
    _normalise_paper_article,
    _pressreader_issue_date_from_url,
    _is_truncated_pressreader_record,
    _migrate_image_description_fields,
    _write_paper_database_index,
    _write_paper_issue_database,
    PressReaderIssue,
    canonical_ft_url,
    parse_pressreader_candidate_rows,
    parse_pressreader_detail_payload,
    pressreader_first_page_cover_url,
    pressreader_issue_url,
    process_ft,
    read_database_js,
    resolve_pressreader_issue_date,
    validate_issue_date,
    write_database_js,
)


CARD_ROWS = [
    {
        "article_id": "281500758092329",
        "section": "FRONT PAGE",
        "title": "US law firms con\u00adfront sector backlash",
        "description": "A short pre\u00adview.",
        "byline": "SUZI RING — LONDON",
    },
    {
        "article_id": "281831470574121",
        "section": "OPINION",
        "title": "Burnham and the perils of cost of living policies",
        "description": "Opinion preview",
        "byline": "Stephen Bush",
    },
]


DETAIL_PAYLOAD = {
    "title": "US law firms con\u00adfront sector backlash",
    "byline": "SUZI RING — LONDON",
    "paragraphs": [
        {"role": "body", "text": "First para\u00adgraph."},
        {"role": "crosshead", "text": "The next phase"},
        {"role": "body", "text": "Second paragraph."},
    ],
    "images": [
        {
            "url": "https://t.prcdn.co/img?regionKey=lead&scale=222",
            "placement": "lead",
            "after_paragraph_index": None,
            "caption": "Lead caption",
            "credit": "FT",
            "alt_text": "Lead image",
        },
        {
            "url": "https://i.prcdn.co/img?regionKey=inline&scale=222",
            "placement": "after_paragraph",
            "after_paragraph_index": 2,
            "caption": "Inline caption",
            "credit": "",
            "alt_text": "",
        },
    ],
}


class PressReaderSourceTests(unittest.TestCase):
    def test_issue_url_and_date_validation(self) -> None:
        self.assertEqual(
            pressreader_issue_url("2026-08-18"),
            "https://ft.pressreader.com/v99c/20260818/textview",
        )
        self.assertEqual(
            _pressreader_issue_date_from_url(
                "https://ft.pressreader.com/v99c2026081800000000001001/textview"
            ),
            "2026-08-18",
        )
        self.assertEqual(
            _pressreader_issue_date_from_url(
                "https://ft.pressreader.com/v99c/20260818/textview"
            ),
            "2026-08-18",
        )
        self.assertEqual(validate_issue_date("2026-08-18"), (True, ""))
        self.assertFalse(validate_issue_date("2026/08/18")[0])

    def test_first_page_cover_uses_full_page_image(self) -> None:
        self.assertEqual(
            pressreader_first_page_cover_url(
                "https://ft.pressreader.com/v99c2026082100000000001001/textview"
            ),
            "https://t.prcdn.co/img?file=v99c2026082100000000001001&page=1&width=800",
        )
        self.assertEqual(
            pressreader_first_page_cover_url("https://ft.pressreader.com/v99c/20260821/textview"),
            "",
        )

    def test_auto_mode_accepts_latest_issue_redirect(self) -> None:
        resolved_url = "https://ft.pressreader.com/v99c2026082200000000001001/textview"
        self.assertEqual(
            resolve_pressreader_issue_date(
                "2026-08-23",
                resolved_url,
                accept_redirect=True,
            ),
            "2026-08-22",
        )
        with self.assertRaisesRegex(ValueError, "与请求日期"):
            resolve_pressreader_issue_date("2026-08-23", resolved_url)

    def test_process_auto_mode_uses_entitlement_issue_date(self) -> None:
        entitlement_url = "https://ft.pressreader.com/v99c2026082200000000001001/textview"
        page = Mock()
        issue = PressReaderIssue(
            "2026-08-22",
            entitlement_url,
            entitlement_url,
            "",
            [],
        )
        cfg = {"browser": {"user_data_path": "/tmp/ft-test", "headless": True}}
        with (
            patch("sync_ft.open_browser", return_value=page),
            patch("sync_ft.activate_pressreader_entitlement", return_value=entitlement_url),
            patch("sync_ft.discover_pressreader_issue", return_value=issue) as discover,
            patch("sync_ft.read_database_js", return_value=[]),
        ):
            self.assertEqual(process_ft(cfg, dry_run=True), [])

        self.assertEqual(discover.call_args.args[2], "2026-08-22")
        self.assertEqual(discover.call_args.kwargs["preview_url"], entitlement_url)
        self.assertTrue(discover.call_args.kwargs["accept_date_redirect"])
        page.close.assert_called_once()

    def test_candidate_rows_keep_section_order_and_empty_page(self) -> None:
        candidates = parse_pressreader_candidate_rows(CARD_ROWS, "2026-08-21")
        self.assertEqual(len(candidates), 2)
        self.assertEqual(candidates[0].guid, "281500758092329")
        self.assertEqual(candidates[0].title, "US law firms confront sector backlash")
        self.assertEqual(candidates[0].description, "A short preview.")
        self.assertEqual(candidates[0].section, "FRONT PAGE")
        self.assertIsNone(candidates[0].page)
        self.assertEqual(candidates[1].page_article_index, 2)
        self.assertEqual(
            candidates[0].url,
            "https://ft.pressreader.com/v99c/20260821/281500758092329",
        )

    def test_candidate_rows_deduplicate_article_ids(self) -> None:
        candidates = parse_pressreader_candidate_rows(CARD_ROWS + [CARD_ROWS[0]], "2026-08-21")
        self.assertEqual(len(candidates), 2)

    def test_detail_payload_preserves_blocks_and_image_placements(self) -> None:
        candidate = parse_pressreader_candidate_rows(CARD_ROWS, "2026-08-21")[0]
        article = parse_pressreader_detail_payload(DETAIL_PAYLOAD, candidate)
        self.assertEqual(article.title, "US law firms confront sector backlash")
        self.assertEqual(
            [item["role"] for item in article.paragraphs],
            ["body", "crosshead", "body"],
        )
        self.assertIn("## The next phase", article.body)
        self.assertEqual(article.image_items[0]["placement"], "lead")
        self.assertEqual(article.image_items[1]["after_paragraph_index"], 2)
        self.assertEqual(article.image_items[0]["credit"], "FT")

    def test_canonical_url_only_accepts_pressreader_details(self) -> None:
        url = "https://ft.pressreader.com/v99c/20260821/281500758092329?x=1"
        self.assertEqual(
            canonical_ft_url(url),
            "https://ft.pressreader.com/v99c/20260821/281500758092329",
        )
        self.assertEqual(canonical_ft_url("https://www.ft.com/content/example"), "")

    def test_truncated_preview_record_is_not_treated_as_complete(self) -> None:
        record = {
            "url": "https://ft.pressreader.com/v99c/20260821/281530822863401",
            "paragraphs": [{
                "en_text": "Private sector productivity grew rapidly...",
                "zh_text": "",
            }],
        }
        self.assertTrue(_is_truncated_pressreader_record(record))
        record["paragraphs"][0]["en_text"] = "A complete short article."
        self.assertFalse(_is_truncated_pressreader_record(record))


class FTStorageTests(unittest.TestCase):
    def _record(self, article_id: str = "281500758092329") -> dict:
        return {
            "id": "art_2026-08-21_001",
            "guid": article_id,
            "issue_date": "2026-08-21",
            "section": "FRONT PAGE",
            "title": "English title",
            "url": f"https://ft.pressreader.com/v99c/20260821/{article_id}",
            "page": None,
            "page_article_index": 1,
            "published_at_utc": "",
            "published_at_local": "",
            "archive_timezone": "",
            "paragraphs": [{
                "para_id": "art_2026-08-21_001_p1",
                "en_text": "English body",
                "zh_text": "",
                "role": "body",
            }],
            "images": ["images/example.jpg"],
            "image_placements": [{
                "path": "images/example.jpg",
                "placement": "lead",
                "after_paragraph_index": None,
                "caption": "Caption",
                "credit": "Credit",
                "alt_text": "Alt",
            }],
            "image_insights": [{
                "path": "images/example.jpg",
                "image_type": "photo",
                "description": "中文图片说明",
            }],
        }

    def test_guid_conflict_keeps_first_record(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "database.js"
            first = self._record()
            write_database_js([first], path)
            conflicting = dict(first, section="OPINION", title="Replacement")
            write_database_js([conflicting], path)
            rows = read_database_js(path)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["section"], "FRONT PAGE")

    def test_daily_article_keeps_empty_page_and_media_metadata(self) -> None:
        normalized = _normalise_paper_article(self._record(), 1)
        self.assertIsNone(normalized["page"])
        self.assertEqual(normalized["print_section"], "FRONT PAGE")
        self.assertEqual(normalized["source_pages"], [])
        self.assertEqual(normalized["published_at_utc"], "")
        self.assertEqual(normalized["image_placements"][0]["caption"], "Caption")
        self.assertNotIn("description_zh", normalized["image_placements"][0])
        self.assertEqual(normalized["image_insights"][0]["description"], "中文图片说明")

    def test_legacy_placement_description_moves_to_image_insights(self) -> None:
        placements, insights = _migrate_image_description_fields([{
            "path": "images/example.jpg",
            "placement": "lead",
            "caption": "Source caption",
            "description_zh": "中文图片说明",
        }])

        self.assertNotIn("description_zh", placements[0])
        self.assertEqual(insights, [{
            "path": "images/example.jpg",
            "image_type": "photo",
            "description": "中文图片说明",
        }])

    def test_daily_database_groups_articles_by_real_section(self) -> None:
        opinion = dict(
            self._record("281831470574121"),
            id="art_2026-08-21_002",
            section="OPINION",
            page_article_index=2,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            path, _, payload = _write_paper_issue_database(
                Path(temp_dir),
                "2026-08-21",
                [self._record(), opinion],
            )
            self.assertTrue(path.exists())
            self.assertEqual(
                [page["print_section"] for page in payload["pages"]],
                ["FRONT PAGE", "OPINION"],
            )
            self.assertEqual(payload["pages"][0]["pdf_page"], None)
            self.assertEqual(payload["pages"][0]["article_ids"], ["art_2026-08-21_001"])

    def test_index_contains_issue_date(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir)
            grouped = _group_articles_by_issue([self._record()])
            _write_paper_database_index(output, grouped)
            text = (output / "database_index.js").read_text(encoding="utf-8")
            payload = json.loads(text.split("=", 1)[1].strip().removesuffix(";"))
            self.assertEqual(payload[0]["publication_date"], "2026-08-21")
            self.assertEqual(payload[0]["publication_type"], "FT")


if __name__ == "__main__":
    unittest.main()
