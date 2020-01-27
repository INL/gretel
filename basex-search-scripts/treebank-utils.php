<?php

/**
 * Part of the GRIND-database resolving.
 *
 * Retrieve all other databases described in this one.
 * This is done by scanning for <include file="database_file_name"/> elements and retrieving the file string values.
 * Returned databases are not checked for existance.
 *
 * @param string $database
 * @param Session $session
 * @return string[]
 */
function expandGrindDatabase($database, $session) {
    if ($session->query("db:exists('$database')")->execute() == 'false') {
        return array();
    }

    $xquery = 'db:open("'.$database.'")/treebank/include';
    $query = $session->query($xquery);
    /** @var string $result */
    $result = $query->execute();
    $query->close();

    $newIncludes = explode("\n", $result);
    $newIncludes = array_cleaner($newIncludes);

    $pattern = '/file=\"(.+)\"/';

    $databases = array();
    foreach ($newIncludes as $newInclude) {
        if (preg_match($pattern, $newInclude, $files)) {
            $file = $files[1];
            $databases[] = $file;
        }
    }

    return $databases;
}

/**
 * Part of the GRIND-database resolving.
 *
 * Retrieve all children from this database and mark it as visited.
 * Children already visited are not returned.
 * @param string $database
 * @param Session $session
 * @param string[] $visited
 */
function expandGrindDatabaseAndVisit($database, $session, &$visited) {
    $children = expandGrindDatabase($database, $session);
    $visited[$database] = true;
    $children = array_filter($children, function($child) { return !isset($visited, $child); });
    return $children;
}

/**
 * Part of the GRIND-database resolving.
 *
 * NOTE: should only be called if shouldUseGrindedDatabases() returns true, or bogus databases may be returned.
 *
 * @param string $component
 * @param string $bf the breadth-first pattern generated from xpathToBreadthFirst
 * @return string[] the database(s) to start the search in
 */
function getGrindEntryDatabases($component, $bf) {
    global $cats;

    $databases = array();

    // If is substring (eg. ALLnp%det)
    if (strpos($bf, 'ALL') !== false) {
        foreach ($cats as $cat) {
            $bfcopy = $component.str_replace('ALL', $cat, $bf);
            $databases[] = $bfcopy;
        }
    } else {
        $databases[] = $component.$bf;
    }
    return $databases;
}

/**
 * Sometimes a component is split up into multiple databases (sometimes hundreds!)
 * These should be stored in a file containing the database names, one per line.
 * If the file is missing, the original component is assumed to share its name with its database.
 *
 * @param string $corpus
 * @param string $component
 *
 * @return string[]
 */
function getUngrindedDatabases($corpus, $component)
{
    $path = ROOT_PATH."/treebank-parts/$corpus/$component.lst";
    if (file_exists($path)) {
        $databasesForComponent = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    } else {
        $databasesForComponent = false;
    }

    return $databasesForComponent ? $databasesForComponent : array($component);
}

/**
 * Return whether the corpus supports grinding, and whether the grinded data should be used for this xpath.
 * @param string $corpus
 * @param string|false $bf result of the xpathToBreadthFirst function, this determined whether the query can be run on the grinded data.
 * @return boolean
 */
function shouldUseGrindedDatabases($corpus, $bf) {
    if (!isGrinded($corpus)) {
        return false;
    }

    if (!$bf || $bf === 'ALL') {
        // Can't decompose into breadth-first search - use ungrinded data instead!
        return false;
    }
    return true;
}