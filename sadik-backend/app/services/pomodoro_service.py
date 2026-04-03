import asyncio
import logging
from typing import Optional
from app.services.ws_manager import ws_manager

logger = logging.getLogger(__name__)

class PomodoroService:
    def __init__(self):
        self.is_running = False
        self.is_paused = False
        self.remaining_seconds = 0
        self.total_seconds = 0
        self.current_session = 0
        self.task_id: Optional[int] = None
        self.phase = "idle"
        self.work_minutes = 25
        self.break_minutes = 5
        self.long_break_minutes = 15
        self.sessions_before_long_break = 4
        self._task: Optional[asyncio.Task] = None

    def get_state(self) -> dict:
        return {
            "is_running": self.is_running,
            "is_paused": self.is_paused,
            "remaining_seconds": self.remaining_seconds,
            "total_seconds": self.total_seconds,
            "current_session": self.current_session,
            "task_id": self.task_id,
            "phase": self.phase,
        }

    async def start(self, task_id: Optional[int] = None, work_minutes: Optional[int] = None,
                    break_minutes: Optional[int] = None):
        if self._task and not self._task.done():
            self._task.cancel()
        if work_minutes:
            self.work_minutes = work_minutes
        if break_minutes:
            self.break_minutes = break_minutes
        self.task_id = task_id
        self.current_session = 0
        await self._start_work_phase()

    async def _start_work_phase(self):
        self.current_session += 1
        self.phase = "work"
        self.total_seconds = self.work_minutes * 60
        self.remaining_seconds = self.total_seconds
        self.is_running = True
        self.is_paused = False
        self._task = asyncio.create_task(self._run())

    async def _start_break_phase(self):
        if self.current_session % self.sessions_before_long_break == 0:
            self.phase = "long_break"
            self.total_seconds = self.long_break_minutes * 60
        else:
            self.phase = "break"
            self.total_seconds = self.break_minutes * 60
        self.remaining_seconds = self.total_seconds
        self.is_running = True
        self.is_paused = False
        self._task = asyncio.create_task(self._run())

    async def _run(self):
        try:
            while self.remaining_seconds > 0:
                if not self.is_paused:
                    await ws_manager.broadcast({
                        "type": "timer_tick",
                        "data": {
                            "remaining_seconds": self.remaining_seconds,
                            "total_seconds": self.total_seconds,
                            "is_running": self.is_running,
                            "phase": self.phase,
                        }
                    })
                    self.remaining_seconds -= 1
                await asyncio.sleep(1)
            await self._on_phase_complete()
        except asyncio.CancelledError:
            logger.info("Pomodoro task cancelled")

    async def _on_phase_complete(self):
        if self.phase == "work":
            await ws_manager.broadcast({
                "type": "pomodoro_completed",
                "data": {"task_id": self.task_id, "session_number": self.current_session}
            })
            await self._start_break_phase()
        else:
            await self._start_work_phase()

    async def pause(self):
        self.is_paused = True

    async def resume(self):
        self.is_paused = False

    async def stop(self) -> Optional[int]:
        if self._task and not self._task.done():
            self._task.cancel()
        task_id = self.task_id
        self.is_running = False
        self.is_paused = False
        self.remaining_seconds = 0
        self.total_seconds = 0
        self.phase = "idle"
        self.task_id = None
        self._task = None
        return task_id

    async def update_settings(self, work_minutes: int = None, break_minutes: int = None,
                               long_break_minutes: int = None, sessions_before_long_break: int = None):
        if work_minutes:
            self.work_minutes = work_minutes
        if break_minutes:
            self.break_minutes = break_minutes
        if long_break_minutes:
            self.long_break_minutes = long_break_minutes
        if sessions_before_long_break:
            self.sessions_before_long_break = sessions_before_long_break

pomodoro_service = PomodoroService()
