<?php

ini_set('memory_limit', '2G'); // BRING IT ON!

require_once ROOT_PATH.'/functions.php';

require_once ROOT_PATH.'/basex-search-scripts/basex-client.php';
require_once ROOT_PATH.'/basex-search-scripts/metadata.php';
require_once ROOT_PATH.'/basex-search-scripts/treebank-search.php';
require_once ROOT_PATH.'/basex-search-scripts/treebank-utils.php';

/**
 * @param string   $xpath
 * @param bool     $context     retrieve preceding and following sentences?
 * @param string   $corpus      treebank to search
 * @param string[] $components  the component we're searching
 * @param string[] $databases   list of databases that remain to be searched in this component
 * @param string[] $visitedDatabases only relevant if this is a grinded corpus. A child can be reached from mulitple parents, so we need to track what we've searched across sessions or we will end up with duplicate results from that one database (as it has multiple ancestors in the graph), and this is the variable we use to do that.
 * @param int      $start       pagination info, hits to skip in current database
 * @param int      $searchLimit max number of results to retrieve in this call
 * @param array    $variables
 */
function getResults($xpath, $context, $corpus, $components, $databases, $visitedDatabases, $start, $searchLimit, $variables = null)
{
    // Perform some setup.
    $bf = xpathToBreadthFirst($xpath);
    $isGrindedSearch = shouldUseGrindedDatabases($corpus, $bf);

    $hits = array();
    $xquery = "";
    $startTime = (new DateTime())->getTimeStamp();


    while (!empty($components)) {
        $component = array_pop($components);
        $serverInfo = getServerInfo($corpus, $component);
        try {
            $session = new Session($serverInfo['machine'], $serverInfo['port'], $serverInfo['username'], $serverInfo['password']);
        } catch (Exception $e) {
            http_response_code(500);
            die("Could not connect to database server: $corpus, $component, ".$serverInfo['machine'].", ".$serverInfo['port']);
        }

        if (empty($databases)) {
            $databases = $isGrindedSearch ? getGrindEntryDatabases($component, $bf) : getUngrindedDatabases($corpus, $component);
        }

        // Now search all (remaining?) databases in this component
        while (!empty($databases)) {
            $database = array_pop($databases);
            if ($isGrindedSearch && !array_key_exists($database, $visitedDatabases)) {
                $databases = array_merge($databases, expandGrindDatabaseAndVisit($database, $session, $visitedDatabases));
            }

            $result = getSentences($isGrindedSearch, $corpus, $component, $database, $start, $session, $searchLimit, $xpath, $context, $variables);
            if (!$result['success']) {
                http_response_code(500);
                die(json_encode($result));
            }

            $hitCount = count($result['results']);
            $hits = array_merge($hits, $result['results']);
            $xquery = $result['xquery'];

            $searchLimit -= $hitCount;
            if (((new DateTime())->getTimeStamp() - $startTime) > 10) {
                $searchLimit = 0; // Search is taking a long time - break out
            }

            if ($searchLimit <= 0) { // query limited by max. number of results to retrieve, not done with this database yet.
                $start += $hitCount;
                $databases[] = $database;
                break;
            }

            // still left in our search limit, but done with this database
            // reset our offset for the next database and continue.
            $start = 0;
            continue;
        }

        if ($searchLimit <= 0) { // search hit the limit in inner loop. Not finished with this component yet!
            $components[] = $component;
            break;
        }

        // Can still retrieve more results, but all databases in component have been searched, go to next component.
        $visitedDatabases = array();
        $databases = array();
        $start = 0;
        continue;
    }

    // return results and search state (what component/database/offset we left off etc. if applicable)
    return array(
        'remainingComponents' => $components,
        'remainingDatabases' => $databases,
        'visitedDatabases' => $visitedDatabases,
        'start' => $start,
        'hits' => $hits,
        'xquery' => $xquery
    );
}
