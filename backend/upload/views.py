from rest_framework.response import Response
from rest_framework.decorators import (
    api_view, parser_classes, renderer_classes, authentication_classes
)
from rest_framework.request import Request

from rest_framework.parsers import MultiPartParser
from rest_framework.renderers import JSONRenderer, BrowsableAPIRenderer
from rest_framework.authentication import BasicAuthentication
from rest_framework import status

from upload.models import TreebankUpload, UploadProgress, TreebankExistsError
from upload.serializers import TreebankUploadSerializer
from upload.tasks import process_upload

@api_view(['POST'])
@authentication_classes([BasicAuthentication])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([MultiPartParser])
def upload_view(request: Request, treebank: str):
	request.data['name'] = treebank

	serializer = TreebankUploadSerializer(data=request.data, context={'request': request})
	if not serializer.is_valid():
		duplicate = TreebankUpload.objects.get(name=treebank)
		if duplicate.treebank is not None:
			return Response({
				'status': 'FAILURE',
				'info': {
					'error': 'Treebank already exists',
					'message': 'Treebank already exists',
					'done': True
				}
			}, status=status.HTTP_400_BAD_REQUEST)
		else:
			duplicate.delete()

	serializer.is_valid(raise_exception=True)

	# TODO uniqueness constraint?
	upload = TreebankUpload(**serializer.validated_data)
	upload.save()
	task = process_upload.delay(upload_id=upload.pk)

	return Response(
		{'upload_id': task.id},
		status=status.HTTP_201_CREATED
	)

@api_view(['GET'])
@authentication_classes([BasicAuthentication])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
def upload_status(request: Request, upload_id: str):
	result = process_upload.AsyncResult(upload_id)
	
	info = {
		'error': None,
		'message': '',
		'done': False
	}
	if result.status == 'PENDING':
		return Response({'status': result.status, 'info': info}, status=status.HTTP_200_OK)
	elif result.status == 'PROGRESS':
		return Response({'status': result.status, 'info': result.info}, status=status.HTTP_200_OK)
	elif result.status == 'SUCCESS':
		return Response({'status': result.status, 'info': result.info}, status=status.HTTP_200_OK)
	elif result.status == 'FAILURE':
		info['done'] = True
		# Check if we have an exception or a failed progress event.
		if isinstance(result.info, Exception):
			info['error'] = str(result.info)
			info['done'] = True
			info['message'] = 'An error occurred'
		elif isinstance(result.info, dict):
			info = result.info
			# Set some fields the client expects
			info['done'] = True
			info['message'] = info.get('message', 'An error occurred')
			info['error'] = info.get('error', 'Unknown error')
		else:
			info['error'] = 'Unknown error'
			info['message'] = 'An error occurred'
			info['done'] = True

		return Response({'status': result.status, 'info': info}, status=status.HTTP_200_OK)
	else:
		info['error'] = f'Unexpected status: {result.status}'
		info['done'] = True
		info['message'] = 'An error occurred'

		return Response(
			{'status': 'UNEXPECTED', 'info': info},
			status=status.HTTP_500_INTERNAL_SERVER_ERROR
		)