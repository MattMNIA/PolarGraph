"""Asynchronous path batching and transmission to the microcontroller."""
from __future__ import annotations

import json
import math
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, List, Optional, Sequence

import requests

ACTIVE_JOB_STATUSES = {"pending", "running", "cancelling"}
FINAL_JOB_STATUSES = {"completed", "cancelled", "failed"}

@dataclass
class PathSendJob:
    """Represents an in-flight microcontroller transmission job."""

    job_id: str
    controller_url: str
    status_url: Optional[str]
    cancel_url: Optional[str]
    start_position: Optional[dict]
    speed: int
    reset: bool
    points: List[dict]
    batch_size: int
    status: str = field(default="pending")
    sent_points: int = field(default=0)
    sent_batches: int = field(default=0)
    total_batches: int = field(default=0)
    started_at: Optional[float] = field(default=None)
    finished_at: Optional[float] = field(default=None)
    error: Optional[str] = field(default=None)
    paused: bool = field(default=False)
    _cancel_event: threading.Event = field(default_factory=threading.Event, init=False, repr=False)
    _pause_event: threading.Event = field(default_factory=threading.Event, init=False, repr=False)

    def __post_init__(self) -> None:
        self.controller_url = self.controller_url.rstrip("/")
        if self.status_url:
            self.status_url = self.status_url.rstrip("/")
        if self.cancel_url:
            self.cancel_url = self.cancel_url.rstrip("/")
        self._pause_event.set()
        if self.batch_size > 0 and self.total_batches <= 0:
            self.total_batches = (len(self.points) + self.batch_size - 1) // self.batch_size

    @property
    def cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def request_cancel(self) -> None:
        self._cancel_event.set()

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

    def mark_running(self) -> None:
        self.status = "running"
        if self.started_at is None:
            self.started_at = time.time()
        if self.batch_size > 0:
            estimate = (len(self.points) + self.batch_size - 1) // self.batch_size
            self.total_batches = max(self.total_batches, estimate)

    def mark_complete(self) -> None:
        self.status = "completed"
        self.finished_at = time.time()
        self.error = None

    def mark_failed(self, message: str) -> None:
        self.status = "failed"
        self.error = str(message)
        self.finished_at = time.time()

    def mark_cancelled(self) -> None:
        self.status = "cancelled"
        self.finished_at = time.time()
        if self.error is None:
            self.error = "Cancelled"


class PathSenderBusyError(RuntimeError):
    """Raised when a send job is already in progress."""


class JobCancelledError(RuntimeError):
    """Internal signal used to unwind when a cancel request arrives."""


