from rest_framework.response import Response
from rest_framework.decorators import (
    api_view, parser_classes, renderer_classes, authentication_classes
)
from rest_framework.parsers import JSONParser
from rest_framework.renderers import JSONRenderer, BrowsableAPIRenderer
from rest_framework.authentication import BasicAuthentication
from rest_framework import status
from django.conf import settings

from treebanks.models import Component, BaseXDB, Treebank
from .models import SearchQuery
from .basex_search import (
    generate_xquery_showtree, generate_xquery_metadata_count,
    parse_metadata_count_result
)
from .tasks import run_search_query
from services.basex import basex


def run_search(query_obj) -> None:
    query_obj.perform_search()


def _create_component_on_the_fly(component_slug: str, treebank: str) -> None:
    '''Try to create a component object consisting of one database
    with the same name. Also create Treebank object if it does not yet
    exist'''
    basex_db = BaseXDB(component_slug)
    try:
        basex_db.size = basex_db.get_db_size()
    except OSError:
        return
    treebank, _ = Treebank.objects.get_or_create(slug=treebank)
    component = Component(slug=component_slug, title=component_slug,
                          nr_sentences=basex_db.get_number_of_sentences(),
                          nr_words=basex_db.get_number_of_words())
    component.treebank = treebank
    component.save()  # TODO: check for uniqueness
    basex_db.component = component
    basex_db.save()


def _get_or_create_components(component_slugs, treebank):
    '''Check if all requested components are present as Component
    objects in database; if not create them if a corresponing
    BaseX database is present. This is meant for compatibility with
    the existing separate gretel-upload application'''
    existing_components = set(Component.objects.filter(
        slug__in=component_slugs,
        treebank__slug=treebank
    ).values_list('slug', flat=True))
    existing_components = set(map(lambda x: x.upper(), existing_components))
    nonexisting_components = set(component_slugs) - existing_components
    for component in nonexisting_components:
        # These components were probably made by gretel-upload
        # (a separate application). Create them if they indeed exist
        _create_component_on_the_fly(component, treebank)
        # Create BaseX database with the same name, because
        # gretel-upload components exist of only one database
    return Component.objects.filter(slug__in=component_slugs,
                                    treebank__slug=treebank)


@api_view(['POST'])
@authentication_classes([BasicAuthentication])  # No CSRF verification for now
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([JSONParser])
def search_view(request):
    data = request.data
    try:
        xpath = data['xpath']
        treebank = data['treebank']
        component_slugs = data['components']
    except KeyError as err:
        return Response(
            {'error': '{} is missing'.format(err)},
            status=status.HTTP_400_BAD_REQUEST
        )
    query_id = data.get('query_id', None)
    start_from = data.get('start_from', 0)
    is_analysis = data.get('is_analysis', False)
    variables = data.get('variables', [])
    if is_analysis:
        maximum_results = settings.MAXIMUM_RESULTS_ANALYSIS
    else:
        maximum_results = settings.MAXIMUM_RESULTS

    if query_id:
        new_query = False
        try:
            # We also require the right XPath to avoid the possibility of
            # tampering with queries of other users.
            # TODO: also check if the component list is correct
            query = SearchQuery.objects.get(pk=query_id)
        except SearchQuery.DoesNotExist:
            return Response(
                {'error': 'Cannot find given query_id'},
                status=status.HTTP_400_BAD_REQUEST
            )
    else:
        new_query = True
        component_objects = _get_or_create_components(component_slugs,
                                                      treebank)
        if component_objects.count() != len(component_slugs):
            return Response(
                {'error': 'Not all requested components could be found.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        query = SearchQuery(xpath=xpath, variables=variables)
        query.save()
        query.components.add(*component_objects)
        query.initialize()

    if new_query:
        try:
            run_search_query.delay(query.pk)
        except run_search_query.OperationalError:
            # No connection with message broker - run synchronously
            run_search_query.apply((query.pk,))

    # Get results so far, if any
    results, percentage = query.get_results(start_from, maximum_results)
    if request.accepted_renderer.format == 'api':
        # If using the API view, only show part of the results, because
        # the HTML rendering of Django Rest Framework turns out to be
        # very slow
        results = str(results)[0:5000] + \
            '… (remainder hidden because of slow rendering)'
    response = {
        'query_id': query.id,
        'search_percentage': percentage,
        'results': results,
    }
    if percentage == 100:
        response['errors'] = query.get_errors()
    if query.cancelled is True:
        response['cancelled'] = True

    return Response(response)


@api_view(['POST'])
@authentication_classes([BasicAuthentication])
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([JSONParser])
def cancel_query_view(request):
    data = request.data
    try:
        xpath = data['xpath']
        query_id = data['query_id']
    except KeyError as err:
        return Response(
            {'error': '{} is missing'.format(err)},
            status=status.HTTP_400_BAD_REQUEST
        )

    try:
        # We also require the right XPath to avoid the possibility of
        # tampering with queries of other users.
        # TODO: also check if the component list is correct
        query = SearchQuery.objects.get(xpath=xpath, pk=query_id)
    except SearchQuery.DoesNotExist:
        return Response(
            {'error': 'Cannot find given query_id'},
            status=status.HTTP_400_BAD_REQUEST
        )
    query.cancel_search()


@api_view(['POST'])
@authentication_classes([BasicAuthentication])  # No CSRF verification for now
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([JSONParser])
def tree_view(request):
    data = request.data
    try:
        database = data['database']
        sentence_id = data['sentence_id']
    except KeyError as err:
        return Response(
            {'error': '{} is missing'.format(err)},
            status=status.HTTP_400_BAD_REQUEST
        )
    try:
        xquery = generate_xquery_showtree(database, sentence_id)
    except ValueError as err:
        return Response(
            {'error': str(err)},
            status=status.HTTP_400_BAD_REQUEST
        )
    try:
        result = basex.perform_query(xquery)
    except OSError as err:
        return Response(
            {'error': str(err)},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR
        )
    return Response({'tree': result})


@api_view(['POST'])
@authentication_classes([BasicAuthentication])  # No CSRF verification for now
@renderer_classes([JSONRenderer, BrowsableAPIRenderer])
@parser_classes([JSONParser])
def metadata_count_view(request):
    data = request.data
    try:
        xpath = data['xpath']
        treebank = data['treebank']
        components = data['components']
    except KeyError as err:
        return Response(
            {'error': '{} is missing'.format(err)},
            status=status.HTTP_400_BAD_REQUEST
        )
    xml_pieces = []
    for component_slug in components:
        component = Component.objects.get(
            slug=component_slug, treebank__slug=treebank
        )
        if not component.contains_metadata:
            continue
        dbs = component.get_databases().keys()
        for db in dbs:
            xquery = generate_xquery_metadata_count(db, xpath)
            xml_count_for_db = basex.perform_query(xquery)
            if xml_count_for_db == '<metadata/>':
                continue
            xml_pieces.append(
                xml_count_for_db
                .replace('<metadata>', '')
                .replace('</metadata>', '')
            )
    xml = '<metadata>' + ''.join(xml_pieces) + '</metadata>'
    counts = parse_metadata_count_result(xml)
    return Response(counts)
