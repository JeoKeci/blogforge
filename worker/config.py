import os
import ssl
from dotenv import load_dotenv

load_dotenv()

redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")

class CeleryConfig:
    broker_url = redis_url
    result_backend = redis_url
    task_serializer = "json"
    result_serializer = "json"
    accept_content = ["json"]
    timezone = "Europe/Istanbul"
    enable_utc = True
    
    # Upstash SSL (rediss://) configuration to prevent certificate issues
    if redis_url.startswith("rediss://"):
        broker_use_ssl = {
            "ssl_cert_reqs": ssl.CERT_NONE
        }
        redis_backend_use_ssl = {
            "ssl_cert_reqs": ssl.CERT_NONE
        }
    
    # Zombie Process Recycler (Phase 1): recycle child processes to prevent memory leaks
    worker_max_tasks_per_child = 50
