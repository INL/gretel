<!DOCTYPE html>
<html lang="en" class="no-js">
<head>
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="format-detection" content="telephone=no">
<title><?php setPageTitle(); ?></title>
<meta name="description" content="GrETEL is an online tool that facilitates the exploitation of treebanks, large pieces of text that are syntactically annotated, by only requiring an input example instead of a formal query, or hard to understand computer code.">
<meta name="keywords" content="GrETEL, treebank, sonar, cgn, lassy, dependency, syntax, dutch, corpus, example based, ccl, centre for computational linguistics, search">

<?php if (isBigStep()): ?>
  <meta name="robots" content="noindex">
<?php endif; ?>

<base href="<?php echo HOME_PATH; ?>">
<link rel="icon" type="image/png" href="favicon-32x32.png" sizes="32x32">
<link rel="icon" type="image/png" href="favicon-16x16.png" sizes="16x16">

<link href="https://fonts.googleapis.com/css?family=Open+Sans:400:latin|Roboto+Condensed:400:latin" rel="stylesheet">
<link rel="stylesheet" href="style/css/min/styles.min.css">
<link rel="stylesheet" href="//code.jquery.com/ui/1.12.1/themes/base/jquery-ui.css">

<?php if (isset($treeVisualizer) && $treeVisualizer): ?>
  <link rel="stylesheet" href="style/css/min/tree-visualizer.min.css">
<?php endif; ?>
<?php
  // Load low-priority fonts asynchronously and add classes to HTML element when finished
 ?>
<script>
    document.getElementsByTagName("html")[0].classList.remove("no-js");

    WebFontConfig = {
        google: {
            families: ["Roboto+Mono:400:latin", "Open+Sans:300,700:latin"]
        },
        custom: {
            families: ["FontAwesome"],
            urls: ["https://maxcdn.bootstrapcdn.com/font-awesome/4.6.3/css/font-awesome.min.css"]
        },
        classes: false,
        fontactive: function(familyName, fvd) {
          if (familyName == "FontAwesome") {
              document.addEventListener('DOMContentLoaded', appropriateFaClass("fa-loaded"));
          }
        },
        fontinactive: function(familyName, fvd) {
            if (familyName == "FontAwesome") {
                <?php
                    // Due to a bug in webfontloader, Edge wrongly returns fontinactive on a succesful font load
                    // For that reason, we always use fa-loaded for Edge
                ?>
                if (/Edge\/\d./i.test(navigator.userAgent)) {
                    document.addEventListener('DOMContentLoaded', appropriateFaClass("fa-loaded"));
                } else {
                    document.addEventListener('DOMContentLoaded', appropriateFaClass("fa-failed"));
                }
            }
        }
    };

    function appropriateFaClass(classname) {
        var faNodes = document.querySelectorAll(".fa, .fa-before");
        for (var i = 0; i < faNodes.length; ++i) {
          faNodes[i].classList.add(classname);
        }
    }

    (function(d) {
        var wf = d.createElement("script"),
            s = d.scripts[0];
        wf.src = "https://ajax.googleapis.com/ajax/libs/webfont/1.6.26/webfont.js";
        s.parentNode.insertBefore(wf, s);
    })(document);
</script>
