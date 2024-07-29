import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'gretel.settings')

app = Celery('gretel')

app.config_from_object('django.conf:settings', namespace='CELERY')

app.autodiscover_tasks()


@app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    sender.add_periodic_task(crontab(hour=3), purge_cache.s())


@app.task
def purge_cache():
    from search.models import ComponentSearchResult
    from datetime import timedelta, datetime
    ComponentSearchResult.purge_cache()

    # if upload timestamp is >10m ago and if treebank is not set 
    # it seems the upload went wrong somewhere and we should clear it
    # or if processed is set, then it should also be safe to delete.
    
    from upload.models import TreebankUpload
    for upload in TreebankUpload.objects.all():
        if upload.processed or (upload.upload_timestamp < (datetime.now() - timedelta(minutes=10)) and not upload.treebank):
            upload.cleanup()
            upload.delete()
