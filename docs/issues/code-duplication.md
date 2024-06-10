Avoid duplicated, aka copy-pasted, code inside the module. More duplication lowers the code health.

Duplicated code might lead to code that's harder to maintain as the same logical change has to be done in multiple places. Look to extract a shared representation which can be re-used across functions.

## Solution

A certain degree of duplicated code might be acceptable. The problems start when it is the same behavior that is duplicated across the functions in the module, ie. a violation of the [Don't Repeat Yourself (DRY) principle](https://en.wikipedia.org/wiki/Don%27t_repeat_yourself). DRY violations lead to code that is changed together in predictable patterns, which is both expensive and risky. DRY violations can be identified using [CodeScene's X-Ray analysis](https://codescene.com/blog/software-revolution-part3/) to detect clusters of change coupled functions with high code similarity.

Once you have identified the similarities across functions, look to extract and encapsulate the concept that varies into its own function(s). These shared abstractions can then be re-used, which minimizes the amount of duplication and simplifies change.