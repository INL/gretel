<?php

require '../vendor/autoload.php';
require '../../config.php';
require '../../preparatory-scripts/alpino-parser.php';
require '../../preparatory-scripts/xpath-generator.php';
require './results.php';
require './configured-treebanks.php';
require './show-tree.php';
require './treebank-counts.php';

// Maybe change this?
header('Access-Control-Allow-Origin: *');

$base = $_SERVER['REQUEST_URI'];
$base = explode('/router.php/', $_SERVER['REQUEST_URI'])[0].'/router.php';
$router = new AltoRouter();
$router->setBasePath($base);

$router->map('OPTIONS', '@.*', function () {
    header('Access-Control-Allow-Methods: POST, GET, OPTIONS, DELETE');
    header('Access-Control-Allow-Headers: Content-Type'); // allow all mime-types for content-type
    return;
});

$router->map('GET', '/configured_treebanks', function () {
    header('Content-Type: application/json');
    echo json_encode(getConfiguredTreebanks());
});

$router->map('POST', '/generate_xpath', function () {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    $xml = $data['xml'];
    $tokens = $data['tokens'];
    $attributes = $data['attributes'];
    $ignore_top_node = $data['ignoreTopNode'];
    $respect_order = $data['respectOrder'];

    $generated = generate_xpath($xml, $tokens, $attributes, $ignore_top_node, $respect_order);
    header('Content-Type: application/json');
    echo json_encode($generated);
});

$router->map('GET', '/parse_sentence/[*:sentence]', function ($sentence) {
    try {
        $xml = alpino(str_replace(
            '_SLASH_',
            '/',
            urldecode($sentence)), 'ng'.time());
        header('Content-Type: application/xml');
        echo $xml;
    } catch (Exception $e) {
        http_response_code(500);
        die($e->getMessage());
    }
});

$router->map('GET', '/tree/[*:treebank]/[*:component]/[*:sentid]', function ($treebank, $component, $sentid) {
    if (isset($_GET['db'])) {
        $database = $_GET['db'];
    } else {
        $database = $component;
    }
    showTree($sentid, $treebank, $component, $database);
});

$router->map('POST', '/metadata_counts', function () {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    $corpus = $data['corpus'];
    $components = $data['components'];
    $xpath = $data['xpath'];

    $counts = get_metadata_counts($corpus, $components, $xpath);
    header('Content-Type: application/json');
    echo json_encode($counts);
});

$router->map('POST', '/treebank_counts', function () {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    $corpus = $data['corpus'];
    $components = $data['components'];
    $xpath = $data['xpath'];

    $counts = getTreebankCounts($corpus, $components, $xpath);
    header('Content-Type: application/json');
    echo json_encode($counts);
});

$router->map('POST', '/results', function () {
    global $resultsLimit, $analysisLimit, $analysisFlushLimit, $flushLimit;
    isset($analysisLimit) or $analysisLimit = $resultsLimit;

    $input = file_get_contents('php://input');
    $data = json_decode($input, true);

    /** @var string $xpath */           $xpath = $data['xpath'];
    /** @var bool $context */           $context = $data['retrieveContext'];
    /** @var string $corpus */          $corpus = $data['corpus'];
    /** @var int $start */              $start = $data['iteration'];
    /** @var array|null $variables */   $variables = $data['variables'];

    // The (remaining) components of this corpus to search
    // Only the first component is actually searched in this request.
    /** @var string[] $components */
    $components = $data['remainingComponents'];
    // The (remaining) databases to search for this component.
    // If this is null, retrieves all relevant databases for the component.
    // (Either grind databases, or smaller parts of the component as defined in one of the .lst files in /treebank-parts)
    // If neither is set, the component's name is assumed to also be the name of the database
    // (usually ${corpus}_ID_${component})
    // It is pingponged with the client so we can keep track where we are in the searching.
    /** @var string[]|null $databases */
    $databases = isset($data['remainingDatabases'])
        ? $data['remainingDatabases']
        : null;

    $visitedDatabases = isSet($data['visitedDatabases'])
        ? $data['visitedDatabases']
        : array();

    // Limit on total results to return
    $searchLimit = $data['isAnalysis'] ? $analysisLimit : $resultsLimit;
    $searchLimit = isset($data['searchLimit']) ? min($searchLimit, $data['searchLimit']) : $searchLimit;

    // Limit on results to return this request
    $flushLimit = $data['isAnalysis'] ? $analysisFlushLimit : $flushLimit;
    $flushLimit = min($flushLimit, $searchLimit);

    list(
        'remainingComponents' => $newRemainingComponents,
        'remainingDatabases' => $newRemainingDatabases,
        'visitedDatabases' => $newVisitedDatabases,
        'start' => $newStart,
        'hits' => $hits,
        'xquery' => $xquery
    ) = getResults(
        $xpath,
        $context,
        $corpus,
        $components,
        $databases,
        $visitedDatabases,
        $start,
        $flushLimit,
        $variables
    );

    $response = array(
        'success' => true,
        /** sentence id => sentence text (has format of ${before} <em>${sentence}</em> ${after} if context was requested) */
        'sentences' => array(),
        /** sentence id => database id (relevant in the case grinded datasets) */
        'tblist' => array(),
        /** sentence id => dash-separated list of node id's in the hit (e.g. "10-11-12-15-19") */
        'idlist' => array(),
        /** like idlist, but for the @start attribute of those matched nodes */
        'beginlist' => array(),
        /** sentence id => xml of the matched portion of the tree (not always the entire sentence - does not include context sentences (if requested)) */
        'xmllist' => array(),
        /** sentence id => xml of the sentence's metadata, usually empty */
        'metalist' => array(),
        /** sentence id => xml structure containing the results of the requested variables */
        'varlist' => array(),
        /** sentence id => component id */
        'sentenceDatabases' => array(),

        /** amount of results already obtained from the current database */
        'endPosIteration' => $newStart,
        'remainingComponents' => $newRemainingComponents,
        'remainingDatabases' => $newRemainingDatabases,
        'visitedDatabases' => $newVisitedDatabases,

        'searchLimit' => $searchLimit - count($hits),
        'xquery' => $xquery,
    );

    foreach ($hits as list(
        'sentid' => $id,
        'sentence' => $sentence,
        // in all cases, this is the ungrinded database in which the sentence can be found.
        'database' => $sourceDatabase,
        'nodeIds' => $nodeIds,
        'nodeStartIds' => $nodeStartIds,
        'component' => $component,
        'meta' => $treeMetadataXml,
        'xml' => $nodeXml,
        'variableResults' => $variableResults
    )) {
        $response['sentences'][$id] = $sentence;
        $response['tblist'][$id] = $sourceDatabase;
        $response['idlist'][$id] = $nodeIds;
        $response['beginlist'][$id] = $nodeStartIds;
        $response['xmllist'][$id] = $nodeXml;
        $response['metalist'][$id] = $treeMetadataXml;
        $response['varlist'][$id] = $variableResults;
        $response['sentenceDatabases'][$id] = $component;
    }

    if ($searchLimit <= count($hits)) {
        $response['remainingDatabases'] = array();
        $response['visitedDatabases'] = array();
        $response['remainingComponents'] = array();
        $response['endPosIteration'] = 0;
    }

    header('Content-Type: application/json');
    echo json_encode($response);
});

// match current request url
$match = $router->match();

// call closure or throw 404 status
if ($match && is_callable($match['target'])) {
    call_user_func_array($match['target'], $match['params']);
} else {
    header($_SERVER['SERVER_PROTOCOL'].' 404 Not Found');
}
