from fastapi import APIRouter, Query, HTTPException
from datetime import datetime, timezone
from app.services.mode_tracker import mode_tracker

router = APIRouter(prefix="/api/stats", tags=["stats"])

@router.get("/daily")
async def get_daily_stats(date: str = None):
    if date:
        try:
            day = datetime.strptime(date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=422, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        day = datetime.now(timezone.utc).replace(tzinfo=None)
    return await mode_tracker.get_daily_stats(day)

@router.get("/range")
async def get_range_stats(days: int = Query(default=7)):
    if days not in (7, 14, 30):
        raise HTTPException(status_code=422, detail="days must be 7, 14, or 30")
    return await mode_tracker.get_range_stats(days)
