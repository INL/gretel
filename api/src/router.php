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

$router->map('GET', '/tree/[*:treebank]/[*:sentid]', function ($treebank, $sentid) {
    if (isset($_GET['db'])) {
        $db = $_GET['db'];
    }
    showTree($sentid, $treebank, $db);
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
    global $resultsLimit, $analysisLimit, $analysisFlushLimit, $flushLimit, $needRegularGrinded;

    $input = file_get_contents('php://input');
    $data = json_decode($input, true);
    $xpath = $data['xpath'];
    $context = $data['retrieveContext'];
    $corpus = $data['corpus'];
    $components = $data['components'];
    if (isset($data['variables'])) {
        $variables = $data['variables'];
    } else {
        $variables = null;
    }
    $iteration = $data['iteration'];
    $remainingDatabases = $data['remainingDatabases'];

    if (!isset($analysisLimit)) {
        $analysisLimit = $resultsLimit;
    }
    if (isset($data['isAnalysis']) && $data['isAnalysis']) {
        $searchLimit = $analysisLimit;
        if (isset($analysisFlushLimit)) {
            $flushLimit = $analysisFlushLimit;
        }
    } else {
        $searchLimit = $resultsLimit;
    }

    if (isset($data['already'])) {
        $already = $data['already'];
    } else {
        $already = null;
    }
    $needRegularGrinded = isset($data['needRegularGrinded']) && $data['needRegularGrinded'];
    $results = getResults(
        $xpath,
        $context,
        $corpus,
        $components,
        $iteration,
            isset($data['searchLimit']) && $data['searchLimit'] < $searchLimit
            ? $data['searchLimit']
            : $searchLimit,
        $variables,
        $remainingDatabases,
        $already);

    if ($results['success']) {
        // append the actual search limit from the configuration
        $results['searchLimit'] = $searchLimit;
    }

    header('Content-Type: application/json');
    echo json_encode($results);
});

// match current request url
$match = $router->match();

// call closure or throw 404 status
if ($match && is_callable($match['target'])) {
    call_user_func_array($match['target'], $match['params']);
} else {
    header($_SERVER['SERVER_PROTOCOL'].' 404 Not Found');
}
