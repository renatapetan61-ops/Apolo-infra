from fastapi import FastAPI
from datetime import datetime, timezone

app = FastAPI(title="APOLO Polyglot Python Service", version="0.1.0")

@app.get("/")
def root():
    return {
        "service": "python",
        "runtime": "Python",
        "message": "APOLO Polyglot Cloud is running",
        "time": datetime.now(timezone.utc).isoformat(),
    }

@app.get("/healthz")
def health():
    return {"status": "ok", "service": "python"}
