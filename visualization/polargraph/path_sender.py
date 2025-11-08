"""Asynchronous path batching and transmission to the microcontroller."""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Iterator, List, Optional, Sequence

import requests

Point3 = Sequence[float]


@dataclass
class PathSendJob:
    """Represents an in-flight microcontroller transmission job."""

    job_id: str
    controller_url: str
    start_position: Optional[dict]
    speed: int
    reset: bool
    points: List[dict]
    batch_size: int
    status_url: Optional[str]
    cancel_url: Optional[str]
    status: str = "pending"  # pending -> running -> completed/failed/cancelled
    error: Optional[str] = None
    sent_batches: int = 0
    total_batches: int = 0
    sent_points: int = 0
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    _cancel_event: threading.Event = field(default_factory=threading.Event, repr=False)
    paused: bool = False
    _pause_event: threading.Event = field(default_factory=threading.Event, repr=False)

    def __post_init__(self) -> None:
        self._pause_event.set()

    def batches(self) -> Iterator[List[dict]]:
        """Yield successive point batches."""
        for index in range(0, len(self.points), self.batch_size):
            yield self.points[index : index + self.batch_size]

    def mark_running(self) -> None:
        self.status = "running"
        self.started_at = time.time()
        self.total_batches = (len(self.points) + self.batch_size - 1) // self.batch_size

    def mark_complete(self) -> None:
        self.status = "completed"
        self.finished_at = time.time()
        self.resume()

    def mark_cancelled(self) -> None:
        self.status = "cancelled"
        self.finished_at = time.time()
        self.resume()

    def mark_failed(self, error: str) -> None:
        self.status = "failed"
        self.error = error
        self.finished_at = time.time()
        self.resume()

    def request_cancel(self) -> None:
        self._cancel_event.set()
        self._pause_event.set()

    @property
    def cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def pause(self) -> None:
        self.paused = True
        self._pause_event.clear()

    def resume(self) -> None:
        self.paused = False
        self._pause_event.set()

    def wait_if_paused(self) -> bool:
        while not self._pause_event.wait(timeout=0.1):
            if self.cancelled:
                return False
        return True


class PathSenderBusyError(RuntimeError):
    """Raised when a send job is already in progress."""


class JobCancelledError(RuntimeError):
    """Internal signal used to unwind when a cancel request arrives."""


