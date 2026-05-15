from src.services.publish_validation import (
    instagram_account_missing_fields,
    is_public_http_url,
)


def test_is_public_http_url():
    assert is_public_http_url("https://cdn.example.com/v.mp4")
    assert not is_public_http_url("")
    assert not is_public_http_url("/local/path.mp4")
    assert not is_public_http_url("file:///tmp/x.mp4")


def test_instagram_account_missing_fields():
    assert instagram_account_missing_fields("123", "tok") == []
    assert "ig_user_id" in instagram_account_missing_fields("", "tok")
    assert "ig_access_token" in instagram_account_missing_fields("123", "")
