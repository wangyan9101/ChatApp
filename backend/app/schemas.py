from pydantic import BaseModel, Field
from typing import List, Literal, Optional

Role = Literal["system", "user", "assistant"]

class ChatMessage(BaseModel):
    role: Role
    content: str

class ChatRequest(BaseModel):
    model: str = Field(..., description="model id")
    messages: List[ChatMessage]
    stream: bool = True

class ModelItem(BaseModel):
    id: str
    name: str
    provider: str
    description: Optional[str] = None
