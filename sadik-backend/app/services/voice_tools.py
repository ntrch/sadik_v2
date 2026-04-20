"""
voice_tools.py — SADIK voice tool-use registry

Each Tool wraps an existing service/query with a natural-language TR response.
No new DB tables; all queries reuse existing patterns from the router layer.

Tool loop: LLM returns tool_calls → dispatcher executes → feeds result back to LLM.
"""
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta, date
from typing import Any, Callable, Awaitable

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.services.redaction import redact_messages

logger = logging.getLogger(__name__)

# ── Day/month names (TR) ───────────────────────────────────────────────────────

_TR_DAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"]
_TR_MONTHS = [
    "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
    "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]
_TZ_TR = timezone(timedelta(hours=3))


def _fmt_dur(secs: int) -> str:
    h, m = divmod(secs, 3600)
    m = m // 60
    if h and m >= 5:
        return f"{h} saat {m} dakika"
    if h:
        return f"{h} saat"
    return f"{max(m, 1)} dakika"


def _today_tr() -> str:
    now = datetime.now(_TZ_TR)
    return f"{now.day} {_TR_MONTHS[now.month-1]} {now.year}, {_TR_DAYS[now.weekday()]}"


# ── Tool dataclass ─────────────────────────────────────────────────────────────

@dataclass
class Tool:
    name: str
    description: str                        # shown to LLM (TR)
    parameters: dict                        # JSON Schema
    execute: Callable[..., Awaitable[str]]  # async (session, args) -> str


# ── Individual tool implementations ───────────────────────────────────────────

async def _list_tasks(session: AsyncSession, args: dict) -> str:
    from app.models.task import Task

    filter_mode = args.get("filter", "open")
    today_start = datetime.combine(datetime.now(timezone.utc).date(), datetime.min.time())
    today_end = today_start + timedelta(days=1)

    q = select(Task)
    if filter_mode == "today":
        q = q.where(
            (Task.due_date >= today_start) & (Task.due_date < today_end) & (Task.status != "done")
        )
    elif filter_mode == "open":
        q = q.where(Task.status.in_(["todo", "in_progress"]))
    # "all" → no extra filter

    q = q.order_by(Task.priority.desc(), Task.due_date.asc())
    rows = (await session.execute(q)).scalars().all()

    if not rows:
        labels = {"today": "bugün", "open": "açık", "all": ""}
        return f"Şu an {labels.get(filter_mode, '')} görev bulunamadı."

    lines = []
    for t in rows:
        due = ""
        if t.due_date:
            d = t.due_date
            due = f", son tarih: {d.day} {_TR_MONTHS[d.month-1]}"
        status_label = {"todo": "yapılacak", "in_progress": "devam ediyor", "done": "tamamlandı"}.get(t.status, t.status)
        lines.append(f"- [{t.id}] {t.title} ({status_label}{due})")

    label = {"today": "bugünkü", "open": "açık", "all": "tüm"}.get(filter_mode, "")
    return f"{len(rows)} adet {label} görev:\n" + "\n".join(lines)


async def _delete_task(session: AsyncSession, args: dict) -> str:
    from app.models.task import Task
    from app.services.ws_manager import ws_manager

    if not args.get("confirmed", False):
        return "Silme işlemi için önce onay gerekli."

    task_id = args.get("task_id")
    if task_id is None:
        return "Görev ID'si belirtilmedi."

    task = await session.get(Task, int(task_id))
    if not task:
        return f"ID'si {task_id} olan görev bulunamadı."

    title = task.title
    await session.delete(task)
    await session.commit()
    await ws_manager.broadcast({"type": "task_updated", "data": {"id": task_id, "deleted": True}})
    return f'"{title}" adlı görev silindi.'


async def _list_habits(session: AsyncSession, args: dict) -> str:
    from app.models.habit import Habit

    rows = (await session.execute(
        select(Habit).where(Habit.enabled == True).order_by(Habit.id)
    )).scalars().all()

    if not rows:
        return "Şu an aktif alışkanlık bulunmuyor."

    day_names = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"]
    today_idx = datetime.now(_TZ_TR).weekday()

    lines = []
    for h in rows:
        days = h.get_days()
        days_str = ", ".join(day_names[d] for d in days) if days else "her gün"
        today_marker = " (bugün aktif)" if today_idx in days else ""
        lines.append(f"- {h.name} — {h.time}, {days_str}{today_marker}")

    return f"{len(rows)} aktif alışkanlık:\n" + "\n".join(lines)


async def _get_today_agenda(
    session: AsyncSession,
    args: dict,
    privacy_flags: dict[str, bool] | None = None,
) -> str:
    from app.models.event import Event
    from app.models.external_event import ExternalEvent

    today = datetime.now(_TZ_TR).date()
    day_start = datetime(today.year, today.month, today.day, 0, 0, 0)
    day_end = day_start + timedelta(days=1)

    native_rows = (await session.execute(
        select(Event).where(Event.starts_at >= day_start).where(Event.starts_at < day_end).order_by(Event.starts_at)
    )).scalars().all()

    # Privacy gate: skip ExternalEvent (Google Calendar) query when
    # privacy_calendar_push is disabled.  Native Event rows are always allowed.
    calendar_allowed = (privacy_flags or {}).get("privacy_calendar_push", True)
    ext_rows: list = []
    if calendar_allowed:
        ext_rows = (await session.execute(
            select(ExternalEvent)
            .where(ExternalEvent.deleted_in_source == False)
            .where(ExternalEvent.start_at >= day_start)
            .where(ExternalEvent.start_at < day_end)
            .order_by(ExternalEvent.start_at)
        )).scalars().all()

    items: list[tuple[datetime, str]] = []
    for ev in native_rows:
        t = ev.starts_at.strftime("%H:%M") if ev.starts_at else "?"
        items.append((ev.starts_at or day_start, f"{t} — {ev.title}"))
    for ev in ext_rows:
        t = ev.start_at.strftime("%H:%M") if ev.start_at else "?"
        items.append((ev.start_at or day_start, f"{t} — {ev.title} (Takvim)"))

    items.sort(key=lambda x: x[0])

    if not items:
        return f"Bugün ({_today_tr()}) için planlanmış etkinlik yok."

    return f"Bugünün ajandası ({_today_tr()}, {len(items)} etkinlik):\n" + "\n".join(s for _, s in items)


async def _get_app_usage_summary(session: AsyncSession, args: dict) -> str:
    from app.models.app_usage_session import AppUsageSession

    range_mode = args.get("range", "today")
    now_utc = datetime.now(timezone.utc)

    if range_mode == "week":
        start = datetime.combine((now_utc - timedelta(days=7)).date(), datetime.min.time())
        label = "son 7 gün"
    else:
        start = datetime.combine(now_utc.date(), datetime.min.time())
        label = "bugün"

    rows = (await session.execute(
        select(
            AppUsageSession.app_name,
            func.sum(AppUsageSession.duration_seconds).label("total_sec"),
        )
        .where(AppUsageSession.started_at >= start)
        .group_by(AppUsageSession.app_name)
        .order_by(func.sum(AppUsageSession.duration_seconds).desc())
        .limit(5)
    )).all()

    if not rows:
        return f"{label.capitalize()} için uygulama kullanım verisi bulunamadı."

    lines = [f"- {r.app_name}: {_fmt_dur(int(r.total_sec))}" for r in rows]
    return f"En çok kullanılan uygulamalar ({label}):\n" + "\n".join(lines)


async def _start_pomodoro(session: AsyncSession, args: dict) -> str:
    from app.services.pomodoro_service import pomodoro_service
    from app.models.setting import Setting

    minutes = args.get("minutes")
    if minutes is None:
        res = await session.execute(select(Setting).where(Setting.key == "pomodoro_work_minutes"))
        s = res.scalar_one_or_none()
        minutes = int(s.value) if s else 25
    else:
        minutes = int(minutes)

    await pomodoro_service.start(work_minutes=minutes)
    return f"{minutes} dakikalık odaklanma seansı başladı. Konsantrasyonunu koruyabilirsin."


async def _switch_mode(session: AsyncSession, args: dict) -> str:
    from app.services.mode_tracker import mode_tracker
    from app.services.ws_manager import ws_manager

    mode_name = args.get("mode_name", "").strip()
    if not mode_name:
        return "Mod adı belirtilmedi."

    new_log = await mode_tracker.set_mode(mode_name)
    await ws_manager.broadcast({
        "type": "mode_changed",
        "data": {"mode": new_log.mode, "started_at": new_log.started_at.isoformat()},
    })
    return f'"{mode_name}" moduna geçildi.'


async def _search_memory(session: AsyncSession, args: dict) -> str:
    from app.models.memory import BrainstormNote, ClipboardItem

    query = args.get("query", "").strip().lower()
    if not query:
        return "Arama sorgusu belirtilmedi."

    notes = (await session.execute(
        select(BrainstormNote).order_by(BrainstormNote.updated_at.desc()).limit(100)
    )).scalars().all()

    clips = (await session.execute(
        select(ClipboardItem).where(ClipboardItem.content_type == "text")
        .order_by(ClipboardItem.created_at.desc()).limit(100)
    )).scalars().all()

    results: list[str] = []

    for n in notes:
        text = ((n.title or "") + " " + n.content).lower()
        if query in text:
            snippet = (n.title or n.content[:60]).strip()
            results.append(f"- Not: {snippet}")

    for c in clips:
        if query in c.content.lower():
            snippet = c.content[:60].strip()
            results.append(f"- Pano: {snippet}")

    if not results:
        return f'"{args.get("query")}" için kayıtlı anı veya not bulunamadı.'

    return f'"{args.get("query")}" araması için {len(results)} sonuç:\n' + "\n".join(results[:10])


async def _cancel_break(session: AsyncSession, args: dict) -> str:
    from app.services.pomodoro_service import pomodoro_service

    if not pomodoro_service.is_running or pomodoro_service.phase not in ("break", "long_break"):
        return "Şu an aktif bir mola bulunmuyor."

    await pomodoro_service.stop()
    return "Mola iptal edildi. İdleye dönüldü."


async def _list_workspaces(session: AsyncSession, args: dict) -> str:
    from app.models.workspace import Workspace

    rows = (await session.execute(
        select(Workspace).order_by(Workspace.created_at)
    )).scalars().all()

    if not rows:
        return "Kayıtlı çalışma alanı bulunamadı."

    lines = [f"- [{w.id}] {w.name}" + (f" (mod: {w.mode_sync})" if w.mode_sync else "") for w in rows]
    return f"{len(rows)} çalışma alanı:\n" + "\n".join(lines)


async def _start_workspace(session: AsyncSession, args: dict) -> str:
    from app.models.workspace import Workspace
    from app.services.mode_tracker import mode_tracker
    from app.services.ws_manager import ws_manager

    name = args.get("name", "").strip()
    if not name:
        return "Çalışma alanı adı belirtilmedi."

    rows = (await session.execute(select(Workspace))).scalars().all()
    target: Workspace | None = None
    for w in rows:
        if w.name.lower() == name.lower():
            target = w
            break

    if not target:
        names = ", ".join(w.name for w in rows) or "yok"
        return f'"{name}" adlı çalışma alanı bulunamadı. Mevcut alanlar: {names}'

    await ws_manager.broadcast({"type": "workspace_start", "data": {"workspace_id": target.id}})

    if target.mode_sync:
        new_log = await mode_tracker.set_mode(target.mode_sync)
        await ws_manager.broadcast({
            "type": "mode_changed",
            "data": {"mode": new_log.mode, "started_at": new_log.started_at.isoformat()},
        })
        return f'"{target.name}" çalışma alanı başlatıldı ve "{target.mode_sync}" moduna geçildi.'

    return f'"{target.name}" çalışma alanı başlatıldı.'


async def _get_current_mode(session: AsyncSession, args: dict) -> str:
    from app.services.mode_tracker import mode_tracker

    current = await mode_tracker.get_current()
    if not current:
        return "Şu an aktif bir mod bulunmuyor."

    elapsed_secs = int((datetime.now(timezone.utc).replace(tzinfo=None) - current.started_at).total_seconds())
    return f'Aktif mod: "{current.mode}", {_fmt_dur(elapsed_secs)} önce başladı.'


# ── Delete tools (5 new + confirm gate) ───────────────────────────────────────

_CONFIRM_GATE_MSG = "Silme işlemi için önce onay gerekli."


async def _delete_habit(session: AsyncSession, args: dict) -> str:
    from app.models.habit import Habit

    if not args.get("confirmed", False):
        return _CONFIRM_GATE_MSG

    habit_id = args.get("habit_id")
    if habit_id is None:
        return "Alışkanlık ID'si belirtilmedi."

    habit = await session.get(Habit, int(habit_id))
    if not habit:
        return f"ID'si {habit_id} olan alışkanlık bulunamadı."

    name = habit.name
    await session.delete(habit)
    await session.commit()
    return f'"{name}" alışkanlığı silindi.'


async def _delete_event(session: AsyncSession, args: dict) -> str:
    """Delete a native (local) Event only. ExternalEvents are never touched."""
    from app.models.event import Event

    if not args.get("confirmed", False):
        return _CONFIRM_GATE_MSG

    event_id = args.get("event_id")
    if event_id is None:
        return "Etkinlik ID'si belirtilmedi."

    event = await session.get(Event, int(event_id))
    if not event:
        return f"ID'si {event_id} olan yerel etkinlik bulunamadı."

    title = event.title
    await session.delete(event)
    await session.commit()
    return f'"{title}" etkinliği silindi.'


async def _delete_workspace(session: AsyncSession, args: dict) -> str:
    from app.models.workspace import Workspace
    from app.services.ws_manager import ws_manager

    if not args.get("confirmed", False):
        return _CONFIRM_GATE_MSG

    workspace_id = args.get("workspace_id")
    if workspace_id is None:
        return "Çalışma alanı ID'si belirtilmedi."

    workspace = await session.get(Workspace, int(workspace_id))
    if not workspace:
        return f"ID'si {workspace_id} olan çalışma alanı bulunamadı."

    name = workspace.name
    await session.delete(workspace)
    await session.commit()
    await ws_manager.broadcast({"type": "workspace_deleted", "data": {"id": workspace_id}})
    return f'"{name}" çalışma alanı silindi.'


async def _delete_memory_note(session: AsyncSession, args: dict) -> str:
    from app.models.memory import BrainstormNote

    if not args.get("confirmed", False):
        return _CONFIRM_GATE_MSG

    note_id = args.get("note_id")
    if note_id is None:
        return "Not ID'si belirtilmedi."

    note = await session.get(BrainstormNote, int(note_id))
    if not note:
        return f"ID'si {note_id} olan not bulunamadı."

    snippet = (note.title or note.content[:40]).strip()
    await session.delete(note)
    await session.commit()
    return f'"{snippet}" notu silindi.'


async def _delete_clipboard_item(session: AsyncSession, args: dict) -> str:
    from app.models.memory import ClipboardItem

    if not args.get("confirmed", False):
        return _CONFIRM_GATE_MSG

    clip_id = args.get("clip_id")
    if clip_id is None:
        return "Pano öğesi ID'si belirtilmedi."

    clip = await session.get(ClipboardItem, int(clip_id))
    if not clip:
        return f"ID'si {clip_id} olan pano öğesi bulunamadı."

    snippet = clip.content[:40].strip()
    await session.delete(clip)
    await session.commit()
    return f'Pano öğesi silindi: "{snippet}"'


# ── Tool registry ──────────────────────────────────────────────────────────────

TOOLS: dict[str, Tool] = {
    "list_tasks": Tool(
        name="list_tasks",
        description="Görevleri listele. filter: 'today' (bugün vadesi olanlar), 'open' (açık/devam edenler), 'all' (tümü).",
        parameters={
            "type": "object",
            "properties": {
                "filter": {
                    "type": "string",
                    "enum": ["today", "open", "all"],
                    "description": "Hangi görevler listeleneceği",
                }
            },
            "required": [],
        },
        execute=_list_tasks,
    ),
    "delete_task": Tool(
        name="delete_task",
        description=(
            "Belirtilen ID'deki görevi sil. "
            "Bu aracı sadece kullanıcı önceki turn'de sözlü olarak ('evet', 'sil', 'onaylıyorum') "
            "silme onayı verdiyse confirmed=true ile çağır. "
            "Onay yoksa önce kullanıcıya 'X görevi silinsin mi?' diye sor, cevabı bekle."
        ),
        parameters={
            "type": "object",
            "properties": {
                "task_id": {
                    "type": "integer",
                    "description": "Silinecek görevin ID'si",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Kullanıcı sözlü onay verdiyse true",
                },
            },
            "required": ["task_id", "confirmed"],
        },
        execute=_delete_task,
    ),
    "list_habits": Tool(
        name="list_habits",
        description="Aktif alışkanlıkları ve zaman bilgilerini listele.",
        parameters={"type": "object", "properties": {}, "required": []},
        execute=_list_habits,
    ),
    "get_today_agenda": Tool(
        name="get_today_agenda",
        description="Bugünün ajandası: yerleşik etkinlikler + Google Calendar etkinlikleri.",
        parameters={"type": "object", "properties": {}, "required": []},
        execute=_get_today_agenda,
    ),
    "get_app_usage_summary": Tool(
        name="get_app_usage_summary",
        description="En çok kullanılan uygulamalar ve süreler. range: 'today' veya 'week'.",
        parameters={
            "type": "object",
            "properties": {
                "range": {
                    "type": "string",
                    "enum": ["today", "week"],
                    "description": "Zaman aralığı",
                }
            },
            "required": [],
        },
        execute=_get_app_usage_summary,
    ),
    "start_pomodoro": Tool(
        name="start_pomodoro",
        description="Pomodoro odaklanma seansı başlat. minutes belirtilmezse ayarlardaki varsayılan kullanılır.",
        parameters={
            "type": "object",
            "properties": {
                "minutes": {
                    "type": "integer",
                    "description": "Seans uzunluğu (dakika), örn. 25",
                }
            },
            "required": [],
        },
        execute=_start_pomodoro,
    ),
    "switch_mode": Tool(
        name="switch_mode",
        description="Çalışma modunu değiştir. mode_name: 'working', 'coding', 'meeting', 'break', veya özel mod adı.",
        parameters={
            "type": "object",
            "properties": {
                "mode_name": {
                    "type": "string",
                    "description": "Geçilecek mod adı (büyük/küçük harf fark etmez)",
                }
            },
            "required": ["mode_name"],
        },
        execute=_switch_mode,
    ),
    "search_memory": Tool(
        name="search_memory",
        description="Kullanıcının kaydettiği notlarda ve pano geçmişinde arama yap.",
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Aranacak kelime veya ifade",
                }
            },
            "required": ["query"],
        },
        execute=_search_memory,
    ),
    "cancel_break": Tool(
        name="cancel_break",
        description="Aktif mola varsa iptal et ve idle durumuna dön.",
        parameters={"type": "object", "properties": {}, "required": []},
        execute=_cancel_break,
    ),
    "list_workspaces": Tool(
        name="list_workspaces",
        description="Kayıtlı çalışma alanlarını listele.",
        parameters={"type": "object", "properties": {}, "required": []},
        execute=_list_workspaces,
    ),
    "start_workspace": Tool(
        name="start_workspace",
        description="Belirtilen adlı çalışma alanını başlat (uygulamaları açar, modu değiştirir).",
        parameters={
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Çalışma alanı adı (büyük/küçük harf fark etmez)",
                }
            },
            "required": ["name"],
        },
        execute=_start_workspace,
    ),
    "get_current_mode": Tool(
        name="get_current_mode",
        description="Şu anki aktif modu ve ne kadar süredir aktif olduğunu öğren.",
        parameters={"type": "object", "properties": {}, "required": []},
        execute=_get_current_mode,
    ),
    "delete_habit": Tool(
        name="delete_habit",
        description=(
            "Belirtilen ID'deki alışkanlığı sil. "
            "Bu aracı sadece kullanıcı önceki turn'de sözlü olarak ('evet', 'sil', 'onaylıyorum') "
            "silme onayı verdiyse confirmed=true ile çağır. "
            "Onay yoksa önce kullanıcıya 'X alışkanlığı silinsin mi?' diye sor, cevabı bekle."
        ),
        parameters={
            "type": "object",
            "properties": {
                "habit_id": {
                    "type": "integer",
                    "description": "Silinecek alışkanlığın ID'si",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Kullanıcı sözlü onay verdiyse true",
                },
            },
            "required": ["habit_id", "confirmed"],
        },
        execute=_delete_habit,
    ),
    "delete_event": Tool(
        name="delete_event",
        description=(
            "Belirtilen ID'deki yerel (SADIK'a eklenen) etkinliği sil. "
            "Google Calendar etkinliklerine dokunmaz; sadece native etkinlikler silinebilir. "
            "Bu aracı sadece kullanıcı önceki turn'de sözlü olarak ('evet', 'sil', 'onaylıyorum') "
            "silme onayı verdiyse confirmed=true ile çağır. "
            "Onay yoksa önce kullanıcıya 'X etkinliği silinsin mi?' diye sor, cevabı bekle."
        ),
        parameters={
            "type": "object",
            "properties": {
                "event_id": {
                    "type": "integer",
                    "description": "Silinecek yerel etkinliğin ID'si",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Kullanıcı sözlü onay verdiyse true",
                },
            },
            "required": ["event_id", "confirmed"],
        },
        execute=_delete_event,
    ),
    "delete_workspace": Tool(
        name="delete_workspace",
        description=(
            "Belirtilen ID'deki çalışma alanını sil. "
            "Bu aracı sadece kullanıcı önceki turn'de sözlü olarak ('evet', 'sil', 'onaylıyorum') "
            "silme onayı verdiyse confirmed=true ile çağır. "
            "Onay yoksa önce kullanıcıya 'X çalışma alanı silinsin mi?' diye sor, cevabı bekle."
        ),
        parameters={
            "type": "object",
            "properties": {
                "workspace_id": {
                    "type": "integer",
                    "description": "Silinecek çalışma alanının ID'si",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Kullanıcı sözlü onay verdiyse true",
                },
            },
            "required": ["workspace_id", "confirmed"],
        },
        execute=_delete_workspace,
    ),
    "delete_memory_note": Tool(
        name="delete_memory_note",
        description=(
            "Belirtilen ID'deki hafıza notunu (brainstorm notu) sil. "
            "Bu aracı sadece kullanıcı önceki turn'de sözlü olarak ('evet', 'sil', 'onaylıyorum') "
            "silme onayı verdiyse confirmed=true ile çağır. "
            "Onay yoksa önce kullanıcıya 'X notu silinsin mi?' diye sor, cevabı bekle."
        ),
        parameters={
            "type": "object",
            "properties": {
                "note_id": {
                    "type": "integer",
                    "description": "Silinecek notun ID'si",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Kullanıcı sözlü onay verdiyse true",
                },
            },
            "required": ["note_id", "confirmed"],
        },
        execute=_delete_memory_note,
    ),
    "delete_clipboard_item": Tool(
        name="delete_clipboard_item",
        description=(
            "Belirtilen ID'deki pano öğesini sil. "
            "Bu aracı sadece kullanıcı önceki turn'de sözlü olarak ('evet', 'sil', 'onaylıyorum') "
            "silme onayı verdiyse confirmed=true ile çağır. "
            "Onay yoksa önce kullanıcıya 'X pano öğesi silinsin mi?' diye sor, cevabı bekle."
        ),
        parameters={
            "type": "object",
            "properties": {
                "clip_id": {
                    "type": "integer",
                    "description": "Silinecek pano öğesinin ID'si",
                },
                "confirmed": {
                    "type": "boolean",
                    "description": "Kullanıcı sözlü onay verdiyse true",
                },
            },
            "required": ["clip_id", "confirmed"],
        },
        execute=_delete_clipboard_item,
    ),
}


