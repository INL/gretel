<?php

require '../vendor/autoload.php';
require '../../config.php';
require '../../preparatory-scripts/alpino-parser.php';
require '../../preparatory-scripts/xpath-generator.php';
require './results.php';
require './treebank-counts.php';

// Maybe change this?
header('Access-Control-Allow-Origin: *');

$router = new AltoRouter();
$router->setBasePath('/gretel/api/src/router.php');
$alpinoDirectory = '/opt/Alpino';
define('ROOT_PATH', '/vagrant/vagrant_data/gretel');

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

$router->map('POST', '/parse_sentence', function () {
    $sentence = file_get_contents('php://input');
    $location = alpino($sentence, 'ng'.time());

    header('Content-Type: application/xml');
    $parsed = fopen($location, 'r') or die('Unable to open parsed file!');
    echo fread($parsed, filesize($location));
    fclose($parsed);
    unlink($location);
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
    global $resultsLimit;

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
    $searchLimit = isset($data['isAnalysis']) && $data['isAnalysis'] === 'true' ? $analysisLimit : $resultsLimit;

    $results = getResults($xpath, $context, $corpus, $components, $iteration, $searchLimit, $variables, $remainingDatabases);

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
