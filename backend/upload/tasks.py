from celery import shared_task, Task
from .models import TreebankUpload
from .services import UploadProgress, UploadProcessService

@shared_task(bind=True, name='process_upload')
def process_upload(self: Task, upload_id: int):

	self.update_state(state='PROGRESS', meta={'message': 'starting', 'done': False})
	
	upload = TreebankUpload.objects.get(treebank=upload_id)
	if not upload:
		self.update_state(state='FAILURE', meta={'message': 'upload not found', 'done': True})
		return

	service = UploadProcessService(upload, progress_reporter=lambda state, progress: self.update_state(state=state, meta=progress), delete_input_files=True)

	try:
		service.prepare()
		service.process()
		service.cleanup()
	except Exception as e:
		# If we raise an exception here, it will be reported to the task.
		# So, only do that if it hasn't already been reported.
		# We can see if that is the case by checking if the error is in the progress object.
		# If it is, it's already been reported to the task.
		# If it hasn't been reported yet, it's something deeply unexpected and we should raise it.
		service.cleanup()
		upload.treebank.delete()
		upload.delete()
		if service.PROGRESS.error != e:
			raise e

