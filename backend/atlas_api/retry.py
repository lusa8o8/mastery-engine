"""Bounded retry scheduling shared by worker and publisher loops."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta


@dataclass(frozen=True)
class RetryPolicy:
    base_delay: timedelta = timedelta(seconds=5)
    maximum_delay: timedelta = timedelta(minutes=5)
    jitter_ratio: float = 0.2

    def __post_init__(self) -> None:
        if self.base_delay <= timedelta(0):
            raise ValueError("base_delay must be positive")
        if self.maximum_delay < self.base_delay:
            raise ValueError("maximum_delay must not be smaller than base_delay")
        if not 0 <= self.jitter_ratio <= 1:
            raise ValueError("jitter_ratio must be between 0 and 1")

    def delay(self, attempt_number: int, jitter_sample: float) -> timedelta:
        if attempt_number < 1:
            raise ValueError("attempt_number must be positive")
        if not 0 <= jitter_sample <= 1:
            raise ValueError("jitter_sample must be between 0 and 1")
        exponent = min(attempt_number - 1, 30)
        nominal_seconds = min(
            self.maximum_delay.total_seconds(),
            self.base_delay.total_seconds() * (2**exponent),
        )
        multiplier = 1 + ((jitter_sample * 2) - 1) * self.jitter_ratio
        seconds = min(self.maximum_delay.total_seconds(), nominal_seconds * multiplier)
        return timedelta(seconds=max(0.001, seconds))
