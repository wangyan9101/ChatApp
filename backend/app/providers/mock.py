import asyncio
from typing import AsyncIterator, List, Dict
from .base import Provider

class MockProvider(Provider):
    async def stream_chat(self, model: str, messages: List[Dict]) -> AsyncIterator[str]:
        user_last = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                user_last = m.get("content", "")
                break

        text = f"（Mock 流式）你选择的模型是 {model}。\n你说：{user_last}\n\n接入真实模型后，这里会变成真实输出。"
        for ch in text:
            await asyncio.sleep(0.01)
            yield ch
