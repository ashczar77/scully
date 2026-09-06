import json

from pydantic import BaseSettings


class Settings(BaseSettings):
    service_name: str = "scully-validation-service"


settings = Settings()
print(json.dumps({"service": settings.service_name, "status": "ready"}))
