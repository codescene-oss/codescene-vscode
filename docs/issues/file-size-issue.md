The file has grown to a large number of lines of code. Avoid large files with many lines of code as they make it hard to get an overview of their content.

When a single module starts to accumulate too many lines of code, there's an increased risk of modularity issues. Act now to prevent future issues.

## Solution

Look for opportunities to modularize the design. This is done by
identifying groups of functions that represent different responsibilities and/or operate
on different data. Once you have identified the different responsibilities, then use refactorings
like [EXTRACT CLASS](https://refactoring.com/catalog/extractClass.html).
