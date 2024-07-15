from django.http import HttpRequest
from rest_framework.response import Response
from rest_framework.decorators import (
    api_view, parser_classes, renderer_classes, authentication_classes
)
from rest_framework.request import Request

from rest_framework.parsers import MultiPartParser
from rest_framework.renderers import JSONRenderer, BrowsableAPIRenderer
from rest_framework.authentication import BasicAuthentication
from rest_framework import status

from lxml import etree
from alpino_query import AlpinoQuery
from yaml import serialize

from services.alpino import alpino, AlpinoError
from upload.models import TreebankUpload
from upload.serializers import TreebankUploadSerializer



@api_view(['POST'])
@authentication_classes([BasicAuthentication])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([MultiPartParser])
def upload_view(request: Request, treebank: str):
	request.data['treebank'] = treebank

	serializer = TreebankUploadSerializer(data=request.data, context={'request': request})
	serializer.is_valid(raise_exception=True)
	serializer.save()
	
	return Response(
		serializer.data,
		status=status.HTTP_201_CREATED
	)	
