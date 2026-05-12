import asyncio
import httpx
import json

async def test_video():
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            'https://api.kie.ai/api/v1/jobs/createTask',
            json={
                "model": "kling-2.6/text-to-video",
                "input": {
                    "prompt": "testing a short vertical video",
                    "sound": False,
                    "aspect_ratio": "9:16",
                    "duration": "5"
                }
            },
            headers={'Authorization': 'Bearer 6203408fc927b81d25da670e3be19a48', 'Content-Type': 'application/json'}
        )
        data = resp.json()
        print('Post:', data)
        tid = data.get('data', {}).get('taskId')
        if tid:
            for i in range(120): # up to 10 minutes polling
                await asyncio.sleep(5)
                r = await client.get(
                    f'https://api.kie.ai/api/v1/jobs/recordInfo?taskId={tid}',
                    headers={'Authorization': 'Bearer 6203408fc927b81d25da670e3be19a48'}
                )
                poll_data = r.json()
                data_node = poll_data.get('data', {})
                state = data_node.get('state', '').lower()
                
                print(f'Poll {i} (State: {state}):')
                if state == 'success':
                    print('SUCCESS PAYLOAD DATA_NODE:', json.dumps(data_node, indent=2))
                    break
                elif state in ['failed', 'fail', 'error', 'canceled']:
                    print('TASK FAILED PAYLOAD:', json.dumps(data_node, indent=2))
                    break

asyncio.run(test_video())
