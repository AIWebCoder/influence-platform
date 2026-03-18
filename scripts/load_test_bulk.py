import asyncio
import httpx
import time
import uuid

API_URL = "http://localhost:8000"
TOTAL_REQUESTS = 50

async def hammer_api(client, i):
    payload = {
        "niche": "tech",
        "type": "post",
        "target_accounts": [f"bot_{i}"]
    }
    try:
        response = await client.post(f"{API_URL}/content/generate", json=payload)
        return response.status_code, response.json()
    except Exception as e:
        return 500, str(e)

async def main():
    print(f"🚀 Démarrage du Load Test : Simulation de {TOTAL_REQUESTS} requêtes de génération...")
    start_time = time.time()
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        tasks = [hammer_api(client, i) for i in range(1, TOTAL_REQUESTS + 1)]
        results = await asyncio.gather(*tasks)
        
    end_time = time.time()
    
    successes = sum(1 for status, _ in results if status in (200, 201))
    errors = TOTAL_REQUESTS - successes

    print("=========================================")
    print(f"✅ Succès : {successes}/{TOTAL_REQUESTS}")
    print(f"❌ Erreurs : {errors}/{TOTAL_REQUESTS}")
    print(f"⏱️ Temps total : {end_time - start_time:.2f} secondes")
    print(f"⚡ Requêtes/sec : {TOTAL_REQUESTS / (end_time - start_time):.2f}")
    print("=========================================")

    # Vérification de la queue
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{API_URL}/content/queue/size")
            if resp.status_code == 200:
                print(f"📦 Taille actuelle de la queue Redis : {resp.json().get('size', 'Unknown')}")
    except Exception as e:
        print("Erreur lors de la vérification de la queue:", e)

if __name__ == "__main__":
    asyncio.run(main())
