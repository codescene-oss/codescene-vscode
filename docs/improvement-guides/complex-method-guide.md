**Problem**: Complex methods contain too many logical branches such as `if` and `for`/`while` loops. It's measured using the [Cyclomatic Complexity metric](https://en.wikipedia.org/wiki/Cyclomatic_complexity). 

## Solution

1. Apply the [Extract Function](https://refactoring.com/catalog/extractFunction.html) refactoring. 
2. Only extract natural and cohesive functions -- don't split for the sake of splitting. 
3. Address related code smells such as Complex Conditional using the [Decompose Conditional](https://refactoring.com/catalog/decomposeConditional.html) refactoring.

**Why is this better?** Modularizing the code simplifies the primary function by breaking its algorithm into multiple well-named logical steps.