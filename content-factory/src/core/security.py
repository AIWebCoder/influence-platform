from datetime import datetime, timedelta
from typing import Any, Union, Optional
import secrets
import re

from jose import jwt, JWTError
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

from src.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

# In-memory store for refresh tokens (use Redis in production)
refresh_tokens_store = {}


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


# Password policy configuration
PASSWORD_POLICY = {
    "min_length": 8,
    "require_uppercase": True,
    "require_lowercase": True,
    "require_digit": True,
    "require_special": True,
}


def validate_password_strength(password: str) -> tuple[bool, Optional[str]]:
    """
    Validate password against security policy.
    Returns (is_valid, error_message)
    """
    if len(password) < PASSWORD_POLICY["min_length"]:
        return False, f"Password must be at least {PASSWORD_POLICY['min_length']} characters"
    
    if PASSWORD_POLICY["require_uppercase"] and not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter"
    
    if PASSWORD_POLICY["require_lowercase"] and not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter"
    
    if PASSWORD_POLICY["require_digit"] and not re.search(r"\d", password):
        return False, "Password must contain at least one digit"
    
    if PASSWORD_POLICY["require_special"] and not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        return False, "Password must contain at least one special character"
    
    return True, None


def create_access_token(
    subject: Union[str, Any], role: str = "admin", expires_delta: timedelta = None
) -> str:
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(
            minutes=settings.JWT_EXPIRE_MINUTES
        )
    to_encode = {"exp": expire, "sub": str(subject), "role": role, "type": "access"}
    encoded_jwt = jwt.encode(
        to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM
    )
    return encoded_jwt


def create_refresh_token(subject: str) -> str:
    """Create a refresh token with longer expiration."""
    # Refresh tokens valid for 7 days
    expire = datetime.utcnow() + timedelta(days=7)
    token = secrets.token_urlsafe(32)
    
    # Store token mapping
    refresh_tokens_store[token] = {
        "sub": subject,
        "exp": expire,
        "used": False
    }
    
    return token


def verify_refresh_token(token: str) -> Optional[dict]:
    """Verify refresh token and return subject if valid."""
    token_data = refresh_tokens_store.get(token)
    
    if not token_data:
        return None
    
    if token_data.get("used"):
        return None
    
    if datetime.utcnow() > token_data["exp"]:
        return None
    
    return {"sub": token_data["sub"]}


def invalidate_refresh_token(token: str) -> bool:
    """Mark refresh token as used."""
    if token in refresh_tokens_store:
        refresh_tokens_store[token]["used"] = True
        return True
    return False


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Decode JWT and return user info. Raises 401 if invalid."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        
        # Verify it's an access token
        if payload.get("type") != "access":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token type",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        email: str = payload.get("sub")
        role: str = payload.get("role", "viewer")
        if email is None:
            raise credentials_exception
        return {"email": email, "role": role}
    except JWTError:
        raise credentials_exception
