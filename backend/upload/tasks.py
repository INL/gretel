from celery import shared_task, Task
from .models import TreebankUpload

@shared_task(bind=True, name='process_upload')
def process_upload(self: Task, upload_id: int):

	self.update_state(state='PROGRESS', meta={'message': 'starting', 'done': False})
	
	upload = TreebankUpload.objects.get(id=upload_id)
	if not upload:
		self.update_state(state='FAILURE', meta={'message': 'upload not found', 'done': True})
		return

	upload.progress_reporter = lambda state, meta: self.update_state(state=state, meta=meta)

	try:
		upload.prepare()
		upload.process()
		upload.cleanup()
	except Exception as e:
		# Check if already logged
		# The error is in the progress object, it was logged to celery already
		# If not, we should just pass the error on
		if upload.PROGRESS.error is not None:
			raise e

