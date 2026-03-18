import pytest
from unittest.mock import patch, AsyncMock
from src.services.openai_service import OpenAIService, ImageGenerationError

class MockData:
    def __init__(self, url):
        self.url = url

class MockResponse:
    def __init__(self, url):
        self.data = [MockData(url)]

@pytest.mark.asyncio
async def test_generate_image_success():
    service = OpenAIService()
    mock_url = "https://mocked.dalle.url/image.png"
    
    with patch.object(service.client.images, 'generate', new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = MockResponse(mock_url)
        
        result = await service.generate_image("A futuristic city")
        
        assert result == mock_url
        mock_generate.assert_called_once()

@pytest.mark.asyncio
async def test_generate_image_failure_empty_data():
    service = OpenAIService()
    
    with patch.object(service.client.images, 'generate', new_callable=AsyncMock) as mock_generate:
        mock_generate.return_value = MockResponse(None)
        
        with pytest.raises(ImageGenerationError):
            await service.generate_image("A futuristic city")
