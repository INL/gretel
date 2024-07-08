from rest_framework.response import Response
from rest_framework.decorators import (
    api_view, parser_classes, renderer_classes, authentication_classes
)
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer, BrowsableAPIRenderer
from rest_framework.authentication import BasicAuthentication
from rest_framework import status

from lxml import etree
from alpino_query import AlpinoQuery

from services.alpino import alpino, AlpinoError



@api_view(['POST'])
@authentication_classes([BasicAuthentication])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([JSONParser])
def upload_view(request, treebank):
    data = request.data
    try:
        # TODO perhaps use a schema for this...
        xml = data['xml']
        tokens = data['tokens']
        attributes = data['attributes']
        ignore_top_node = data['ignoreTopNode']
        respect_order = data['respectOrder']
    except KeyError as err:
        return Response(
            {'error': '{} is missing'.format(err)},
            status=status.HTTP_400_BAD_REQUEST
        )

    if ignore_top_node:
        remove = ['rel', 'cat']
    else:
        remove = ['rel']
    try:
        query = AlpinoQuery()
        query.mark(xml, tokens, attributes)
        marked_tree = query.marked_xml
        query.generate_subtree([remove])
        sub_tree = query.subtree_xml
        xpath = query.generate_xpath(respect_order)
    except etree.XMLSyntaxError as err:
        return Response(
            {'error': 'syntax error in input XML: {}'.format(err)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )

    response = {
        'xpath': xpath,
        'markedTree': marked_tree,
        'subTree': sub_tree
    }
    return Response(response)
