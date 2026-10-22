"""Column types shared by the models."""
from __future__ import annotations

import enum as py_enum

from sqlalchemy import String
from sqlalchemy.types import TypeDecorator


class EnumString(TypeDecorator):
    """Store a str-enum by its lowercase *value*, hand back the enum member.

    Plain `sa.Enum` would persist member *names* (`CRITICAL`) and a bare `String`
    would hand back `str`, which breaks `user.role is Role.ADMIN` comparisons in
    the authorization layer.
    """

    impl = String
    cache_ok = True

    def __init__(self, enum_cls: type[py_enum.Enum], length: int = 32) -> None:
        super().__init__(length=length)
        if not issubclass(enum_cls, py_enum.Enum):
            raise TypeError(f"{enum_cls!r} is not an Enum")
        self.enum_cls = enum_cls

    def process_bind_param(self, value, dialect):  # noqa: ANN001, ARG002
        if value is None:
            return None
        if isinstance(value, self.enum_cls):
            return value.value
        return self.enum_cls(value).value

    def process_result_value(self, value, dialect):  # noqa: ANN001, ARG002
        if value is None:
            return None
        return self.enum_cls(value)
