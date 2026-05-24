import os
from dotenv import load_dotenv
from google import genai
from google.genai.errors import APIError

load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

models_to_test = [
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-flash-latest"
]

for model_name in models_to_test:
    print(f"\n--- Testing model: {model_name} ---")
    try:
        response = client.models.generate_content(
            model=model_name,
            contents="Say 'Hello' in Turkish."
        )
        print(f"Success! Response: {response.text.strip()}")
    except APIError as e:
        print(f"APIError for {model_name}: {e.message}")
    except Exception as e:
        print(f"Exception for {model_name}: {e}")
