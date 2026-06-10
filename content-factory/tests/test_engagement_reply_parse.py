from src.services.engagement_reply_service import _looks_truncated, _parse_reply_payload


def test_parse_full_json():
    assert _parse_reply_payload('{"reply": "Bonjour !"}') == "Bonjour !"


def test_parse_truncated_json():
    raw = '{"reply": "Bonjour ! Un petit test ? On espere que'
    assert _parse_reply_payload(raw) == "Bonjour ! Un petit test ? On espere que"


def test_parse_plain_text():
    assert _parse_reply_payload("Bonjour direct") == "Bonjour direct"


def test_looks_truncated_detects_mid_sentence_cut():
    assert _looks_truncated("Bonjour ! N'hésitez pas si vous avez des questions sur nos ast") is True


def test_looks_truncated_accepts_complete_sentence():
    assert _looks_truncated("Bonjour ! N'hésitez pas si vous avez des questions sur nos astuces.") is False