# ── Schema serializers ─────────────────────────────────────────────────────────

def get_tool_schemas(provider: str = "openai", tier: str = "full") -> list[dict]:
    """Return tool definitions in the format expected by the LLM provider.

    provider: 'openai' — works for both OpenAI and OpenAI-compatible APIs.
    tier: 'full' | 'hybrid' | 'local' | 'custom'
        - full: all 12 tools exposed (default / backward-compatible)
        - hybrid: all tools EXCEPT get_app_usage_summary and search_memory
          (those tools inject "context query" data that belongs behind full consent)
        - local: empty list — LLM gets no tools at all; pure generic chat
        - custom: treated same as full (user hand-picked individual flags)

    Future: 'anthropic' format can be added here without touching callers.
    """
    if tier == "local":
        return []

    # Tools excluded from hybrid tier
    _HYBRID_EXCLUDED = frozenset(["get_app_usage_summary", "search_memory"])

    if provider == "openai":
        return [
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters,
                },
            }
            for t in TOOLS.values()
            if tier not in ("hybrid",) or t.name not in _HYBRID_EXCLUDED
        ]
    raise ValueError(f"Unknown provider: {provider!r}")


# ── Dispatcher ─────────────────────────────────────────────────────────────────

MAX_TOOL_ROUNDS = 2