class PathSender:
    """Manages asynchronous path transmission to the microcontroller."""

    def __init__(
        self,
        batch_size: int = 100,
        timeout: float = 10.0,
        status_poll_interval: float = 0.5,
        status_timeout: float = 300.0,
        send_retry_interval: float = 2.0,
        send_retry_timeout: float = 120.0,
    ) -> None:
        self.batch_size = max(1, batch_size)
        self.timeout = timeout
        self.status_poll_interval = max(0.1, status_poll_interval)
        self.status_timeout = max(self.status_poll_interval, status_timeout)
        self.send_retry_interval = max(0.5, send_retry_interval)
        self.send_retry_timeout = max(self.send_retry_interval, send_retry_timeout)
        self._lock = threading.Lock()
        self._job: Optional[PathSendJob] = None
        self._last_job: Optional[PathSendJob] = None
        self._session = requests.Session()

    def start_job(
        self,
        *,
        controller_url: str,
        points: Sequence[dict],
        start_position: Optional[dict],
        speed: int,
        reset: bool = True,
        status_url: Optional[str] = None,
        cancel_url: Optional[str] = None,
    ) -> PathSendJob:
        if not controller_url:
            raise ValueError("controller_url required")
        if not points:
            raise ValueError("points must not be empty")

        job_points = [self._normalize_point(pt) for pt in points]
        job = PathSendJob(
            job_id=str(uuid.uuid4()),
            controller_url=controller_url.rstrip("/"),
            status_url=status_url.rstrip("/") if status_url else None,
            cancel_url=cancel_url.rstrip("/") if cancel_url else None,
            start_position=start_position,
            speed=max(1, int(speed)),
            reset=reset,
            points=job_points,
            batch_size=self.batch_size,
        )

        with self._lock:
            if self._job and self._job.status in {"pending", "running"}:
                raise PathSenderBusyError("Path transmission already in progress")
            self._job = job

        thread = threading.Thread(target=self._run_job, args=(job,), daemon=True)
        thread.start()
        return job

    def cancel_current(self) -> Optional[PathSendJob]:
        job: Optional[PathSendJob] = None
        cancel_url: Optional[str] = None
        with self._lock:
            job = self._job
            if job and job.status in {"pending", "running"}:
                job.request_cancel()
                cancel_url = job.cancel_url
                if job.status not in {"cancelled", "failed"}:
                    job.status = "cancelling"
            else:
                cancel_url = None

        if cancel_url:
            try:
                self._session.post(cancel_url, timeout=self.timeout)
            except requests.RequestException as exc:
                print(f"Controller cancel request failed: {exc}")
        return job

    def pause_current(self) -> Optional[PathSendJob]:
        with self._lock:
            job = self._job
            if job and job.status in {"pending", "running"}:
                job.pause()
            return job

    def resume_current(self) -> Optional[PathSendJob]:
        with self._lock:
            job = self._job
            if job and job.status in {"pending", "running"}:
                job.resume()
            return job

    def status(self) -> Optional[dict]:
        with self._lock:
            job = self._job if self._job and self._job.status in {"pending", "running"} else None
            reference = job or self._last_job
            if not reference:
                return None
            return {
                "jobId": reference.job_id,
                "status": reference.status,
                "sentPoints": reference.sent_points,
                "totalPoints": len(reference.points),
                "sentBatches": reference.sent_batches,
                "totalBatches": reference.total_batches,
                "startedAt": reference.started_at,
                "finishedAt": reference.finished_at,
                "error": reference.error,
                "paused": reference.paused,
                "cancelUrl": reference.cancel_url,
            }

    def _run_job(self, job: PathSendJob) -> None:
        try:
            job.mark_running()
            batch_iter = job.batches()
            for batch_index, batch_points in enumerate(batch_iter):
                if job.cancelled:
                    job.mark_cancelled()
                    return

                if not job.wait_if_paused():
                    job.mark_cancelled()
                    return

                if not self._wait_until_ready(job):
                    if job.cancelled:
                        raise JobCancelledError()
                    job.mark_failed("Controller did not become ready in time")
                    return

                payload = self._build_payload(job, batch_points, first_batch=batch_index == 0)
                response = self._post_with_retries(job, job.controller_url, payload)
                self._validate_controller_ack(response)

                job.sent_batches += 1
                job.sent_points += len(batch_points)

            job.mark_complete()
        except JobCancelledError:
            job.mark_cancelled()
        except requests.RequestException as exc:
            job.mark_failed(str(exc))
        except Exception as exc:  # noqa: BLE001 - capture unexpected errors for reporting
            job.mark_failed(str(exc))
        finally:
            with self._lock:
                self._last_job = job
                if job.status not in {"pending", "running"}:
                    self._job = None

    def _build_payload(self, job: PathSendJob, batch: List[dict], *, first_batch: bool) -> dict:
        payload = {
            "reset": bool(job.reset) if first_batch else False,
            "speed": job.speed,
            "points": batch,
        }
        if first_batch and job.start_position:
            payload["startPosition"] = job.start_position
        return payload

    @staticmethod
    def _normalize_point(point: dict) -> dict:
        if not isinstance(point, dict):
            raise ValueError("points must be dictionaries with x, y, penDown keys")
        if "x" not in point or "y" not in point:
            raise ValueError("point dictionaries must include 'x' and 'y' keys")
        x_value = point["x"]
        y_value = point["y"]
        x = float(x_value)
        y = float(y_value)
        pen_down = bool(point.get("penDown"))
        return {"x": x, "y": y, "penDown": pen_down}

    @staticmethod
    def _validate_controller_ack(response: requests.Response) -> None:
        if not response.content:
            return
        try:
            data = response.json()
        except ValueError:
            return
        if isinstance(data, dict):
            if data.get("error"):
                raise RuntimeError(f"Controller error: {data['error']}")
            status = data.get("status")
            success = data.get("success")
            if status is not None and str(status).lower() not in {"ok", "success"}:
                raise RuntimeError(f"Controller reported status '{status}'")
            if success is not None and not success:
                raise RuntimeError("Controller reported failure")

    def _post_with_retries(self, job: PathSendJob, url: str, payload: dict) -> requests.Response:
        """POST to the controller with retry logic for transient failures."""

        deadline = time.time() + self.send_retry_timeout
        attempt = 0

        while True:
            if job.cancelled:
                raise JobCancelledError()

            attempt += 1
            if not job.wait_if_paused():
                raise JobCancelledError()
            try:
                response = self._session.post(url, json=payload, timeout=self.timeout)
                response.raise_for_status()
                return response
            except requests.RequestException as exc:
                if not self._is_retryable_error(exc):
                    raise

                if time.time() + self.send_retry_interval > deadline:
                    raise

                time.sleep(self.send_retry_interval)

    @staticmethod
    def _is_retryable_error(exc: requests.RequestException) -> bool:
        if isinstance(exc, (requests.ConnectTimeout, requests.ReadTimeout)):
            return True
        if isinstance(exc, requests.ConnectionError):
            return True

        response = getattr(exc, "response", None)
        if response is not None and 500 <= response.status_code < 600:
            return True

        return False

    def _wait_until_ready(self, job: PathSendJob) -> bool:
        if not job.status_url:
            return True

        deadline = time.time() + self.status_timeout
        consecutive_errors = 0
        while time.time() < deadline:
            if job.cancelled:
                return False
            try:
                response = self._session.get(job.status_url, timeout=self.timeout)
                if response.status_code == requests.codes.not_found:
                    return True
                response.raise_for_status()
                if self._controller_is_idle(response):
                    return True
                consecutive_errors = 0
            except requests.RequestException as exc:
                response = getattr(exc, "response", None)
                if response is not None and response.status_code == requests.codes.not_found:
                    return True
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    print(f"Controller status unavailable ({exc}); proceeding with send." )
                    return True
                # transient error, retry until deadline
                pass
            time.sleep(self.status_poll_interval)
        return False

    @staticmethod
    def _controller_is_idle(response: requests.Response) -> bool:
        try:
            data = response.json()
        except ValueError:
            return True

        if not isinstance(data, dict):
            return True

        motors = data.get("motors")
        if isinstance(motors, list):
            for entry in motors:
                if isinstance(entry, dict):
                    busy_flag = entry.get("busy")
                    if isinstance(busy_flag, bool):
                        if busy_flag:
                            return False
                    elif busy_flag:
                        return False

        return True