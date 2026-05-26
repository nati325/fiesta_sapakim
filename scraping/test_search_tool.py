from google import genai
from google.genai import types

API_KEY = "AIzaSyDLga3BzXoRCc3XyoyBmxmT2egg--IAyzM"
client = genai.Client(api_key=API_KEY)

models_to_test = [
    "gemini-2.5-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "gemini-2.0-flash",
]

for model in models_to_test:
    print(f"Testing {model} with google_search tool...")
    try:
        response = client.models.generate_content(
            model=model,
            contents="Search for 'Sia Events נס ציונה' and tell me their rating.",
            config=types.GenerateContentConfig(
                tools=[types.Tool(google_search=types.GoogleSearch())],
                temperature=0.1
            )
        )
        print(f"SUCCESS with {model}: {response.text[:200]}")
    except Exception as e:
        print(f"FAILED with {model}: {e}")
