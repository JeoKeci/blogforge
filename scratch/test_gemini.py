import os
from dotenv import load_dotenv
from google import genai
from google.genai.errors import APIError

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
print(f"Using API Key ending in: ...{api_key[-6:] if api_key else 'None'}")

client = genai.Client(api_key=api_key)

for model_name in ["gemini-1.5-flash", "gemini-2.0-flash"]:
    print(f"\n--- Testing model: {model_name} ---")
    try:
        response = client.models.generate_content(
            model=model_name,
            contents="Say 'Hello' in Turkish."
        )
        print(f"Success! Response: {response.text.strip()}")
    except APIError as e:
        print(f"APIError caught for {model_name}: {e}")
    except Exception as e:
        print(f"General Exception caught for {model_name}: {type(e).__name__} - {e}")
