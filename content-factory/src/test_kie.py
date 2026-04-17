import asyncio
import httpx

async def test():
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            'https://api.kie.ai/api/v1/gpt4o-image/generate',
            json={'prompt': 'test', 'size': '1:1', 'isEnhance': False},
            headers={'Authorization': 'Bearer 6203408fc927b81d25da670e3be19a48'}
        )
        data = resp.json()
        print('Post:', data)
        tid = data.get('data', {}).get('taskId')
        if tid:
            for _ in range(60):
                await asyncio.sleep(5)
                r = await client.get(
                    f'https://api.kie.ai/api/v1/gpt4o-image/record-info?taskId={tid}',
                    headers={'Authorization': 'Bearer 6203408fc927b81d25da670e3be19a48'}
                )
                poll_data = r.json()
                print('Poll:', poll_data)
                
                status = poll_data.get("data", {}).get("status")
                print('Extracted Status:', status)
                
                response_data = poll_data.get("data", {}).get("response") or {}
                
                if status == 'SUCCESS':
                    print('Final Response Data:', response_data)
                    break

asyncio.run(test())
