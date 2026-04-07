import os
from dotenv import load_dotenv
import anthropic

load_dotenv()

api_key = os.getenv("ANTHROPIC_API_KEY")
print("ANTHROPIC_API_KEY exists:", bool(api_key))
print("ANTHROPIC_API_KEY prefix:", api_key[:12] + "..." if api_key else "MISSING")

client = anthropic.Anthropic(api_key=api_key)

models_to_test = [
    "claude-haiku-4-5-20251001",
]

for model in models_to_test:
    print(f"\nTesting model: {model}")
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=50,
            messages=[{"role": "user", "content": "Say hello in one short sentence."}],
        )
        print("SUCCESS")
        print(resp.content)
    except Exception as e:
        print("FAILED")
        print(repr(e))