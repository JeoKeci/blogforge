from celery import Celery
from config import CeleryConfig

app = Celery("blogforge_worker")
app.config_from_object(CeleryConfig)

# Import task definitions so they are registered
import tasks
