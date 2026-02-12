from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy import create_engine, Column, Integer, String, DateTime, Boolean, func, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from sqlalchemy.exc import IntegrityError
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any
import jwt  # PyJWT

import hashlib, hmac, secrets, base64
from pydantic import BaseModel

app = FastAPI()

# ====== DB URL CLEANER ======
def clean_db_url(raw: str) -> str:
    db_url = (raw or "").strip()
    if not db_url:
        raise ValueError("DATABASE_URL not set")

    if db_url.lower().startswith("psql"):
        db_url = db_url[4:].strip()

    while db_url and db_url[0] in ["'", '"']:
        db_url = db_url[1:]
    while db_url and db_url[-1] in ["'", '"']:
        db_url = db_url[:-1]
    db_url = db_url.strip()

    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

    db_url = db_url.replace("&channel_binding=require", "")
    db_url = db_url.replace("?channel_binding=require", "")

    if "sslmode=" not in db_url:
        joiner = "&" if "?" in db_url else "?"
        db_url = db_url + f"{joiner}sslmode=require"

    return db_url

DATABASE_URL = clean_db_url(os.getenv("DATABASE_URL", ""))
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# ====== JWT ======
JWT_SECRET = os.getenv("JWT_SECRET", "CHANGE_ME_NOW")
JWT_ALG = "HS256"
JWT_EXPIRE_MIN = 60 * 24

def create_token(payload: Dict[str, Any]) -> str:
    data = dict(payload)
    data["exp"] = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MIN)
    return jwt.encode(data, JWT_SECRET, algorithm=JWT_ALG)

def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except Exception:
        raise HTTPException(status_code=401, detail="Not authenticated")

# ====== Password Hash (PBKDF2) ======
def hash_password(password: str, iterations: int = 200_000) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return "pbkdf2_sha256$%d$%s$%s" % (
        iterations,
        base64.urlsafe_b64encode(salt).decode("utf-8").rstrip("="),
        base64.urlsafe_b64encode(dk).decode("utf-8").rstrip("="),
    )

def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iters)
        salt = base64.urlsafe_b64decode(salt_b64 + "==")
        expected = base64.urlsafe_b64decode(hash_b64 + "==")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ====== Models ======
class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    full_name = Column(String(128), nullable=True)
    role = Column(String(32), nullable=False, default="agent")  # admin/manager/agent
    password_hash = Column(String(512), nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

# ====== Seed Admin ======
def seed_admin_if_empty(db: Session) -> None:
    if db.query(User).count() > 0:
        return

    admin_username = (os.getenv("ADMIN_USERNAME") or "admin").strip().lower()
    admin_password = os.getenv("ADMIN_PASSWORD") or ""
    if not admin_password:
        return

    admin = User(
        username=admin_username,
        full_name="System Admin",
        role="admin",
        password_hash=hash_password(admin_password),
        is_active=True,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()

@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_admin_if_empty(db)
    finally:
        db.close()

# ====== Schemas ======
class LoginBody(BaseModel):
    username: str
    password: str

# ====== Auth dep ======
def get_current_user(authorization: Optional[str] = None, db: Session = Depends(get_db)) -> User:
    # Expect header: Authorization: Bearer <token>
    if not authorization:
        raise HTTPException(status_code=401, detail="Not authenticated")

    parts = authorization.split(" ")
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_token(parts[1])
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = db.query(User).filter(User.username == username).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

# ====== Routes ======
@app.get("/")
def root():
    return {"status": "CRM API Running"}

@app.get("/test-db")
def test_db():
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"ok": True, "db_status": "connected"}

@app.post("/login-json")
def login_json(body: LoginBody, db: Session = Depends(get_db)):
    username = body.username.strip().lower()
    user = db.query(User).filter(User.username == username).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect username or password")

    token = create_token({"sub": user.username, "role": user.role})
    return {"access_token": token, "token_type": "bearer", "role": user.role, "username": user.username}

@app.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "full_name": user.full_name, "role": user.role}
