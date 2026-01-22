import json
from typing import Dict, Any, AsyncIterator, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .schemas import ChatRequest, ModelItem
from .providers.mock import MockProvider
from .providers.openai_compat import build_openai_compat_from_env

app = FastAPI(title="LLM Chat Backend", version="0.1.0")

# 前端本地开发跨域
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

mock = MockProvider()
openai_compat = build_openai_compat_from_env()

# 你可以在这里定义可选模型（前端下拉框会用）
MODELS: List[ModelItem] = [
    ModelItem(id="mock-1", name="Mock Stream", provider="mock", description="本地假流式输出"),
]

# 如果配置了 OpenAI 兼容环境变量，就把真实模型也挂上
if openai_compat:
    MODELS += [
        ModelItem(id="gpt-4o", name="GPT-4o", provider="openai_compat"),
        ModelItem(id="gpt-5", name="GPT-5", provider="openai_compat"),
        # 你也可以加 deepseek-chat / qwen-max 等（取决于你的兼容服务支持的模型名）
        ModelItem(id="deepseek-chat", name="DeepSeek Chat", provider="openai_compat"),
        ModelItem(id="qwen-max", name="Qwen Max", provider="openai_compat"),
    ]

PROVIDERS = {
    "mock": mock,
    "openai_compat": openai_compat,  # 可能为 None
}

@app.get("/api/models", response_model=list[ModelItem])
def list_models():
    return MODELS

def sse_pack(event: str, data: Dict[str, Any]) -> str:
    # 标准 SSE：event: xxx \n data: ... \n\n
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

async def sse_stream(provider_key: str, model: str, messages: List[Dict[str, Any]]) -> AsyncIterator[str]:
    yield sse_pack("meta", {"model": model, "provider": provider_key})
    provider = PROVIDERS.get(provider_key)
    if provider is None:
        yield sse_pack("error", {"message": f"Provider not available: {provider_key}"})
        yield sse_pack("done", {})
        return

    try:
        async for chunk in provider.stream_chat(model=model, messages=messages):
            yield sse_pack("delta", {"text": chunk})
    except Exception as e:
        yield sse_pack("error", {"message": str(e)})
    finally:
        yield sse_pack("done", {})

@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    # model -> provider
    model_item = next((m for m in MODELS if m.id == req.model), None)
    if not model_item:
        # 未知模型就走 mock
        provider_key = "mock"
        model = "mock-1"
    else:
        provider_key = model_item.provider
        model = model_item.id

    messages = [m.model_dump() for m in req.messages]
    return StreamingResponse(
        sse_stream(provider_key=provider_key, model=model, messages=messages),
        media_type="text/event-stream",
    )

@app.get("/health")
def health():
    return {"ok": True}
