from pydantic_settings import BaseSettings
from passlib.context import CryptContext
import warnings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://ipuser:ippassword@localhost:5432/influence_platform"
    REDIS_URL: str = "redis://localhost:6379"
    CLAUDE_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = "default_key_override_in_env_file"
    CLAUDE_MODEL: str = "claude-3-5-haiku-20241022"
    GEMINI_API_KEY: str = ""
    DALLE_API_KEY: str = ""
    OPENAI_API_KEY: str = "default_key_override_in_env_file"
    KIE_API_KEY: str = ""
    JWT_SECRET: str = "changeme"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24h
    ENVIRONMENT: str = "development"
    CONTENT_QUEUE_NAME: str = "content:ready"

    # Rough cost model for UI estimates (abstract credits; tune per provider)
    GENERATION_CREDITS_PER_IMAGE: float = 1.0
    GENERATION_CREDITS_PER_VIDEO: float = 4.0
    # Target ratio for "full" video success; below this the pipeline still continues if ≥1 video
    # (demo-friendly). Production can set to 1.0 to require all scenes.
    GENERATION_MIN_VIDEO_SUCCESS_RATIO: float = 0.5
    # If true, image_generation fails when any scene has only one of two keyframe URLs
    GENERATION_FAIL_ON_PARTIAL_IMAGES: bool = False
    # When ffmpeg merges multiple clips locally, there is no public merged URL; promote first
    # scene clip for distribution while metadata/logs state merged file is local-only.
    GENERATION_PROMOTE_FIRST_CLIP_WHEN_MERGED_LOCAL_ONLY: bool = True
    # --- Demo mode (reversible via env; tighten for production) ---
    GENERATION_DEMO_MODE: bool = True
    GENERATION_DEMO_MAX_SCENES: int = 3
    # After video step, pin output_url to first scene video so later steps cannot leave job empty
    GENERATION_DEMO_PIN_OUTPUT_URL_AFTER_VIDEO: bool = True
    # Kie task polling cap (each poll waits POLL_INTERVAL_SECONDS in KieService)
    GENERATION_KIE_MAX_POLLS: int = 60
    # When DEMO_MODE, effective polls are min(KIE_MAX_POLLS, DEMO_KIE_MAX_POLLS)
    GENERATION_DEMO_KIE_MAX_POLLS: int = 30
    # Parallel Kie video calls (DB commits remain sequential on one session)
    GENERATION_VIDEO_MAX_CONCURRENCY: int = 3
    # After Kie reports state=success without resultUrls, keep polling this many more
    # success polls (same 5s cadence) before treating as SUCCESS_NO_URLS (~40s when 8).
    GENERATION_VIDEO_SUCCESS_WAIT_POLLS: int = 8
    # Extra Kie video attempts only when first ends with TIMEOUT or SUCCESS_NO_URLS
    GENERATION_KIE_VIDEO_MAX_RETRIES: int = 1
    # Kie createTask POST: max attempts (initial + retries) on HTTP/body 5xx only
    GENERATION_KIE_VIDEO_CREATE_MAX_ATTEMPTS: int = 3
    # If True, multi-clip ffmpeg failure still sets output_url to first scene clip (demo only)
    GENERATION_ASSEMBLY_FALLBACK_ON_CONCAT_FAIL: bool = True
    
    # Admin credentials - MUST be set in production
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
    
    # Enable/disable admin fallback (disable in production)
    ADMIN_FALLBACK_ENABLED: bool = True
    
    # CORS — comma-separated list of allowed origins
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    
    # SMS Provider Configuration (Twilio/MessageBird/Vonage)
    TWILIO_ACCOUNT_SID: str = ""
    TWILIO_AUTH_TOKEN: str = ""
    TWILIO_FROM_NUMBER: str = ""
    MESSAGEBIRD_API_KEY: str = ""
    MESSAGEBIRD_ORIGINATOR: str = ""
    VONAGE_API_KEY: str = ""
    VONAGE_API_SECRET: str = ""
    VONAGE_FROM_NUMBER: str = ""
    
    # OTP Configuration
    OTP_EXPIRE_MINUTES: int = 10
    OTP_MAX_ATTEMPTS: int = 3
    OTP_COOLDOWN_SECONDS: int = 60

    class Config:
        env_file = ".env"

    def resolved_anthropic_api_key(self) -> str:
        """Prefer ANTHROPIC_API_KEY; fall back to CLAUDE_API_KEY when unset or placeholder."""
        k = (self.ANTHROPIC_API_KEY or "").strip()
        if k and k != "default_key_override_in_env_file":
            return k
        return (self.CLAUDE_API_KEY or "").strip()

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self._validate_security()

    def _validate_security(self):
        """Validate security settings and warn about insecure defaults."""
        insecure_defaults = []
        missing_required = []
        
        # Check for default JWT secret
        if self.JWT_SECRET == "changeme" or len(self.JWT_SECRET) < 32:
            insecure_defaults.append("JWT_SECRET must be at least 32 characters")
        
        # Check for default admin credentials
        if self.ADMIN_PASSWORD == "admin":
            insecure_defaults.append("ADMIN_PASSWORD is using default 'admin'")
        
        # Validate ADMIN_PASSWORD minimum length
        if len(self.ADMIN_PASSWORD) < 8:
            insecure_defaults.append("ADMIN_PASSWORD must be at least 8 characters")
        
        # Check required API keys for production
        if self.ENVIRONMENT == "production":
            if not self.CLAUDE_API_KEY or self.CLAUDE_API_KEY.startswith("sk-"):
                missing_required.append("CLAUDE_API_KEY must be set")
            
            if not self.ALLOWED_ORIGINS or self.ALLOWED_ORIGINS == "http://localhost:3000":
                missing_required.append("ALLOWED_ORIGINS must be configured for production")
        
        if self.ENVIRONMENT == "production":
            if insecure_defaults:
                raise ValueError(f"Production security violations: {', '.join(insecure_defaults)}")
            if missing_required:
                raise ValueError(f"Production required fields: {', '.join(missing_required)}")
            if not self.ADMIN_FALLBACK_ENABLED:
                raise ValueError("ADMIN_FALLBACK_ENABLED must be True in production for initial setup")
        elif insecure_defaults:
            warnings.warn(f"Insecure configuration detected: {', '.join(insecure_defaults)}")


settings = Settings()

# Pre-compute the bcrypt hash once at startup for login verification
# bcrypt has a 72-byte limit — safely truncate bytes
safe_pwd = settings.ADMIN_PASSWORD.encode("utf-8", "ignore")[:72].decode("utf-8", "ignore")
ADMIN_PASSWORD_HASH = _pwd_context.hash(safe_pwd)
