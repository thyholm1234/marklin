"""Märklin Baneplanlægger – serverer den statiske webapp via uvicorn."""
from pathlib import Path

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


class NoCacheStatic(StaticFiles):
    """Browseren skal altid tjekke for nye filer (ETag gør det billigt)."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache"
        return response


async def healthz(request):
    return JSONResponse({"status": "ok"})


app = Starlette(
    routes=[
        Route("/healthz", healthz),
        Mount("/", app=NoCacheStatic(directory=STATIC_DIR, html=True), name="static"),
    ],
    middleware=[Middleware(GZipMiddleware, minimum_size=1000)],
)
