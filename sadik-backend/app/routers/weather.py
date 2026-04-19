"""Current-weather endpoint.

Reads OpenWeatherMap API key + city from the Settings table and returns
a compact weather payload used by the header icon/temperature. The backend
holds a 10-minute in-memory cache so the frontend can poll freely without
burning the API quota.
"""
import time
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_session
from app.models.setting import Setting

router = APIRouter(prefix="/api/weather", tags=["weather"])

_CACHE: dict = {"at": 0.0, "key": "", "data": None}
_CACHE_TTL = 10 * 60  # 10 minutes


def _condition_group(code: int) -> str:
    """Collapse OpenWeatherMap condition codes into high-level groups.

    https://openweathermap.org/weather-conditions
    """
    if 200 <= code < 300:
        return "thunderstorm"
    if 300 <= code < 400:
        return "drizzle"
    if 500 <= code < 600:
        return "rain"
    if 600 <= code < 700:
        return "snow"
    if 700 <= code < 800:
        return "mist"
    if code == 800:
        return "clear"
    if code in (801, 802):
        return "partly_cloudy"
    if 802 < code < 900:
        return "clouds"
    return "unknown"


@router.get("/geocode")
async def geocode(q: str, session: AsyncSession = Depends(get_session)):
    """Autocomplete-style location search via OpenWeatherMap /geo/1.0/direct.

    Returns a list of up to 5 matches with lat/lon + label. `q` is free-text
    (city, neighborhood, landmark). Queries with <2 chars short-circuit to [].
    """
    q = (q or "").strip()
    if len(q) < 2:
        return []
    rows = await session.execute(select(Setting).where(Setting.key == "weather_api_key"))
    s = rows.scalar_one_or_none()
    api_key = (s.value if s else "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="weather_api_key_missing")

    params = {"q": q, "limit": 5, "appid": api_key}
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get("https://api.openweathermap.org/geo/1.0/direct", params=params)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"geocode_fetch_failed: {e}")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="weather_api_key_invalid")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"geocode_upstream_{resp.status_code}")

    items = resp.json() or []
    out = []
    seen = set()
    for it in items:
        try:
            lat = float(it["lat"])
            lon = float(it["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        name = it.get("name", "")
        state = it.get("state", "")
        country = it.get("country", "")
        local_names = it.get("local_names") or {}
        display_name = local_names.get("tr") or name
        label_parts = [p for p in [display_name, state, country] if p]
        label = ", ".join(label_parts)
        key = (round(lat, 4), round(lon, 4), label)
        if key in seen:
            continue
        seen.add(key)
        out.append({"label": label, "name": display_name, "state": state, "country": country, "lat": lat, "lon": lon})
    return out


@router.get("/current")
async def get_current_weather(session: AsyncSession = Depends(get_session)):
    rows = await session.execute(select(Setting))
    settings = {s.key: s.value for s in rows.scalars().all()}

    api_key = (settings.get("weather_api_key") or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="weather_api_key_missing")

    lat_raw = (settings.get("weather_lat") or "").strip()
    lon_raw = (settings.get("weather_lon") or "").strip()
    label = (settings.get("weather_location_label") or "").strip()
    # Back-compat: old deployments may have weather_city set but no coords.
    city = (settings.get("weather_city") or "").strip()

    use_coords = False
    lat = lon = None
    if lat_raw and lon_raw:
        try:
            lat = float(lat_raw)
            lon = float(lon_raw)
            use_coords = True
        except ValueError:
            use_coords = False

    if not use_coords and not city:
        raise HTTPException(status_code=400, detail="weather_location_missing")

    cache_key = f"{api_key[-8:]}|{lat},{lon}|{city.lower()}"
    now = time.time()
    if _CACHE["data"] and _CACHE["key"] == cache_key and (now - _CACHE["at"]) < _CACHE_TTL:
        return _CACHE["data"]

    params: dict = {"appid": api_key, "units": "metric", "lang": "tr"}
    if use_coords:
        params["lat"] = lat
        params["lon"] = lon
    else:
        params["q"] = city
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get("https://api.openweathermap.org/data/2.5/weather", params=params)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"weather_fetch_failed: {e}")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="weather_api_key_invalid")
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="weather_city_not_found")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"weather_upstream_{resp.status_code}")

    payload = resp.json()
    try:
        weather0 = (payload.get("weather") or [{}])[0]
        code = int(weather0.get("id") or 0)
        data = {
            "temp_c": round(float(payload["main"]["temp"]), 1),
            "feels_like_c": round(float(payload["main"].get("feels_like", payload["main"]["temp"])), 1),
            "condition_code": code,
            "condition_group": _condition_group(code),
            "description": weather0.get("description", ""),
            "city": label or payload.get("name") or city,
            "updated_at": int(now),
        }
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(status_code=502, detail=f"weather_parse_failed: {e}")

    _CACHE.update({"at": now, "key": cache_key, "data": data})
    return data
