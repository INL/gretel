<?php

function getCounts($corpus, $databases, $session, $xpath) {
    $sum = 0;

    while ($database = array_pop($databases)) {
        $xquery = createXqueryCount($database, $xpath, $corpus);
        $query = $session->query($xquery);
        $sum += $query->execute();
        $query->close();
    }

    return $sum;
}

function createXqueryCount($database, $xpath, $corpus)
{
    $for = 'count(for $node in db:open("'.$database.'")/treebank';
    // if (shouldUseGrindedDatabases($corpus, xpathToBreadthFirst($xpath))) {
    //     $for .= '/tree';
    // }
    $return = ' return $node)';
    $xquery = $for.$xpath.$return;

    return $xquery;
}
