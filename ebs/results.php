<?php
require '../config/config.php';
require "$root/helpers.php";

session_start();
header('Content-Type:text/html; charset=utf-8');

$currentPage = 'ebs';
$step = 6;

$id = session_id();
$date = date('d-m-Y');
$time = time();

$continueConstraints = sessionVariablesSet(array('treebank', 'search', 'sentid', 'example', 'subtreebank', 'xpath'));

if ($continueConstraints) {
    $sortTables = true;
    $treeVisualizer = true;
    $treebank = $_SESSION['treebank'];
    $component = $_SESSION['subtreebank'];
    $component = implode(', ', $component);
    if ($treebank != "sonar") $originalXp = $_POST['original-xp'];
    $sm = $_SESSION['search'];
    $exid = $_SESSION['sentid'];
    $example = $_SESSION['example'];
    $xpath = $_SESSION['xpath'];

    // get context option
    $context = ($_SESSION['ct'] == 'on') ? 1 : 0;

    // Reset amounts the "fetch more results" button has been clicked
    // Used in fetch-results.php
    $_SESSION['queryIteration'] = 0;
    $lpxml = simplexml_load_file("$tmp/$id-pt.xml");

    $export = "$home/scripts/SaveResults.php?"; // script for downloading the results
    $exportxp = "$home/scripts/SaveXPath.php"; // script for downloading the XPath expression
}

require "$root/functions.php";
require "$root/php/head.php";
?>
</head>
<?php flush(); ?>
<?php
require "$root/php/header.php";

if ($continueConstraints):
  ?>
  <div><a href="<?php echo $export.'print=txt'; ?>" title="Printer-friendly version of all results"
    download="gretel-results.txt">Download results</a></div>

  <h3>Query</h3>
  <p>You can <a href="<?php echo $exportxp; ?>" title="Save XPath query" download="gretel-xpath.txt">save the XPath query</a>
    to use it as input for the XPath search mode.
    This allows you to use the same query for another (part of a) treebank or for a slightly modified search without having to start completely
    from scratch.</p>
  <table>
    <tbody><tr><th>Input example</th><td><?php echo $example; ?></td></tr>
    <tr><th>XPath</th><td><code><?php echo $xpath; ?></code></td></tr>
    <?php if ($treebank == 'lassy' || $treebank == 'cgn'): ?>
    <tr><th>Treebank</th><td><?php echo strtoupper($treebank)." [$component]"; ?></td></tr>
    <?php elseif ($treebank == 'sonar'): ?>
    <tr><th>Treebank</th><td><?php echo strtoupper($treebank)." [$component]"; ?></td></tr>
    <?php endif; ?>
    </tbody>
  </table>

  <?php if ($treebank == 'lassy' || $treebank == 'cgn'): ?>
    <h3>Results</h3>
    <p>It is possible to dowload a tab-separated file of sentence IDs, matching sentences, and hits per sentence from the table below.
      You can also see and download a distribution overview of the hits over the different treebanks.</p>
      <!--
    <table><tbody>
      <tr><th>Hits</th><td>'.$TOTALCOUNTS['hits'].'</td></tr>
      <tr><th>Matching sentences</th><td>'.$TOTALCOUNTS['ms'].'</td>
      <tr><th>Sentences in treebank</th><td>'.$TOTALCOUNTS['totals'].'</td></tr>
    </tbody></table>
  -->
    <a href="#restable" class="show_hide" id="restable">
      <div id="show" class="showhide">Show hits distribution</div><div id="hide" class="showhide">Hide hits distribution</div>
    </a>
    <div class="slidingDiv">
      <?php // printCounts($treebank, $HITS, $MS, $TOTALS, $TOTALCOUNTS); ?>
      <p class="temporary">Still counting</p>
      <a href="<?php echo $export.'&print=csv'; ?>" title="Comma-separated file of detailed search results' (counts per treebank)"
        download="gretel-distribution.txt">Download distribution</a>
    </div>
    <p><strong>Click on a sentence ID</strong> to view the tree structure. The sentence ID refers to the treebank component in which
      the sentence occurs, the text number, and the location within the text (page + sentence number).</p>

    <?php endif; // $treebank lassy and cgn ?>
    <div class="error">
      <p></p>
    </div>
    <div class="count"><p>Number of results: <strong>0</strong> / <span>--</span></p></div>
    <div class="results-wrapper" style="display: none">
      <table>
        <thead>
          <tr><th>ID</this>
          <th>Sentence</th></tr>
        </thead>
        <tbody>
        </tbody>
      </table>
    </div>
    <div class="btn-wrapper">
        <div class="loading-wrapper tree-load-screen">
            <div class="loading"></div>
        </div>
        <button class="stop">Stop searching</button>
        <button class="continue" disabled>Continue searching</button>
        <label><input type="checkbox" name="continue-bg"> Search on background</label>
    </div>
    <div class="notice">
      <p></p>
    </div>

<?php
    setContinueNavigation();
else: // $continueConstraints
    setErrorHeading();
    ?>
    <p>You did not select a treebank, or something went wrong when determining the XPath for your request. It is also
        possible that you came to this page directly without first entering an input example.</p>
    <?php
    getPreviousPageMessage(4);

endif;
require "$root/php/footer.php";
include "$root/scripts/AnalyticsTracking.php";

if ($continueConstraints) : ?>
    <div class="loading-wrapper tree-load-screen">
        <div class="loading"><p>Loading tree...<br>Please wait</p></div>
    </div>
    <?php // Variables for JS
    $vars = array(
        'fetchResultsPath' => "$home/php/fetch-results.php",
        'fetchCountsPath' => "$home/php/fetch-counts.php",
    );
    ?>
    <script>
    var phpVars = <?php echo json_encode($vars); ?>;
    </script>
    <script src='<?php echo "$home/js/results.js"; ?>'></script>
<?php endif; ?>
</body>
</html>
