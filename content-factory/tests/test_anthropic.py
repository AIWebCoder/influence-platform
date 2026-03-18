import pytest
import json
from unittest.mock import patch, AsyncMock
from src.services.anthropic_service import AnthropicService, ContentGenerationError

# Mock response structure for anthropic client
class MockMessage:
    def __init__(self, text):
        self.text = text

class MockResponse:
    def __init__(self, text):
        self.content = [MockMessage(text)]

@pytest.mark.asyncio
async def test_generate_caption_success():
    service = AnthropicService()
    
    mock_json = '{"caption": "Mocked caption", "hashtags": ["#mock"]}'
    
    with patch.object(service.client.messages, 'create', new_callable=AsyncMock) as mock_create:
        mock_create.return_value = MockResponse(mock_json)
        
        result = await service.generate_caption("tech")
        
        assert result["caption"] == "Mocked caption"
        assert result["hashtags"] == ["#mock"]
        mock_create.assert_called_once()


@pytest.mark.asyncio
async def test_generate_caption_markdown_stripping():
    service = AnthropicService()
    
    # Simulate Claude sometimes wrapping JSON in markdown
    mock_json_md = '```json\n{"caption": "Cleaned caption", "hashtags": ["#clean"]}\n```'
    
    with patch.object(service.client.messages, 'create', new_callable=AsyncMock) as mock_create:
        mock_create.return_value = MockResponse(mock_json_md)
        
        result = await service.generate_caption("tech")
        
        assert result["caption"] == "Cleaned caption"
        assert result["hashtags"] == ["#clean"]


@pytest.mark.asyncio
async def test_generate_caption_invalid_json():
    service = AnthropicService()
    
    # Simulate completely invalid JSON
    mock_invalid = "This is just text, not JSON"
    
    with patch.object(service.client.messages, 'create', new_callable=AsyncMock) as mock_create:
        mock_create.return_value = MockResponse(mock_invalid)
        
        with pytest.raises(ContentGenerationError):
            await service.generate_caption("tech")
