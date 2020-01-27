<?php

/**
 * Databases containing grinded data ofter refer each other.
 * Retrieve the recursive includes for this database (result does not include this db itself).
 *
 * @param string  $database
 * @param Session $session
 *
 * @return string[]
 */
function getMoreIncludes($database, $session)
{
    $xquery = 'db:open("'.$database.'")/treebank/include';
    $query = $session->query($xquery);
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
 * @return {
 *  success: boolean,
 *  xquery: string,
 *  // results only filled if query was a success
 *  results?: Array
 * }
 */
function getSentences($isGrindedSearch, $corpus, $component, $database, $start, $session, $searchLimit, $xpath, $context, $variables = null)
{
    try {
        $xquery = createXquery($isGrindedSearch, $component, $database, $start, $start+$searchLimit, $context, $xpath, $variables);
        $query = $session->query($xquery);
        $result = $query->execute();
        $query->close();
    } catch (Exception $e) {
        // allow a developer to directly debug this query (log is truncated)
        return array(
            'success' => false,
            'xquery' => $xquery,
            'error' => "Could not execute query: ".$e->getMessage(),
        );
    }

    $matches = explode('</match>', $result);
    $matches = array_cleaner($matches);

    $results = array();
    while ($match = array_shift($matches)) {
        $match = str_replace('<match>', '', $match);

        list($sentid, $sentence, $sourceDatabase, $nodeIds, $nodeStartIds, $nodeXml, $treeMetadataXml, $variableResults) = explode('||', $match);
        if (isset($sentid, $sentence, $nodeIds, $nodeStartIds)) { // just to weed out some erroneous hits
            $hit = array(
                'sentid' => trim($sentid)."+match=".($start+count($results)),
                'sentence' => trim($sentence),
                // in all cases, this is the ungrinded database in which the sentence can be found.
                'database' => trim($sourceDatabase),
                'nodeIds' => trim($nodeIds),
                'nodeStartIds' => trim($nodeStartIds),
                'component' => trim($component),
                'meta' => trim($treeMetadataXml),
                'xml' => trim($nodeXml),
                'variableResults' => trim($variableResults),
            );

            $results[] = $hit;
        }
    }

    return array(
        'success' => true,
        'results' => $results,
        'xquery' => $xquery
    );
}

function createXquery($isGrindedSearch, $component, $database, $start, $end, $context, $xpath, $variables)
{
    $variable_declarations = '';
    $variable_results = '';

    if (isset($variables) && $variables != null) {
        foreach ($variables as $index => $value) {
            $name = $value['name'];
            if ($name != '$node') {
                // the root node is already declared in the query itself, do not declare it again
                $variable_declarations .= 'let '.$name.' := ('.$value['path'].')[1]';
            }
            $variable_results .= '<var name="'.$name.'">{'.$name.'/@*}</var>';
        }
        $variable_results = '<vars>'.$variable_results.'</vars>';
    }


    /**
     * grind structure:
     * <treebank component="COMPONENTNAME" cat="(advp|inf|...)" file="...">
     *  <tree id="sentence_id">
     *      <node.../>
     *  </tree>
     * </treebank>
     *
     * sentence2treebank.xml
     *
     * <sentence2treebank>
     *  <sentence nr="sentence_id">sentence text goes here</sentence>
     * </sentence2treebank>
     */

    if ($isGrindedSearch) {
        $query = "
for \$node in db:open(\"$database\")/treebank/tree"./* should have only one slash when grinding*/('/'.preg_replace('/^\/+/', '', $xpath))."
    let \$tree := (\$node/ancestor::tree)
    let \$sentid := (\$tree/@id)
    let \$meta := (\$tree/metadata/meta)

    return for \$sentence in (db:open(\"{$component}sentence2treebank\")/sentence2treebank/sentence[@nr=\$sentid])
        (:
        if the non-grinded component data is split into parts, tb contains the part id.
        Usually this is the component name followed by a number, such as GRIND00012,
        This is only present if the non-grinded data is split into multiple parts.
        If the original data is in one file/database, @part does not exist,
        and data is contained in a database with the exact name of the component
        instead of with suffixed numbers.
        :)
        let \$ungrindedDatabase := (\$sentence/@part)
        let \$ids := (\$node//@id)
        let \$indexs := (distinct-values(\$node//@index))
        let \$indexed := (\$tree//node[@index=\$indexs])
        let \$begins := ((\$node | \$indexed)//@begin)
        let \$beginlist := (distinct-values(\$begins))
        ".($context?"
        let \$text := fn:replace(\$sentid[1], \'(.+?)(\d+)$\', \'$1\')
        let \$snr := fn:replace(\$sentid[1], \'(.+?)(\d+)$\', \'$2\')

        let \$prev := (number(\$snr)-1)
        let \$next := (number(\$snr)+1)

        let \$previd := concat(\$text, \$prev)
        let \$nextid := concat(\$text, \$next)

        let \$prevs := root(\$sentence)/sentence2treebank/sentence[@nr=\$previd]
        let \$nexts := root(\$sentence)/sentence2treebank/sentence[@nr=\$nextid]":"")."
        $variable_declarations

        return
        <match>
            {data(\$sentid)}
            ||".($context?"
            {data(\$prevs)} <em>{data(\$sentence)}</em> {data(\$nexts)}":"
            {data(\$sentence)}")."
            ||
            {data(\$ungrindedDatabase)}
            ||
            {string-join(\$ids, '-')}
            ||
            {string-join(\$beginlist, '-')}
            ||
            {\$node}
            ||
            {\$meta}
            ||
            $variable_results
        </match>";
    } else {
        $query = "
for \$node in db:open(\"$database\")/treebank{$xpath}
    let \$tree := (\$node/ancestor::alpino_ds)
    let \$sentid := (\$tree/@id)
    let \$sentence := (\$tree/sentence)
    let \$ids := (\$node//@id)
    let \$indexs := (distinct-values(\$node//@index))
    let \$indexed := (\$tree//node[@index=\$indexs])
    let \$begins := ((\$node | \$indexed)//@begin)
    let \$beginlist := (distinct-values(\$begins))
    let \$meta := (\$tree/metadata/meta)
    ".($context?"
    let \$prevs := (\$tree/preceding-sibling::alpino_ds[1]/sentence)
    let \$nexts := (\$tree/following-sibling::alpino_ds[1]/sentence)":"")."
    $variable_declarations

    return
    <match>
        {data(\$sentid)}
        ||".($context?"
        {data(\$prevs)} <em>{data(\$sentence)}</em> {data(\$nexts)}":"
        {data(\$sentence)}")."
        ||
        $database
        ||
        {string-join(\$ids, '-')}
        ||
        {string-join(\$beginlist, '-')}
        ||
        {\$node}
        ||
        {\$meta}
        ||
        $variable_results
    </match>";
    }

    return "($query)[position() = ".($start+1)." to {$end}]";
}

function highlightSentence($sentence, $beginlist, $tag)
{
    if (strpos($sentence, '<em>') !== false) {
        preg_match("/(.*<em>)(.*?)(<\/em>.*)/", $sentence, $groups);
        $s = $groups[2];
        $prev = $groups[1];
        $next = $groups[3];
    } else {
        $s = $sentence;
    }
    $words = explode(' ', $s);
    $begins = explode('-', $beginlist);

    $i = 0;
    // Instead of wrapping each individual word in a tag, merge sequences
    // of words in one <tag>...</tag>
    foreach ($words as $word) {
        if (in_array($i, $begins)) {
            $val = '';
            if (!in_array($i - 1, $begins)) {
                $val .= "<$tag>";
            }
            $val .= $words[$i];
            if (!in_array($i + 1, $begins)) {
                $val .= "</$tag>";
            }
            $words[$i] = $val;
        }
        ++$i;
    }
    $hlsentence = implode(' ', $words);
    if (isset($prev) || isset($next)) {
        $hlsentence = $prev.' '.$hlsentence.' '.$next;
    }

    return $hlsentence;
}
