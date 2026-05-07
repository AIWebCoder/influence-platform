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
    GEMINI_MODEL: str = "gemini-2.5-flash"
    TEXT_PROVIDER_PRIMARY: str = "gemini"  # gemini | anthropic
    # Dynamic-mode guardrails: avoid synthetic/demo fallbacks in production-like flows.
    DYNAMIC_MODE_STRICT: bool = True
    GENERATION_ALLOW_SYNTHETIC_PREVIEW_FALLBACK: bool = False
    DALLE_API_KEY: str = ""
    OPENAI_API_KEY: str = "default_key_override_in_env_file"
    KIE_API_KEY: str = ""
    SEEDANCE_API_KEY: str = ""
    SEEDANCE_BASE_URL: str = "https://api.kie.ai"
    AILIVEAI_API_KEY: str = ""
    AILIVEAI_API_TOKEN: str = ""  # preferred env name; falls back to AILIVEAI_API_KEY
    # AliveAI: POST /prompts* must use api.aliveai.app. Do not set BASE to api-server (405). Poll GET uses api-server.
    AILIVEAI_BASE_URL: str = "https://api.aliveai.app"
    AILIVEAI_POLL_BASE_URL: str = "https://api-server.aliveai.app"
    AILIVEAI_VIDEO_MODEL: str = "SEEDANCE"  # DEFAULT | AUDIO | GROK | SEEDANCE
    # Applies when using AILIVEAI_API_KEY only (no AILIVEAI_API_TOKEN): key | bearer | auto (JWT → Bearer).
    # If AILIVEAI_API_TOKEN is set, Authorization is always Bearer regardless of this value.
    AILIVEAI_AUTH_MODE: str = "auto"
    AILIVEAI_REQUEST_BLOCKING: bool = False  # dev: sync create when supported
    # Optional default AliveAI image media id (skips blocking POST /prompts when set).
    AILIVEAI_MEDIA_ID: str = ""
    JWT_SECRET: str = "changeme"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440  # 24h
    ENVIRONMENT: str = "development"
    CONTENT_QUEUE_NAME: str = "content:ready"
    # Server-side gate for publish-intent validation (must match ops intent; dashboard uses NEXT_PUBLIC_*).
    FEATURE_INSTAGRAM_REEL_PUBLISH_ENABLED: bool = True
    PUBLISH_OUTBOX_POLL_INTERVAL_MS: int = 250
    PUBLISH_OUTBOX_STALE_SENT_SECONDS: int = 300

    # Rough cost model for UI estimates (abstract credits; tune per provider)
    GENERATION_CREDITS_PER_IMAGE: float = 1.0
    GENERATION_CREDITS_PER_VIDEO: float = 4.0
    # Seedance 2.0 (bytedance/seedance-2 on api.kie.ai) — used only for execution_mode
    # multi_scene_single_video. Matches SeedanceService: 720p, generate_audio=False, duration 4–15s.
    # Kie dashboard billing for 15s clips is often ~615 credits → 41 credits per output second (tune via env).
    # Docs (model + params): https://docs.kie.ai/market/bytedance/seedance-2
    SEEDANCE_ESTIMATE_CREDITS_PER_SECOND: float = 41.0
    # Target ratio for "full" video success; below this the pipeline still continues if ≥1 video
    # (demo-friendly). Production can set to 1.0 to require all scenes.
    GENERATION_MIN_VIDEO_SUCCESS_RATIO: float = 1.0
    # If true, image_generation fails when any scene has only one of two keyframe URLs
    GENERATION_FAIL_ON_PARTIAL_IMAGES: bool = False
    # When ffmpeg merges multiple clips locally, there is no public merged URL; promote first
    # scene clip for distribution while metadata/logs state merged file is local-only.
    GENERATION_PROMOTE_FIRST_CLIP_WHEN_MERGED_LOCAL_ONLY: bool = True
    # --- Demo mode (reversible via env; tighten for production) ---
    GENERATION_DEMO_MODE: bool = False
    GENERATION_ENABLE_DEMO_CAPS: bool = False
    GENERATION_DEMO_MAX_SCENES: int = 3
    # After video step, pin output_url to first scene video so later steps cannot leave job empty
    GENERATION_DEMO_PIN_OUTPUT_URL_AFTER_VIDEO: bool = True
    # Kie task polling cap (each poll waits POLL_INTERVAL_SECONDS in KieService)
    GENERATION_KIE_MAX_POLLS: int = 60
    # Seedance (createTask + recordInfo): Kie wall time for 15s output can exceed ~9m (e.g. 548s).
    # Poll interval is 5s in SeedanceService → 144 polls ≈ 12m ceiling before client TIMEOUT.
    GENERATION_SEEDANCE_MAX_POLLS: int = 144
    GENERATION_AILIVEAI_MAX_POLLS: int = 60
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

    def resolved_seedance_api_key(self) -> str:
        """Prefer explicit SEEDANCE_API_KEY; fall back to KIE_API_KEY for Kie-hosted Seedance."""
        k = (self.SEEDANCE_API_KEY or "").strip()
        if k:
            return k
        return (self.KIE_API_KEY or "").strip()

    def ailiveai_using_api_token_env(self) -> bool:
        """True when ``AILIVEAI_API_TOKEN`` is set (member access token path; use Bearer unless AILIVEAI_AUTH_MODE=key)."""
        return bool((self.AILIVEAI_API_TOKEN or "").strip())

    def resolved_ailiveai_api_key(self) -> str:
        """Prefer AILIVEAI_API_TOKEN; fall back to AILIVEAI_API_KEY. Strips accidental ``Bearer `` / ``Key `` prefixes."""
        def _strip_prefix(raw: str) -> str:
            v = (raw or "").strip()
            low = v.lower()
            if low.startswith("bearer "):
                return v[7:].strip()
            if low.startswith("key "):
                return v[4:].strip()
            return v

        t = _strip_prefix(self.AILIVEAI_API_TOKEN or "")
        if t:
            return t
        return _strip_prefix(self.AILIVEAI_API_KEY or "")

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
            if not (self.CLAUDE_API_KEY or "").strip():
                missing_required.append("CLAUDE_API_KEY must be set")
            
            if not self.ALLOWED_ORIGINS or self.ALLOWED_ORIGINS == "http://localhost:3000":
                missing_required.append("ALLOWED_ORIGINS must be configured for production")
        
        if self.ENVIRONMENT == "production":
            if insecure_defaults:
                raise ValueError(f"Production security violations: {', '.join(insecure_defaults)}")
            if missing_required:
                raise ValueError(f"Production required fields: {', '.join(missing_required)}")
        elif insecure_defaults:
            warnings.warn(f"Insecure configuration detected: {', '.join(insecure_defaults)}")


settings = Settings()

# Pre-compute the bcrypt hash once at startup for login verification
# bcrypt has a 72-byte limit — safely truncate bytes
safe_pwd = settings.ADMIN_PASSWORD.encode("utf-8", "ignore")[:72].decode("utf-8", "ignore")
ADMIN_PASSWORD_HASH = _pwd_context.hash(safe_pwd)
