<?php

header("Cache-Control: no-store, no-cache, must-revalidate, max-age=0");
header("Cache-Control: post-check=0, pre-check=0", false);
header("Pragma: no-cache");

require '../config/config.php';
require "$root/functions.php";

require "$root/basex-search-scripts/basex-client.php";
require "$root/basex-search-scripts/treebank-search.php";

session_start();
set_time_limit(0);

$corpus = $_SESSION['treebank'];
$components = $_SESSION['subtreebank'];
$componentsString = implode('-', $components);
$databaseString = $corpus;
$databases = $_SESSION['startDatabases'];

if ($corpus == 'sonar') {
    $needRegularSonar = $_SESSION['needRegularSonar'];
}

$xpath = $_SESSION['xpath'];
$ebsxps = $_SESSION['ebsxps'];

if ($ebsxps == 'ebs') {
    $example = $_SESSION['example'];
    $xpChanged = $_SESSION['xpChanged'];
    $originalXp = $_SESSION['originalXp'];
}

// get context option
$context = $_SESSION['ct'];
$id = session_id();
session_write_close();

$date = date('d-m-Y');
$time = time();

$user = (getenv('REMOTE_ADDR')) ? getenv('REMOTE_ADDR') : 'anonymous';

if ($ebsxps == 'ebs') {
    $xplog = fopen("$log/gretel-ebq.log", 'a');
    // fwrite($xplog, "Date\tIP.address\tUnique.ID\tInput.example\tTreebank\tComponent\tXPath.changed\tXPath.searched\tOriginal.xpath\n");
    fwrite($xplog, "$date\t$user\t$id-$time\t$example\t$corpus\t$componentsString\t$xpChanged\t$xpath\t$originalXp\n");
    fclose($xplog);
} else {
    $xplog = fopen("$log/gretel-xps.log", 'a');
    fwrite($xplog, "$date\t$user\t$id-$time\t$corpus\t$componentsString\t$xpath\n");
    fclose($xplog);
}

try {
    if ($corpus == 'sonar') {
        $serverInfo = getServerInfo($corpus, $components[0]);
    } else {
        $serverInfo = getServerInfo($corpus, false);
    }

    $dbhost = $serverInfo{'machine'};
    $dbport = $serverInfo{'port'};
    $session = new Session($dbhost, $dbport, $dbuser, $dbpwd);

    list($sentences, $tblist, $idlist, $beginlist) = getSentences($xpath, $corpus, $components, $databases, $context, 'all', $session);

    $session->close();

    if (isset($sentences)) {
        // Write results to file so that they can be downloaded later on
        // If the file already exists, remove it and re-create it (just to be sure)
        $fileName = "$tmp/$id-gretel-results.txt";
        if (file_exists($fileName)) {
            unlink($fileName);
        }

        $fh = fopen($fileName, 'a');
        fwrite($fh, "$xpath\n");

        foreach ($sentences as $sid => $sentence) {
            // highlight sentence
            $hlsentence = highlightSentence($sentence, $beginlist[$sid], 'strong');

            $changeTags = array('<em>' => '', '</em>' => '', '<strong>' => '<hit>', '</strong>' => '</hit>');
            $hlsentenceDownload = strtr($hlsentence, $changeTags);

            $transformQuotes = array('"' => '&quot;', "'" => '&apos;');
            $hlsentence = strtr($hlsentence, $transformQuotes);

            if ($corpus == 'sonar') {
                // E.g. WRPEC0000019treebank
                $databaseString = $tblist[$sid];
            }

            // remove the added identifier (see GetSentences) to use in the link
            $sidString = strstr($sid, '-endPos=', true) ?: $sid;

            // subtreebank where the sentence was found:
            if ($corpus == 'lassy') {
                preg_match('/([^<>]+?)(?:-\d+(?:-|\.).*)/', $sidString, $componentsFromRegex);
                $componentsFromRegex = preg_replace('/^((?:[a-zA-Z]{3,4})|(?:WR(?:-[a-zA-Z]){3}))-.*/', '$1', $componentsFromRegex[1]);

                $componentsString = str_replace('-', '', $componentsFromRegex);
                $componentsString = substr($componentsString, 0, 4);
            } elseif ($corpus == 'cgn') {
                preg_match('/([^<>\d]+)/', $sidString, $componentsFromRegex);
                $componentsFromRegex = substr($componentsFromRegex[1], 1);

                $componentsString = str_replace('-', '', $componentsFromRegex);
            } elseif ($corpus == 'sonar') {
                preg_match('/^([a-zA-Z]{2}(?:-[a-zA-Z]){3})/', $sidString, $componentsFromRegex);
                $componentsString = str_replace('-', '', $componentsFromRegex[1]);
            }

            $componentsString = strtoupper($componentsString);

            // For Lassy and CGN tb and db are identical (i.e. lassy & lassy, or cgn & cgn).
            // For Sonar tb is sonar, and db something like WRPEC0000019treebank
            $sentenceidlink = '<a class="tv-show-fs" href="front-end-includes/show-tree.php'
            . '?sid='.$sidString
            . '&tb='.$corpus
            . '&db='.$databaseString
            . '&id='.$idlist[$sid]
            . '" target="_blank">'.$sidString.'</a>';

            $resultsArray{$sid} = array($sentenceidlink, $hlsentence, $componentsString);
            fwrite($fh, "$corpus\t$componentsString\t$hlsentenceDownload\n");
        }
        fclose($fh);

        $results = array(
          'error' => false,
          'data' => $resultsArray,
        );
        // Chrome will keep all cookies and flush 'em at the end which in turn
        // will results in a HEADERS_TOO_BIG error -> unset cookies
        header_remove('Set-Cookie');
        echo json_encode($results);
    } else {
        $results = array(
          'error' => false,
          'data' => '',
        );
        header_remove('Set-Cookie');
        echo json_encode($results);
    }
} catch (Exception $e) {
    $results = array(
      'error' => true,
      'data' => $e->getMessage(),
    );
    header_remove('Set-Cookie');
    echo json_encode($results);
}
