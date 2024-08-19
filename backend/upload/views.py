from rest_framework.response import Response
from rest_framework.decorators import (
    api_view, parser_classes, renderer_classes, authentication_classes, permission_classes
)
from rest_framework.request import Request

from rest_framework.parsers import MultiPartParser
from rest_framework.renderers import JSONRenderer, BrowsableAPIRenderer
from rest_framework.authentication import BasicAuthentication
from rest_framework import status
from django.utils.text import slugify

from treebanks.models import Treebank
from treebanks.serializers import TreebankSerializer
from upload.models import TreebankUpload, TreebankExistsError
from upload.serializers import TreebankUploadSerializer
from upload.tasks import process_upload

from rest_framework.authentication import SessionAuthentication, TokenAuthentication
from rest_framework.permissions import IsAuthenticated

@api_view(['POST'])
@permission_classes([IsAuthenticated])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([MultiPartParser])
def upload_view(request: Request, treebank: str):
    request.data['slug'] = slugify(treebank)
    
    treebankSerializer = TreebankSerializer(data = request.data)
    uploadSerializer = TreebankUploadSerializer(data = request.data, context={'request': request})
    # There is a specific order of operations here:
    # The treebank needs to be created first so the upload foreign key exists
    # Then the upload can be created
    # If the upload can't be created, the treebank needs to be deleted again.
    if treebankSerializer.is_valid():
        treebankObj = treebankSerializer.save()
        if uploadSerializer.is_valid():
            uploadObj = uploadSerializer.save()
        else: 
            treebankObj.delete()
            return Response(
                {
                    'status': 'FAILURE',
                    'info': {
                        'error': format_serializer_errors(uploadSerializer.errors),
                        'message': 'Invalid data',
                        'done': True
                    }
                },
                status=status.HTTP_400_BAD_REQUEST
            )
    else:
        return Response(
            {
                'status': 'FAILURE',
                'info': {
                    'error': format_serializer_errors(treebankSerializer.errors),
                    'message': 'Invalid data',
                    'done': True
                }
            },
            status=status.HTTP_400_BAD_REQUEST
        )
    
    task = process_upload.delay(upload_id=uploadObj.treebank.slug)

    return Response(
        {'upload_id': task.id},
        status=status.HTTP_201_CREATED
    )

@api_view(['GET'])
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


@api_view(['GET'])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@permission_classes([IsAuthenticated])
def list_uploads(request: Request):
    if request.user.is_superuser:
        uploads = TreebankUpload.objects.all()
    else:
        uploads = TreebankUpload.objects.filter(uploaded_by=request.user)
    serializer = TreebankUploadSerializer(uploads, many=True)
    return Response(serializer.data)

@api_view(['DELETE'])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@permission_classes([IsAuthenticated])
def delete_upload(request: Request, treebank: str):
    try:
        if request.user.is_superuser:
            upload = TreebankUpload.objects.get(treebank=treebank)
        else:
            upload = TreebankUpload.objects.get(treebank=treebank, uploaded_by=request.user)
        
    except TreebankUpload.DoesNotExist:
        return Response(
            {'message': 'Upload not found'},
            status=status.HTTP_404_NOT_FOUND
        )
    
    # Cascades into upload.
    upload.treebank.delete()
    
    return Response(
        {'message': 'Upload deleted'},
        status=status.HTTP_200_OK
    )

def format_serializer_errors(errors: dict[str, dict[str, list[str]]]) -> str:
    def recursive_format(error_dict, parent_key=''):
        messages = []
        for key, value in error_dict.items():
            full_key = f"{parent_key}{key}" if parent_key else key
            if isinstance(value, dict):
                messages.extend(recursive_format(value, f"{full_key}."))
            elif isinstance(value, list):
                for sub_value in value:
                    if isinstance(sub_value, dict):
                        messages.extend(recursive_format(sub_value, f"{full_key}."))
                    else:
                        messages.append(f"{full_key}: {sub_value}")
            else:
                messages.append(f"{full_key}: {value}")
        return messages
    
    formatted_messages = recursive_format(errors)
    return "\n".join(formatted_messages)



