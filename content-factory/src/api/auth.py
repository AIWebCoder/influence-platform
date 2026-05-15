from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_
from datetime import timedelta, datetime
import re

from src.core.config import settings
from src.core.database import get_db
from src.core.security import verify_password, create_access_token
from src.models.user import User
from src.models.verification import VerificationSession
from src.services.sms_service import sms_service, generate_otp
from src.services.otp_metrics import otp_verifications_total

router = APIRouter()


class SendOTPRequest(BaseModel):
    phone_number: str = Field(..., min_length=10, max_length=20)


class VerifyOTPRequest(BaseModel):
    phone_number: str = Field(..., min_length=10, max_length=20)
    code: str = Field(..., min_length=6, max_length=6)


class RegisterWithPhoneRequest(BaseModel):
    phone_number: str = Field(..., min_length=10, max_length=20)
    code: str = Field(..., min_length=6, max_length=6)
    email: str = Field(..., pattern=r'^[\w\.-]+@[\w\.-]+\.\w+$')
    password: str = Field(..., min_length=8)
    role: str = Field(default="viewer")


def validate_phone_number(phone: str) -> str:
    """Normalize phone number to E.164 format."""
    digits = re.sub(r'\D', '', phone)
    
    if len(digits) == 10:
        return f"+1{digits}"
    elif len(digits) == 11 and digits.startswith('1'):
        return f"+{digits}"
    elif digits.startswith('+'):
        return f"+{digits.lstrip('+')}"
    elif len(digits) >= 10:
        return f"+{digits}"
    
    raise ValueError("Invalid phone number format")


@router.post("/send-otp")
async def send_otp(
    request: SendOTPRequest,
    db: AsyncSession = Depends(get_db)
):
    """Send OTP code to phone number."""
    try:
        normalized_phone = validate_phone_number(request.phone_number)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    now = datetime.utcnow()
    
    existing_session = await db.execute(
        select(VerificationSession)
        .where(VerificationSession.phone_number == normalized_phone)
        .order_by(VerificationSession.created_at.desc())
        .limit(1)
    )
    last_session = existing_session.scalar_one_or_none()
    
    if last_session:
        if last_session.status == "pending" and not last_session.is_expired:
            if last_session.is_on_cooldown:
                raise HTTPException(
                    status_code=429,
                    detail=f"Too many requests. Please wait {settings.OTP_COOLDOWN_SECONDS} seconds before requesting a new code."
                )
        
        cooldown_threshold = now - timedelta(seconds=settings.OTP_COOLDOWN_SECONDS)
        recent_requests = await db.execute(
            select(VerificationSession)
            .where(
                and_(
                    VerificationSession.phone_number == normalized_phone,
                    VerificationSession.created_at > cooldown_threshold
                )
            )
        )
        if recent_requests.scalars().first():
            raise HTTPException(
                status_code=429,
                detail=f"Rate limit exceeded. Please wait {settings.OTP_COOLDOWN_SECONDS} seconds."
            )
    
    code = generate_otp()
    expires_at = now + timedelta(minutes=settings.OTP_EXPIRE_MINUTES)
    
    session = VerificationSession(
        phone_number=normalized_phone,
        code=code,
        status="pending",
        expires_at=expires_at,
        attempts=0
    )
    db.add(session)
    await db.commit()
    
    result = await sms_service.send_otp(normalized_phone, code)
    
    if result["success"]:
        return {
            "success": True,
            "message": "OTP sent successfully",
            "expires_in_minutes": settings.OTP_EXPIRE_MINUTES
        }
    else:
        await db.delete(session)
        await db.commit()
        raise HTTPException(
            status_code=503,
            detail=f"Failed to send SMS: {result.get('error', 'Unknown error')}"
        )


@router.post("/verify-otp")
async def verify_otp(
    request: VerifyOTPRequest,
    db: AsyncSession = Depends(get_db)
):
    """Verify OTP code and return verification token."""
    try:
        normalized_phone = validate_phone_number(request.phone_number)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    result = await db.execute(
        select(VerificationSession)
        .where(VerificationSession.phone_number == normalized_phone)
        .order_by(VerificationSession.created_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(
            status_code=404,
            detail="No verification session found. Please request a new OTP."
        )
    
    if session.is_expired:
        session.status = "expired"
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail="Verification code has expired. Please request a new one."
        )
    
    if session.status == "verified":
        raise HTTPException(
            status_code=400,
            detail="This code has already been verified."
        )
    
    if session.is_on_cooldown:
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Please request a new OTP."
        )
    
    session.attempts += 1
    
    if session.code != request.code:
        otp_verifications_total.labels(status="failed").inc()
        
        if session.attempts >= settings.OTP_MAX_ATTEMPTS:
            session.status = "failed"
            session.cooldown_until = datetime.utcnow() + timedelta(seconds=settings.OTP_COOLDOWN_SECONDS)
            await db.commit()
            raise HTTPException(
                status_code=400,
                detail="Too many failed attempts. Please request a new OTP."
            )
        
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail=f"Invalid code. {settings.OTP_MAX_ATTEMPTS - session.attempts} attempts remaining."
        )
    
    session.status = "verified"
    session.verified_at = datetime.utcnow()
    await db.commit()
    
    otp_verifications_total.labels(status="success").inc()
    
    verification_token = create_access_token(
        subject=f"verified:{normalized_phone}",
        role="verified",
        expires_delta=timedelta(hours=1)
    )
    
    return {
        "success": True,
        "verification_token": verification_token,
        "message": "Phone number verified successfully"
    }


@router.post("/register-with-phone")
async def register_with_phone(
    request: RegisterWithPhoneRequest,
    db: AsyncSession = Depends(get_db)
):
    """Register new user with phone verification."""
    try:
        normalized_phone = validate_phone_number(request.phone_number)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    result = await db.execute(
        select(VerificationSession)
        .where(VerificationSession.phone_number == normalized_phone)
        .order_by(VerificationSession.created_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()
    
    if not session or session.status != "verified":
        raise HTTPException(
            status_code=400,
            detail="Phone number must be verified first. Please complete OTP verification."
        )
    
    existing_user = await db.execute(
        select(User).where(User.email == request.email)
    )
    if existing_user.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Email already registered"
        )
    
    from src.core.security import hash_password
    
    user = User(
        email=request.email,
        hashed_password=hash_password(request.password),
        role=request.role,
        is_active=True
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    access_token = create_access_token(
        subject=user.email,
        role=user.role,
        expires_delta=timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": str(user.id),
            "email": user.email,
            "role": user.role
        }
    }


@router.post("/login")
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    """Login with email + password against the `users` table. No env-var fallback (seed first admin via startup)."""
    result = await db.execute(select(User).where(User.email == form_data.username))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is disabled")
    access_token = create_access_token(
        subject=user.email,
        role=user.role,
        expires_delta=timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {"id": str(user.id), "email": user.email, "role": user.role},
    }
