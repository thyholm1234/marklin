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
    """Browseren og CDN'et skal altid hente den aktuelle statiske version."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if path.endswith(".html") or path == "":
            response.headers["Cache-Control"] = "no-store, max-age=0"
        else:
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate, max-age=0"
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