class PathSender:
    """Manages asynchronous path transmission to the microcontroller."""

    def __init__(
        self,
        batch_size: int = 200,
        timeout: float = 30.0,
        status_poll_interval: float = 0.5,
        status_timeout: float = 300.0,
        send_retry_interval: float = 2.0,
        send_retry_timeout: float = 120.0,
        controller_queue_capacity: int = 3000,
        queue_fill_target: Optional[int] = None,
        queue_low_watermark: int = 200,
        min_chunk_size: int = 200,
        max_points_per_request: int = 200,
    ) -> None:
        self.max_points_per_request = max(1, max_points_per_request)
        self.batch_size = max(1, min(batch_size, self.max_points_per_request))
        self.timeout = timeout
        self.status_poll_interval = max(0.1, status_poll_interval)
        self.status_timeout = max(self.status_poll_interval, status_timeout)
        self.send_retry_interval = max(0.5, send_retry_interval)
        self.send_retry_timeout = max(self.send_retry_interval, send_retry_timeout)
        self._lock = threading.Lock()
        self._job: Optional[PathSendJob] = None
        self._last_job: Optional[PathSendJob] = None
        self._session = requests.Session()
        self.controller_queue_capacity = max(1, controller_queue_capacity)
        default_fill_target = max(1, self.controller_queue_capacity - 500)
        if queue_fill_target is None:
            self.queue_fill_target = default_fill_target
        else:
            self.queue_fill_target = max(1, min(queue_fill_target, self.controller_queue_capacity))
        self.queue_low_watermark = max(0, queue_low_watermark)
        self.min_chunk_size = max(1, min_chunk_size)
        if self.min_chunk_size > self.max_points_per_request:
            self.min_chunk_size = self.max_points_per_request
        if self.queue_fill_target <= self.queue_low_watermark:
            self.queue_fill_target = min(
                self.controller_queue_capacity,
                max(self.queue_low_watermark + self.min_chunk_size, self.queue_low_watermark + 1),
            )
        self._last_status_payload: Optional[dict] = None

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

        normalized = [self._normalize_point(pt) for pt in points]

        # Build a path that starts with a single pen-up travel point to the first target.
        job_points: List[dict] = []
        if normalized:
            first = normalized[0]
            travel = {"x": first["x"], "y": first["y"], "penDown": False}
            job_points.append(travel)
            # Always keep the user points after the travel to ensure we draw what was requested.
            job_points.extend(normalized)
        else:
            job_points = normalized

        # If caller did not supply a start_position, prefer live controller state; otherwise require caller to specify.
        derived_start = start_position
        if derived_start is None:
            controller_state = self._get_controller_state(status_url)
            if controller_state is not None:
                derived_start = controller_state
            elif job_points:
                # Without controller state we cannot safely assume the gondola is already at the first point; ask for an explicit start.
                raise ValueError("start_position required (or provide a reachable status_url so we can read controller state)")

        job = PathSendJob(
            job_id=str(uuid.uuid4()),
            controller_url=controller_url.rstrip("/"),
            status_url=status_url.rstrip("/") if status_url else None,
            cancel_url=cancel_url.rstrip("/") if cancel_url else None,
            start_position=derived_start,
            speed=max(1, int(speed)),
            reset=reset,
            points=job_points,
            batch_size=self.batch_size,
        )

        with self._lock:
            # Clear any stale job state to prevent confusion
            if self._job and self._job.status not in ACTIVE_JOB_STATUSES:
                self._last_job = self._job
                self._job = None
            if self._job and self._job.status in ACTIVE_JOB_STATUSES:
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
            if job and job.status in ACTIVE_JOB_STATUSES:
                job.request_cancel()
                cancel_url = job.cancel_url
                if job.status not in {"cancelled", "failed"}:
                    job.status = "cancelling"
            else:
                cancel_url = None
                if self._last_job and self._last_job.status in FINAL_JOB_STATUSES:
                    self._last_job = None

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
            if self._job and self._job.status in ACTIVE_JOB_STATUSES:
                return self._serialize_job(self._job)

            previous: Optional[PathSendJob] = None
            if self._job and self._job.status not in ACTIVE_JOB_STATUSES:
                previous = self._job
                self._last_job = self._job
                self._job = None
            elif self._last_job:
                previous = self._last_job

            if not previous:
                return None

            if previous.status in FINAL_JOB_STATUSES:
                payload = {"status": "idle"}
                if previous.status != "completed":
                    payload["lastState"] = previous.status
                if previous.error:
                    payload["error"] = previous.error
                self._last_job = None
                return payload

            return self._serialize_job(previous)

    def _serialize_job(self, job: PathSendJob) -> dict:
        total_points = len(job.points)
        result = {
            "jobId": job.job_id,
            "status": job.status,
            "sentPoints": min(job.sent_points, total_points),
            "totalPoints": total_points,
            "sentBatches": job.sent_batches,
            "totalBatches": job.total_batches,
            "startedAt": job.started_at,
            "finishedAt": job.finished_at,
            "error": job.error,
            "paused": job.paused,
            "cancelUrl": job.cancel_url,
            "statusUrl": job.status_url,
        }
        return result

    def _get_controller_state(self, status_url: Optional[str]) -> Optional[dict]:
        """Fetch current controller position (absolute board coords) if status_url is available."""

        if not status_url:
            return None
        try:
            resp = self._session.get(status_url, timeout=self.timeout)
            resp.raise_for_status()
            payload = self._extract_status_payload(resp)
            if not isinstance(payload, dict):
                return None
            state = payload.get("state")
            if not isinstance(state, dict):
                return None
            sx = float(state.get("x_mm", 0.0))
            sy = float(state.get("y_mm", 0.0))
            pen = bool(state.get("penDown", False))
            return {"x": sx, "y": sy, "penDown": pen}
        except (requests.RequestException, ValueError, TypeError):
            return None

    def _run_job(self, job: PathSendJob) -> None:
        try:
            job.mark_running()
            total_points = len(job.points)
            first_batch = True

            while job.sent_points < total_points:
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

                chunk_size = self._determine_chunk_size(job, first_batch=first_batch)
                if chunk_size <= 0:
                    # No capacity available right now, wait for next poll.
                    time.sleep(self.status_poll_interval)
                    continue

                start_index = job.sent_points
                end_index = min(start_index + chunk_size, total_points)
                batch_points = job.points[start_index:end_index]
                if not batch_points:
                    # Should not happen, but guard against zero-length batches.
                    break

                estimated_remaining_points = total_points - end_index
                if chunk_size > 0:
                    future_batches = (estimated_remaining_points + chunk_size - 1) // chunk_size
                    job.total_batches = max(job.total_batches, job.sent_batches + 1 + future_batches)

                payload = self._build_payload(job, batch_points, first_batch=first_batch)
                response = self._post_with_retries(
                    job,
                    job.controller_url,
                    payload,
                    points_count=len(batch_points),
                )
                self._validate_controller_ack(response)

                job.sent_batches += 1
                job.sent_points += len(batch_points)
                job.total_batches = max(job.total_batches, job.sent_batches)
                first_batch = False

            if job.sent_points >= total_points:
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

    def _compute_string_lengths(self, x: float, y: float) -> dict:
        d = 29.0
        motor_offset_y = 60.0
        board_width = 1150.0

        left_x = x - d
        right_x = x + d
        y_rel = y + motor_offset_y

        left_len = math.sqrt(left_x * left_x + y_rel * y_rel)
        dx = board_width - right_x
        right_len = math.sqrt(dx * dx + y_rel * y_rel)

        return {"l1": left_len, "l2": right_len}

    def _build_payload(self, job: PathSendJob, batch: List[dict], *, first_batch: bool) -> dict:
        converted_batch = []
        for pt in batch:
            lengths = self._compute_string_lengths(pt["x"], pt["y"])
            converted_batch.append({
                "l1": lengths["l1"],
                "l2": lengths["l2"],
                "penDown": pt["penDown"]
            })

        payload = {
            "reset": bool(job.reset) if first_batch else False,
            "speed": job.speed,
            "points": converted_batch,
        }
        # Only send startPosition if this is the very first batch AND we are resetting.
        # If we send startPosition in later batches, the firmware might re-initialize its coordinates
        # to the start position, causing it to "teleport" back to start and overshoot on the next move.
        if first_batch and job.reset and job.start_position:
            start_lengths = self._compute_string_lengths(job.start_position["x"], job.start_position["y"])
            payload["startPosition"] = {
                "l1": start_lengths["l1"],
                "l2": start_lengths["l2"],
                "penDown": job.start_position["penDown"]
            }
        return payload

    def _determine_chunk_size(self, job: PathSendJob, *, first_batch: bool) -> int:
        remaining = len(job.points) - job.sent_points
        if remaining <= 0:
            return 0

        # First batch must only contain the single travel-to-start point.
        if first_batch:
            return 1

        status_payload = self._last_status_payload if isinstance(self._last_status_payload, dict) else None
        queue_info = status_payload.get("queue") if status_payload else None

        if isinstance(queue_info, dict):
            queue_size = self._safe_int(queue_info.get("size"))
            is_executing = bool(queue_info.get("isExecuting"))
            if queue_size is not None:
                target_queue_size = min(self.queue_fill_target, self.controller_queue_capacity)
                available_capacity = max(self.controller_queue_capacity - queue_size, 0)
                if available_capacity <= 0:
                    return 0

                if not is_executing and queue_size == 0 and first_batch:
                    desired_fill = target_queue_size
                else:
                    desired_fill = max(target_queue_size - queue_size, 0)

                desired_points = max(desired_fill, self.min_chunk_size)
                chunk = min(
                    remaining,
                    desired_points,
                    available_capacity,
                    self.batch_size,
                    self.max_points_per_request,
                )
                if chunk <= 0:
                    return 0
                return max(1, chunk)

        # Fallback when no queue telemetry is available
        fallback_size = max(self.min_chunk_size, min(self.batch_size, remaining))
        fallback_size = min(fallback_size, self.max_points_per_request)
        return min(remaining, fallback_size)

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
            if status is not None and str(status).lower() not in {"ok", "success", "accepted", "queued"}:
                raise RuntimeError(f"Controller reported status '{status}'")
            if success is not None and not success:
                raise RuntimeError("Controller reported failure")

    def _post_with_retries(
        self,
        job: PathSendJob,
        url: str,
        payload: dict,
        *,
        points_count: int,
    ) -> requests.Response:
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
                total_estimate = max(job.total_batches, job.sent_batches + 1)
                print(
                    f"Sending batch {job.sent_batches + 1}/{total_estimate} to {url} "
                    f"(points={points_count}, attempt {attempt})"
                )
                json_str = json.dumps(payload)
                response = self._session.post(
                    url,
                    data={"plain": json_str},
                    timeout=self.timeout,
                )
                response.raise_for_status()
                return response
            except requests.RequestException as exc:
                print(f"Request failed: {exc}")
                if hasattr(exc, 'response') and exc.response:
                    print(f"Response status: {exc.response.status_code}")
                    print(f"Response body: {exc.response.text[:500]}")
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
            print("No status URL provided, proceeding without waiting")
            return True

        deadline = time.time() + self.status_timeout
        consecutive_errors = 0
        print(f"Waiting for controller to become ready (timeout: {self.status_timeout}s)")
        self._last_status_payload = None
        while time.time() < deadline:
            if job.cancelled:
                return False
            try:
                response = self._session.get(job.status_url, timeout=self.timeout)
                if response.status_code == requests.codes.not_found:
                    print("Status endpoint returned 404, assuming controller is ready")
                    self._last_status_payload = None
                    return True
                response.raise_for_status()
                status_payload = self._extract_status_payload(response)
                self._last_status_payload = status_payload
                if self._controller_allows_send(status_payload):
                    print("Controller is ready")
                    return True
                consecutive_errors = 0
            except requests.RequestException as exc:
                response = getattr(exc, "response", None)
                if response is not None and response.status_code == requests.codes.not_found:
                    print("Status endpoint returned 404 during error, assuming controller is ready")
                    self._last_status_payload = None
                    return True
                consecutive_errors += 1
                if consecutive_errors >= 3:
                    print(f"Controller status unavailable after {consecutive_errors} errors ({exc}); proceeding with send.")
                    self._last_status_payload = None
                    return True
                # transient error, retry until deadline
                pass
            except ValueError:
                # JSON parse failure; treat as no payload but allow retry
                self._last_status_payload = None
            time.sleep(self.status_poll_interval)
        print("Controller did not become ready in time")
        return False

    def _extract_status_payload(self, response: requests.Response) -> Optional[dict]:
        try:
            data = response.json()
        except ValueError:
            snippet = response.text[:200]
            print(f"Controller status response is not valid JSON: {snippet}")
            return None

        if not isinstance(data, dict):
            print(f"Controller status response is not a dict: {type(data)}")
            return None

        return data

    def _controller_allows_send(self, data: Optional[dict]) -> bool:
        if not isinstance(data, dict):
            # No telemetry; default to allowing the send.
            return True

        queue_info = data.get("queue")
        if isinstance(queue_info, dict):
            queue_size = self._safe_int(queue_info.get("size"))
            is_executing = bool(queue_info.get("isExecuting"))
            if queue_size is not None:
                if queue_size >= self.controller_queue_capacity:
                    print(f"Controller queue full ({queue_size}), waiting for capacity")
                    return False
                if queue_size >= self.queue_fill_target:
                    print(
                        f"Controller queue near target fill ({queue_size}/{self.controller_queue_capacity}), pausing feed"
                    )
                    return False
                if queue_size <= self.queue_low_watermark:
                    return True
                if not is_executing and queue_size == 0:
                    return True
                # Queue telemetry present and below target -> allow send even if status says busy.
                return True

        status = data.get("status")
        if isinstance(status, str):
            status_lower = status.lower()
            if status_lower in {"idle", "ready", "stopped"}:
                return True
            if status_lower in {"busy", "running", "drawing"}:
                return False

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

        # Default to allowing send if we cannot determine activity state.
        print(f"Could not determine controller status from response: {data}")
        return True

    @staticmethod
    def _safe_int(value: Any) -> Optional[int]:
        try:
            if value is None:
                return None
            return int(value)
        except (TypeError, ValueError):
            return None

