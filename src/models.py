from datetime import date

from pydantic import BaseModel, Field, field_validator


class TaskPayload(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=5000)
    due_date: date | None = None
    tag_ids: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("O título não pode ficar vazio.")
        return value

    @field_validator("description")
    @classmethod
    def clean_description(cls, value: str) -> str:
        return value.strip()

    @field_validator("tag_ids")
    @classmethod
    def unique_tag_ids(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(tag_id for tag_id in value if tag_id))


class CompletionPayload(BaseModel):
    completed: bool


class TagPayload(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = Field(default="#8d2141", pattern=r"^#[0-9A-Fa-f]{6}$")

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("O nome da tag não pode ficar vazio.")
        return value


class PushKeysPayload(BaseModel):
    p256dh: str = Field(min_length=20, max_length=512)
    auth: str = Field(min_length=8, max_length=256)


class PushSubscriptionPayload(BaseModel):
    endpoint: str = Field(min_length=20, max_length=4096)
    keys: PushKeysPayload
    timezone: str = Field(default="UTC", max_length=100)
    utc_offset_minutes: int = Field(default=0, ge=-840, le=840)
    notify_time: str = Field(default="09:00", pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")

    @field_validator("endpoint")
    @classmethod
    def secure_endpoint(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("https://"):
            raise ValueError("O endpoint de push precisa usar HTTPS.")
        return value

    @field_validator("timezone")
    @classmethod
    def clean_timezone(cls, value: str) -> str:
        return value.strip() or "UTC"


class PushEndpointPayload(BaseModel):
    endpoint: str = Field(min_length=20, max_length=4096)

    @field_validator("endpoint")
    @classmethod
    def clean_endpoint(cls, value: str) -> str:
        return value.strip()


class NotificationPreferencesPayload(PushEndpointPayload):
    notify_time: str = Field(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$")
    timezone: str = Field(default="UTC", max_length=100)
    utc_offset_minutes: int = Field(default=0, ge=-840, le=840)
