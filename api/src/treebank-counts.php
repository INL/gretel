<?php

require_once ROOT_PATH.'/functions.php';

require_once ROOT_PATH.'/basex-search-scripts/basex-client.php';
require_once ROOT_PATH.'/basex-search-scripts/metadata.php';
require_once ROOT_PATH.'/basex-search-scripts/treebank-count.php';
require_once ROOT_PATH.'/basex-search-scripts/treebank-utils.php';

function getTreebankCounts($corpus, $components, $xpath)
{
    $serverInfo = getServerInfo($corpus, $components[0]);
    $session = new Session($serverInfo['machine'], $serverInfo['port'], $serverInfo['username'], $serverInfo['password']);

    $counts = array();
    foreach($components as $component) {
        $databases = getUngrindedDatabases($corpus, $component);
        $counts[$component] = getCounts($corpus, $databases, $session, $xpath);
    }

    $session->close();

    return $counts;
}
