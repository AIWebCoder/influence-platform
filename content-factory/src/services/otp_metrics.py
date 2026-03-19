from prometheus_client import Counter, Histogram, Gauge

otp_requests_total = Counter(
    'otp_requests_total',
    'Total OTP requests',
    ['status', 'provider']
)

otp_verifications_total = Counter(
    'otp_verifications_total',
    'Total OTP verifications',
    ['status']
)

otp_send_duration_seconds = Histogram(
    'otp_send_duration_seconds',
    'Time taken to send OTP',
    ['provider']
)

sms_providers_available = Gauge(
    'sms_providers_available',
    'Number of available SMS providers'
)

provider_failures_total = Counter(
    'provider_failures_total',
    'Total provider failures',
    ['provider', 'error_type']
)
