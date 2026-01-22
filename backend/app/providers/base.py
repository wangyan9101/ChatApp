from abc import ABC, abstractmethod
from typing import AsyncIterator, List, Dict

class Provider(ABC):
    @abstractmethod
    async def stream_chat(self, model: str, messages: List[Dict]) -> AsyncIterator[str]:
        """
        Yield text chunks (already decoded).
        """
        raise NotImplementedError
