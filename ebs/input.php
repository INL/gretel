<?php
require '../config/config.php';
require "$root/helpers.php";

session_start();
header('Content-Type:text/html; charset=utf-8');

$currentPage = 'ebs';
$step = 1;
$taalPortaal = true;

$id = session_id();
if (isset($_SESSION['example'])) {
    $input = $_SESSION['example'];
} else {
    $input = 'Dit is een zin.';
}

session_regenerate_id(FALSE);
session_unset();

require "$root/functions.php";
require "$root/php/head.php";
?>
</head>
<?php flush(); ?>
<?php require "$root/php/header.php"; ?>
    <form action="parse.php" method="post" enctype="multipart/form-data">
        <p>Enter a <strong>sentence</strong> containing the (syntactic) characteristics you are looking for:</p>
        <div class="input-wrapper">
          <input type="text" name="input" placeholder="Dit is een voorbeeldzin." value="<?php echo $input; ?>" required>
          <button type="reset" name="clear" title="Empty the input field"><i class="fa fa-times"></i></button>
      </div>
        <p>Select the <strong>search mode</strong> you want to use. <em>Basic search</em> doesn't
            require any knowledge of the used formal query language, but it also has less
            search options. <em>Advanced search</em> on the other hand allows a more specific
            search and offers you the possibility to adapt the automatically generated XPath query.</p>
        <div class="label-wrapper"><label><input type="radio" name="search" value="basic" checked> Basic search</label></div>
        <div class="label-wrapper"><label><input type="radio" name="search" value="advanced"> Advanced search</label></div>
        <?php setContinueNavigation(); ?>
    </form>

    <?php
    require "$root/php/footer.php";
    include "$root/scripts/AnalyticsTracking.php";
    ?>
</body>
</html>