_LOG_PATH: str | None = None

def _get_log_path() -> str:
    import os
    global _LOG_PATH
    if _LOG_PATH is None:
        base = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
            "sadik-logs",
        )
        os.makedirs(base, exist_ok=True)
        _LOG_PATH = os.path.join(base, "voice_tools.log")
    return _LOG_PATH


def _log_tool_call(tool_name: str, args: dict, result_len: int, duration_ms: float) -> None:
    """Append one line to sadik-logs/voice_tools.log (debug telemetry)."""
    try:
        ts = datetime.now(_TZ_TR).strftime("%Y-%m-%d %H:%M:%S")
        # Redact values that look like secrets (keys containing 'key', 'token', 'secret')
        safe_args = {
            k: ("***" if any(w in k.lower() for w in ("key", "token", "secret", "password")) else v)
            for k, v in args.items()
        }
        line = f"[{ts}] {tool_name} args={safe_args} result_len={result_len} duration_ms={duration_ms:.1f}\n"
        with open(_get_log_path(), "a", encoding="utf-8") as f:
            f.write(line)
    except Exception as e:
        logger.warning(f"[voice_tools] log write failed: {e}")


async def execute_tool(
    tool_name: str,
    args: dict,
    session: AsyncSession,
    privacy_flags: dict[str, bool] | None = None,
) -> str:
    """Execute a single tool and return its natural-language result string.

    privacy_flags: optional dict from get_privacy_flags(). Passed to tools
    that need per-flag data filtering (e.g. get_today_agenda).  Default None
    preserves backward-compatible behaviour (no filtering applied).
    """
    tool = TOOLS.get(tool_name)
    if not tool:
        return f"Bilinmeyen araç: {tool_name}"

    t0 = time.monotonic()
    try:
        # Privacy-aware tools receive flags as a keyword argument.
        if tool_name == "get_today_agenda":
            result = await _get_today_agenda(session, args, privacy_flags=privacy_flags)
        else:
            result = await tool.execute(session, args)
    except Exception as e:
        logger.error(f"[voice_tools] {tool_name} execute error: {e}")
        result = f"Araç çalıştırılırken hata oluştu: {e}"
    duration_ms = (time.monotonic() - t0) * 1000
    _log_tool_call(tool_name, args, len(result), duration_ms)
    return result


