import os
import json
import httpx
from typing import AsyncIterator, List, Dict
from .base import Provider

class OpenAICompatProvider(Provider):
    """
    Works with OpenAI-compatible Chat Completions:
    POST {BASE_URL}/v1/chat/completions
    with {model, messages, stream: true}
    and receives SSE-like stream: 'data: {...}\n\n'
    """
    def __init__(self, base_url: str, api_key: str):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key

    async def stream_chat(self, model: str, messages: List[Dict]) -> AsyncIterator[str]:
        url = f"{self.base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
        }

        async with httpx.AsyncClient(timeout=None) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as r:
                r.raise_for_status()
                async for line in r.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data: "):
                        data = line[len("data: "):].strip()
                        if data == "[DONE]":
                            break
                        try:
                            obj = json.loads(data)
                            # OpenAI stream format: choices[0].delta.content
                            delta = obj.get("choices", [{}])[0].get("delta", {})
                            chunk = delta.get("content")
                            if chunk:
                                yield chunk
                        except Exception:
                            # ignore malformed chunks
                            continue

def build_openai_compat_from_env() -> OpenAICompatProvider | None:
    base_url = os.getenv("OPENAI_COMPAT_BASE_URL", "").strip()
    api_key = os.getenv("OPENAI_COMPAT_API_KEY", "").strip()
    if not base_url or not api_key:
        return None
    return OpenAICompatProvider(base_url=base_url, api_key=api_key)
