from .models import Treebank
from .serializers import (
    TreebankSerializer, ComponentSerializer, MetadataSerializer
)
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response
from django.db.models import Q

@api_view(['GET'])
def treebank_view(request):
    # TODO: make sure that non-public treesets are hidden if needed
    # This is purely backwards compatibility, as the uploads now no longer start with GRETEL-UPLOAD-
    treebanks = Treebank.objects.all() \
        .exclude(slug__startswith='GRETEL-UPLOAD-') \
        .exclude(~Q(upload__uploaded_by=request.user), upload__public=False)

    serializer = TreebankSerializer(treebanks, many=True)
    return Response(serializer.data)


@api_view(['GET'])
def treebank_metadata_view(request, treebank):
    try:
        treebank = Treebank.objects.get(slug=treebank)
        # TODO: test if treebank is public and if not if it is accessible
    except Treebank.DoesNotExist:
        return Response(None, status=status.HTTP_404_NOT_FOUND)
    serializer = MetadataSerializer(treebank, many=False)
    return Response(serializer.data)


@api_view(['GET'])
def treebank_components_view(request, treebank):
    try:
        treebank = Treebank.objects.get(slug=treebank)
        # TODO: test if treebank is public and if not if it is accessible
    except Treebank.DoesNotExist:
        return Response(None, status=status.HTTP_404_NOT_FOUND)
    components = treebank.components
    serializer = ComponentSerializer(components, many=True)
    return Response(serializer.data)