async def run_tool_loop(
    messages: list[dict],
    client,
    model: str,
    session: AsyncSession,
    on_tool_event: Callable[[dict], Awaitable[None]] | None = None,
    privacy_flags: dict[str, bool] | None = None,
    tier: str = "full",
) -> tuple[list[dict], str, list[dict]]:
    """Execute the LLM tool-use loop (max MAX_TOOL_ROUNDS rounds).

    Returns (updated_messages, final_text_response, tool_calls_used).
    - final_text_response: ready for TTS
    - tool_calls_used: list of {name, args_summary} dicts for frontend metadata

    on_tool_event: optional async callable called with
        {"type": "tool_status", "tool_name": str, "phase": "executing"|"completed"}
        before and after each tool execution.

    client: AsyncOpenAI instance
    messages: full messages list (will be extended in-place clone)
    """
    import json
    msgs = list(messages)  # shallow copy — don't mutate caller's list
    tool_schemas = get_tool_schemas("openai", tier=tier)
    tool_calls_used: list[dict] = []

    async def _emit(event: dict) -> None:
        if on_tool_event is not None:
            try:
                await on_tool_event(event)
            except Exception as ev_err:
                logger.warning(f"[voice_tools] on_tool_event error: {ev_err}")

    for round_idx in range(MAX_TOOL_ROUNDS):
        create_kwargs: dict = {
            "model": model,
            "messages": redact_messages(msgs),
        }
        if tool_schemas:
            create_kwargs["tools"] = tool_schemas
            create_kwargs["tool_choice"] = "auto"
        response = await client.chat.completions.create(**create_kwargs)
        choice = response.choices[0]
        msg = choice.message

        # Append assistant message (with possible tool_calls).
        # Build the dict manually so we only include what the API expects.
        assistant_entry: dict = {"role": "assistant", "content": msg.content or ""}
        if msg.tool_calls:
            assistant_entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    },
                }
                for tc in msg.tool_calls
            ]
        msgs.append(assistant_entry)

        if choice.finish_reason == "tool_calls" and msg.tool_calls:
            # Execute all tool calls in this round
            for tc in msg.tool_calls:
                fn_name = tc.function.name
                try:
                    fn_args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    fn_args = {}

                logger.info(f"[voice_tools] round={round_idx+1} tool={fn_name} args={fn_args}")

                # Emit executing event before tool runs
                await _emit({"type": "tool_status", "tool_name": fn_name, "phase": "executing"})

                tool_result = await execute_tool(fn_name, fn_args, session, privacy_flags=privacy_flags)

                # Emit completed event after tool finishes
                await _emit({"type": "tool_status", "tool_name": fn_name, "phase": "completed"})

                # Build args summary for metadata (truncated, key=value pairs)
                args_summary = ", ".join(
                    f"{k}={str(v)[:30]}" for k, v in fn_args.items()
                ) if fn_args else ""
                tool_calls_used.append({"name": fn_name, "args_summary": args_summary})

                msgs.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": tool_result,
                })
        else:
            # No more tool calls — we have the final text response
            final_text = msg.content or ""
            return msgs, final_text, tool_calls_used

    # Safety: if we exhausted MAX_TOOL_ROUNDS without a non-tool response,
    # do one more call without tools to force a final answer.
    logger.warning("[voice_tools] max rounds reached, forcing final response without tools")
    response = await client.chat.completions.create(
        model=model,
        messages=redact_messages(msgs),
    )
    final_text = response.choices[0].message.content or ""
    return msgs, final_text, tool_calls_used
