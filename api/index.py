from fastapi import FastAPI, HTTPException
from sqlalchemy import create_engine, text
import os
import jwt
from datetime import datetime, timedelta
from typing import Optional

app = FastAPI()

JWT_SECRET = os.getenv("JWT_SECRET", "CHANGE_ME_NOW")
JWT_ALG = "HS256"
JWT_EXPIRE_MIN = 60 * 24

def clean_db_url(raw: str) -> str:
    db_url = (raw or "").strip()
    if not db_url:
        raise ValueError("DATABASE_URL not set")

    if db_url.lower().startswith("psql"):
        db_url = db_url[4:].strip()

    # remove quotes
    db_url = db_url.strip().strip("'").strip('"')

    # psycopg3 scheme
    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

    # remove channel_binding
    db_url = db_url.replace("&channel_binding=require", "")
    db_url = db_url.replace("?channel_binding=require", "")

    # ensure sslmode=require
    if "sslmode=" not in db_url:
        joiner = "&" if "?" in db_url else "?"
        db_url += f"{joiner}sslmode=require"

    return db_url

def make_engine():
    url = clean_db_url(os.getenv("DATABASE_URL", ""))
    return create_engine(url, pool_pre_ping=True)

@app.get("/")
def root():
    return {"ok": True, "status": "CRM API Running v1"}

@app.get("/__debug")
def debug():
    raw = os.getenv("DATABASE_URL", "")
    return {
        "ok": True,
        "has_DATABASE_URL": bool(raw),
        "db_url_starts": raw[:18],
        "has_JWT_SECRET": bool(os.getenv("JWT_SECRET")),
        "has_ADMIN_USERNAME": bool(os.getenv("ADMIN_USERNAME")),
        "has_ADMIN_PASSWORD": bool(os.getenv("ADMIN_PASSWORD")),
    }

@app.get("/test-db")
def test_db():
    try:
        engine = make_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"ok": True, "db_status": "connected"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

@app.post("/login-json")
def login_json(body: dict):
    u = (body.get("username") or "").strip()
    p = body.get("password") or ""

    if u != (os.getenv("ADMIN_USERNAME") or ""):
        raise HTTPException(status_code=401, detail="Invalid username")
    if p != (os.getenv("ADMIN_PASSWORD") or ""):
        raise HTTPException(status_code=401, detail="Invalid password")

    exp = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MIN)
    token = jwt.encode({"sub": u, "exp": exp}, JWT_SECRET, algorithm=JWT_ALG)
    return {"access_token": token, "token_type": "bearer"}

@app.get("/me")
def me(authorization: Optional[str] = None):
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Invalid Authorization header")

    try:
        payload = jwt.decode(parts[1], JWT_SECRET, algorithms=[JWT_ALG])
        return {"ok": True, "user": payload.get("sub")}
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
